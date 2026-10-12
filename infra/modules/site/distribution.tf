# CloudFront distribution on the default *.cloudfront.net domain (phase 1, no alias/ACM).
# Behaviors (order matters, first match wins):
#   /api/admin/* -> admin Lambda Function URL (OAC), session-check (adm), no cache
#   /auth/*  -> auth Lambda Function URL (OAC), no cache, all viewer values except Host, NO function
#   /data/*  -> data bucket (OAC), session-check, edge TTL, browser `private, no-cache`
#   default  -> app bucket (OAC), session-check, CachingOptimized

locals {
  # Managed policy ids:
  # https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html
  # https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html
  managed = {
    caching_optimized      = "658327ea-f89d-4fab-a63d-7e88639e58f6"
    caching_disabled       = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
    all_viewer_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }
  origin_ids = {
    app   = "app-s3"
    data  = "data-s3"
    auth  = "auth-lambda"
    admin = "admin-lambda"
  }
  auth_origin_domain  = trimsuffix(trimprefix(var.auth_function_url, "https://"), "/")
  admin_origin_domain = trimsuffix(trimprefix(var.admin_function_url, "https://"), "/")
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.name_prefix}-s3"
  description                       = "OAC for the app and data buckets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html
resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "${var.name_prefix}-lambda"
  description                       = "OAC for the auth Lambda Function URL"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "this" {
  #checkov:skip=CKV_AWS_68:no WAF (cost ~6 USD/month > budget); edge auth + OAC protect the origins
  #checkov:skip=CKV2_AWS_47:no WAF (see CKV_AWS_68)
  #checkov:skip=CKV_AWS_174:default *.cloudfront.net certificate forces TLSv1 policy (plan v2 §2.2), fixed with a custom domain in M10
  #checkov:skip=CKV2_AWS_42:phase 1 uses the default CloudFront certificate (no custom domain)
  #checkov:skip=CKV_AWS_310:single origin per path, no failover needed
  #checkov:skip=CKV_AWS_374:no geo restriction: colleagues may travel; access is invite-only
  #checkov:skip=CKV2_AWS_32:response headers policies are attached to every behavior (ids come from module.edge; asserted in tests)
  enabled             = true
  is_ipv6_enabled     = true
  http_version        = "http2and3"
  comment             = "${var.name_prefix} Quizzer"
  default_root_object = "index.html"
  price_class         = var.price_class

  origin {
    origin_id                = local.origin_ids.app
    domain_name              = aws_s3_bucket.app.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = local.origin_ids.data
    domain_name              = aws_s3_bucket.data.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  origin {
    origin_id                = local.origin_ids.auth
    domain_name              = local.auth_origin_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  origin {
    origin_id                = local.origin_ids.admin
    domain_name              = local.admin_origin_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # Admin API (M7). Ordered before the others; the session-check function requires adm=true.
  ordered_cache_behavior {
    path_pattern               = "/api/admin/*"
    target_origin_id           = local.origin_ids.admin
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.managed.caching_disabled
    origin_request_policy_id   = local.managed.all_viewer_except_host
    response_headers_policy_id = var.app_response_headers_policy_id

    function_association {
      event_type   = "viewer-request"
      function_arn = var.session_check_function_arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/auth/*"
    target_origin_id           = local.origin_ids.auth
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.managed.caching_disabled
    origin_request_policy_id   = local.managed.all_viewer_except_host
    response_headers_policy_id = var.app_response_headers_policy_id
  }

  ordered_cache_behavior {
    path_pattern               = "/data/*"
    target_origin_id           = local.origin_ids.data
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = var.data_cache_policy_id
    response_headers_policy_id = var.data_response_headers_policy_id

    function_association {
      event_type   = "viewer-request"
      function_arn = var.session_check_function_arn
    }
  }

  default_cache_behavior {
    target_origin_id           = local.origin_ids.app
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.managed.caching_optimized
    response_headers_policy_id = var.app_response_headers_policy_id

    function_association {
      event_type   = "viewer-request"
      function_arn = var.session_check_function_arn
    }
  }

  logging_config {
    bucket          = aws_s3_bucket.logs.bucket_domain_name
    prefix          = "cloudfront/"
    include_cookies = false
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # Default certificate: CloudFront forces the TLSv1 security policy and it cannot be
  # changed without a custom certificate (plan v2 §2.2, M10 fixes it).
  viewer_certificate {
    cloudfront_default_certificate = true
  }

  depends_on = [aws_s3_bucket_ownership_controls.logs]

  lifecycle {
    prevent_destroy = true
  }
}
