# Offline tests (mock provider, no credentials):
# https://developer.hashicorp.com/terraform/language/tests/mocking
mock_provider "aws" {
  override_resource {
    target = aws_cloudfront_distribution.this
    values = {
      arn         = "arn:aws:cloudfront::123456789012:distribution/E1TESTDIST"
      id          = "E1TESTDIST"
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }
  override_resource {
    target = aws_s3_bucket.app
    values = { arn = "arn:aws:s3:::quizzer-test-app-123456789012" }
  }
  override_resource {
    target = aws_s3_bucket.data
    values = { arn = "arn:aws:s3:::quizzer-test-data-123456789012" }
  }
  override_resource {
    target = aws_s3_bucket.logs
    values = { arn = "arn:aws:s3:::quizzer-test-logs-123456789012" }
  }
}

variables {
  name_prefix                     = "quizzer-test"
  account_id                      = "123456789012"
  session_check_function_arn      = "arn:aws:cloudfront::123456789012:function/quizzer-test-session-check"
  app_response_headers_policy_id  = "app-rhp"
  data_response_headers_policy_id = "data-rhp"
  data_cache_policy_id            = "data-cp"
  auth_function_url               = "https://abcdefghijklmnop.lambda-url.eu-central-1.on.aws/"
  admin_function_url              = "https://adminadminadmin.lambda-url.eu-central-1.on.aws/"
}

run "buckets_are_private" {
  command = apply

  assert {
    condition = alltrue([for k, p in aws_s3_bucket_public_access_block.this :
    p.block_public_acls && p.block_public_policy && p.ignore_public_acls && p.restrict_public_buckets])
    error_message = "Every bucket must have all four Block Public Access settings on."
  }
  assert {
    condition     = toset(keys(aws_s3_bucket_public_access_block.this)) == toset(["app", "data", "logs"])
    error_message = "PAB must cover app, data and logs."
  }
  assert {
    condition     = aws_s3_bucket_ownership_controls.app.rule[0].object_ownership == "BucketOwnerEnforced" && aws_s3_bucket_ownership_controls.data.rule[0].object_ownership == "BucketOwnerEnforced"
    error_message = "ACLs must be disabled on app/data."
  }
  assert {
    condition     = alltrue([for k, e in aws_s3_bucket_server_side_encryption_configuration.this : one(one(e.rule).apply_server_side_encryption_by_default).sse_algorithm == "AES256"])
    error_message = "SSE-S3 everywhere."
  }
  assert {
    condition     = aws_s3_bucket_versioning.app.versioning_configuration[0].status == "Enabled" && aws_s3_bucket_versioning.data.versioning_configuration[0].status == "Enabled"
    error_message = "Versioning on app and data."
  }
  assert {
    condition     = one(aws_s3_bucket_lifecycle_configuration.data.rule).noncurrent_version_expiration[0].noncurrent_days == 90
    error_message = "Data noncurrent versions expire after 90 days."
  }
}

run "bucket_policies_oac_and_tls_only" {
  command = apply

  assert {
    condition = jsondecode(aws_s3_bucket_policy.data.policy).Statement[0] == {
      Sid       = "AllowCloudFrontServicePrincipalReadOnly"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "arn:aws:s3:::quizzer-test-data-123456789012/*"
      Condition = { StringEquals = { "AWS:SourceArn" = "arn:aws:cloudfront::123456789012:distribution/E1TESTDIST" } }
    }
    error_message = "Data bucket policy must match the AWS OAC example exactly."
  }
  assert {
    condition     = jsondecode(aws_s3_bucket_policy.app.policy).Statement[0].Resource == "arn:aws:s3:::quizzer-test-app-123456789012/*"
    error_message = "App bucket OAC statement on the app bucket."
  }
  assert {
    condition = alltrue([for p in [aws_s3_bucket_policy.app.policy, aws_s3_bucket_policy.data.policy, aws_s3_bucket_policy.logs.policy] :
      anytrue([for s in jsondecode(p).Statement : s.Effect == "Deny" && s.Condition.Bool["aws:SecureTransport"] == "false"])
    ])
    error_message = "Every bucket denies non-TLS access."
  }
  assert {
    condition = alltrue([for p in [aws_s3_bucket_policy.app.policy, aws_s3_bucket_policy.data.policy] :
      length([for s in jsondecode(p).Statement : s if s.Effect == "Allow"]) == 1
    ])
    error_message = "Only CloudFront may read: exactly one Allow statement per bucket."
  }
}

run "oac" {
  command = apply

  assert {
    condition     = aws_cloudfront_origin_access_control.s3.origin_access_control_origin_type == "s3" && aws_cloudfront_origin_access_control.s3.signing_behavior == "always" && aws_cloudfront_origin_access_control.s3.signing_protocol == "sigv4"
    error_message = "S3 OAC: always sign with sigv4."
  }
  assert {
    condition     = aws_cloudfront_origin_access_control.lambda.origin_access_control_origin_type == "lambda" && aws_cloudfront_origin_access_control.lambda.signing_behavior == "always"
    error_message = "Lambda OAC: always sign."
  }
  assert {
    condition     = length(aws_cloudfront_distribution.this.origin) == 4
    error_message = "Four origins: app, data, auth, admin."
  }
  assert {
    condition = alltrue([for o in aws_cloudfront_distribution.this.origin :
      o.origin_access_control_id == (o.origin_id == "auth-lambda" || o.origin_id == "admin-lambda" ? aws_cloudfront_origin_access_control.lambda.id : aws_cloudfront_origin_access_control.s3.id)
    ])
    error_message = "Every origin uses the matching OAC."
  }
  assert {
    condition     = one([for o in aws_cloudfront_distribution.this.origin : o.domain_name if o.origin_id == "auth-lambda"]) == "abcdefghijklmnop.lambda-url.eu-central-1.on.aws"
    error_message = "Auth origin = Function URL host."
  }
  assert {
    condition     = one([for o in aws_cloudfront_distribution.this.origin : o.domain_name if o.origin_id == "admin-lambda"]) == "adminadminadmin.lambda-url.eu-central-1.on.aws"
    error_message = "Admin origin = Function URL host."
  }
  assert {
    condition     = alltrue([for o in aws_cloudfront_distribution.this.origin : length(o.s3_origin_config) == 0])
    error_message = "No legacy OAI."
  }
}

run "behaviors" {
  command = apply

  assert {
    condition     = [for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b.path_pattern] == ["/api/admin/*", "/auth/*", "/data/*"]
    error_message = "Behavior order: /api/admin/*, /auth/*, /data/* (default last)."
  }
  assert {
    condition = (
      aws_cloudfront_distribution.this.ordered_cache_behavior[0].target_origin_id == "admin-lambda" &&
      aws_cloudfront_distribution.this.ordered_cache_behavior[0].cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" &&
      aws_cloudfront_distribution.this.ordered_cache_behavior[0].origin_request_policy_id == "b689b0a8-53d0-40ab-baf2-68738e2966ac" &&
      aws_cloudfront_distribution.this.ordered_cache_behavior[0].response_headers_policy_id == "app-rhp" &&
      contains(aws_cloudfront_distribution.this.ordered_cache_behavior[0].allowed_methods, "DELETE")
    )
    error_message = "/api/admin/*: admin Lambda, CachingDisabled + AllViewerExceptHostHeader, mutations allowed."
  }
  assert {
    condition = [for f in aws_cloudfront_distribution.this.ordered_cache_behavior[0].function_association : [f.event_type, f.function_arn]] == [
      ["viewer-request", "arn:aws:cloudfront::123456789012:function/quizzer-test-session-check"]
    ]
    error_message = "/api/admin/* is protected by session-check (viewer-request, adm=true)."
  }
  assert {
    condition     = aws_cloudfront_distribution.this.ordered_cache_behavior[1].target_origin_id == "auth-lambda" && length(aws_cloudfront_distribution.this.ordered_cache_behavior[1].function_association) == 0
    error_message = "/auth/* goes to the Lambda and has NO session-check."
  }
  assert {
    condition     = aws_cloudfront_distribution.this.ordered_cache_behavior[1].cache_policy_id == "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" && aws_cloudfront_distribution.this.ordered_cache_behavior[1].origin_request_policy_id == "b689b0a8-53d0-40ab-baf2-68738e2966ac"
    error_message = "/auth/*: CachingDisabled + AllViewerExceptHostHeader."
  }
  assert {
    condition     = contains(aws_cloudfront_distribution.this.ordered_cache_behavior[1].allowed_methods, "POST")
    error_message = "/auth/refresh needs POST."
  }
  assert {
    condition = (
      aws_cloudfront_distribution.this.ordered_cache_behavior[2].target_origin_id == "data-s3" &&
      aws_cloudfront_distribution.this.ordered_cache_behavior[2].cache_policy_id == "data-cp" &&
      aws_cloudfront_distribution.this.ordered_cache_behavior[2].response_headers_policy_id == "data-rhp" &&
      toset(aws_cloudfront_distribution.this.ordered_cache_behavior[2].allowed_methods) == toset(["GET", "HEAD"])
    )
    error_message = "/data/*: data bucket, data cache policy, data headers, read-only."
  }
  assert {
    condition = [for f in aws_cloudfront_distribution.this.ordered_cache_behavior[2].function_association : [f.event_type, f.function_arn]] == [
      ["viewer-request", "arn:aws:cloudfront::123456789012:function/quizzer-test-session-check"]
    ]
    error_message = "/data/* is protected by session-check (viewer-request)."
  }
  assert {
    condition = [for f in aws_cloudfront_distribution.this.default_cache_behavior[0].function_association : [f.event_type, f.function_arn]] == [
      ["viewer-request", "arn:aws:cloudfront::123456789012:function/quizzer-test-session-check"]
    ]
    error_message = "Default behavior is protected by session-check."
  }
  assert {
    condition = (
      aws_cloudfront_distribution.this.default_cache_behavior[0].target_origin_id == "app-s3" &&
      aws_cloudfront_distribution.this.default_cache_behavior[0].cache_policy_id == "658327ea-f89d-4fab-a63d-7e88639e58f6" &&
      aws_cloudfront_distribution.this.default_cache_behavior[0].response_headers_policy_id == "app-rhp"
    )
    error_message = "Default: app bucket, CachingOptimized, app headers."
  }
  assert {
    condition = alltrue(concat(
      [for b in aws_cloudfront_distribution.this.ordered_cache_behavior : b.viewer_protocol_policy == "redirect-to-https"],
      [aws_cloudfront_distribution.this.default_cache_behavior[0].viewer_protocol_policy == "redirect-to-https"]
    ))
    error_message = "HTTPS only."
  }
  assert {
    condition     = aws_cloudfront_distribution.this.viewer_certificate[0].cloudfront_default_certificate && length(coalesce(aws_cloudfront_distribution.this.aliases, [])) == 0
    error_message = "Phase 1: default *.cloudfront.net certificate, no aliases."
  }
  assert {
    condition     = aws_cloudfront_distribution.this.logging_config[0].include_cookies == false
    error_message = "Access logs must not contain cookies (session tokens)."
  }
}
