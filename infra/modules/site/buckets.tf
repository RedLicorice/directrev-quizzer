# Private S3 buckets: app shell, dataset files (data/<id>/...), CloudFront access logs.
# Block Public Access, BucketOwnerEnforced (except logs: CloudFront legacy logging needs ACLs),
# SSE-S3 (no KMS: OAC + KMS would need extra key policies), TLS-only policy, versioning.

locals {
  buckets = {
    app  = "${var.name_prefix}-app-${var.account_id}"
    data = "${var.name_prefix}-data-${var.account_id}"
  }
  logs_bucket = "${var.name_prefix}-logs-${var.account_id}"
}

resource "aws_s3_bucket" "app" {
  #checkov:skip=CKV_AWS_18:S3 server access logs not needed: reads go through CloudFront (logged), writes via CloudTrail
  #checkov:skip=CKV_AWS_144:no cross-region replication (cost; data is rebuilt from the git repos)
  #checkov:skip=CKV_AWS_145:SSE-S3 on purpose: SSE-KMS with OAC needs extra key policies and costs per request
  #checkov:skip=CKV2_AWS_62:no S3 event notifications needed
  #checkov:skip=CKV2_AWS_6:PAB is set by aws_s3_bucket_public_access_block.this (for_each, not resolved by checkov; asserted in tests/site.tftest.hcl)
  bucket = local.buckets.app
}

resource "aws_s3_bucket" "data" {
  #checkov:skip=CKV_AWS_18:S3 server access logs not needed: reads go through CloudFront (logged), writes via CloudTrail
  #checkov:skip=CKV_AWS_144:no cross-region replication (cost; data is rebuilt from the git repos)
  #checkov:skip=CKV_AWS_145:SSE-S3 on purpose: SSE-KMS with OAC needs extra key policies and costs per request
  #checkov:skip=CKV2_AWS_62:no S3 event notifications needed
  #checkov:skip=CKV2_AWS_6:PAB is set by aws_s3_bucket_public_access_block.this (for_each, not resolved by checkov; asserted in tests/site.tftest.hcl)
  bucket = local.buckets.data
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket" "logs" {
  #checkov:skip=CKV_AWS_18:S3 server access logs not needed: reads go through CloudFront (logged), writes via CloudTrail
  #checkov:skip=CKV_AWS_144:no cross-region replication (cost; data is rebuilt from the git repos)
  #checkov:skip=CKV_AWS_145:SSE-S3 on purpose: SSE-KMS with OAC needs extra key policies and costs per request
  #checkov:skip=CKV2_AWS_62:no S3 event notifications needed
  #checkov:skip=CKV2_AWS_6:PAB is set by aws_s3_bucket_public_access_block.this (for_each, not resolved by checkov; asserted in tests/site.tftest.hcl)
  #checkov:skip=CKV_AWS_21:log bucket: objects expire after 90 days, versioning not useful
  bucket = local.logs_bucket
}

locals {
  all_buckets = {
    app  = aws_s3_bucket.app
    data = aws_s3_bucket.data
    logs = aws_s3_bucket.logs
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = local.all_buckets
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "app" {
  bucket = aws_s3_bucket.app.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_ownership_controls" "data" {
  bucket = aws_s3_bucket.data.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# CloudFront standard logging (legacy) writes with the awslogsdelivery account and needs
# ACLs enabled on the target bucket:
# https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/standard-logging-legacy-s3.html
resource "aws_s3_bucket_ownership_controls" "logs" {
  #checkov:skip=CKV2_AWS_65:CloudFront standard logging (legacy) requires ACLs on the target bucket
  bucket = aws_s3_bucket.logs.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.all_buckets
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_versioning" "app" {
  bucket = aws_s3_bucket.app.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_versioning" "data" {
  bucket = aws_s3_bucket.data.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "app" {
  bucket     = aws_s3_bucket.app.id
  depends_on = [aws_s3_bucket_versioning.app]
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.app_noncurrent_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "data" {
  bucket     = aws_s3_bucket.data.id
  depends_on = [aws_s3_bucket_versioning.data]
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = var.data_noncurrent_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id
  rule {
    id     = "expire-logs"
    status = "Enabled"
    filter {}
    expiration {
      days = var.log_retention_days
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# OAC bucket policy exactly as in
# https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
# plus a deny of non-TLS requests. Policies are built with jsonencode() (not the
# aws_iam_policy_document data source) so that `terraform test` with mock providers can
# assert on their exact content.
locals {
  deny_insecure_transport = {
    for k, b in local.all_buckets : k => {
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [b.arn, "${b.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }
  }
  oac_policies = {
    for k, b in { app = aws_s3_bucket.app, data = aws_s3_bucket.data } : k => {
      Version         = "2012-10-17"
      Statement = [
        {
          Sid       = "AllowCloudFrontServicePrincipalReadOnly"
          Effect    = "Allow"
          Principal = { Service = "cloudfront.amazonaws.com" }
          Action    = "s3:GetObject"
          Resource  = "${b.arn}/*"
          Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.this.arn } }
        },
        local.deny_insecure_transport[k],
      ]
    }
  }
}

resource "aws_s3_bucket_policy" "app" {
  bucket     = aws_s3_bucket.app.id
  policy     = jsonencode(local.oac_policies.app)
  depends_on = [aws_s3_bucket_public_access_block.this]
}

resource "aws_s3_bucket_policy" "data" {
  bucket     = aws_s3_bucket.data.id
  policy     = jsonencode(local.oac_policies.data)
  depends_on = [aws_s3_bucket_public_access_block.this]
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [local.deny_insecure_transport.logs]
  })
  depends_on = [aws_s3_bucket_public_access_block.this]
}
