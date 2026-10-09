mock_provider "aws" {
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::quizzer-tfstate-123456789012-us-east-1" }
  }
}

variables {
  account_id = "123456789012"
}

run "state_bucket" {
  command = apply
  assert {
    condition     = aws_s3_bucket.state.bucket == "quizzer-tfstate-123456789012-us-east-1"
    error_message = "Bucket name quizzer-tfstate-<account>-<region>."
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.state.block_public_acls && aws_s3_bucket_public_access_block.state.block_public_policy && aws_s3_bucket_public_access_block.state.ignore_public_acls && aws_s3_bucket_public_access_block.state.restrict_public_buckets
    error_message = "Block Public Access."
  }
  assert {
    condition     = aws_s3_bucket_versioning.state.versioning_configuration[0].status == "Enabled"
    error_message = "Versioning (state history)."
  }
  assert {
    condition     = jsondecode(aws_s3_bucket_policy.state.policy).Statement[0].Condition == { Bool = { "aws:SecureTransport" = "false" } }
    error_message = "TLS only."
  }
}
