output "distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "distribution_arn" {
  value = aws_cloudfront_distribution.this.arn
}

output "distribution_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "app_bucket" {
  value = aws_s3_bucket.app.bucket
}

output "app_bucket_arn" {
  value = aws_s3_bucket.app.arn
}

output "data_bucket" {
  value = aws_s3_bucket.data.bucket
}

output "data_bucket_arn" {
  value = aws_s3_bucket.data.arn
}

output "logs_bucket" {
  value = aws_s3_bucket.logs.bucket
}
