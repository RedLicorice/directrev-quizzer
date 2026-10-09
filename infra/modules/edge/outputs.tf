output "kvs_arn" {
  value = aws_cloudfront_key_value_store.session.arn
}

output "kvs_id" {
  value = aws_cloudfront_key_value_store.session.id
}

output "function_arn" {
  value = aws_cloudfront_function.session_check.arn
}

output "app_response_headers_policy_id" {
  value = aws_cloudfront_response_headers_policy.app.id
}

output "data_response_headers_policy_id" {
  value = aws_cloudfront_response_headers_policy.data.id
}

output "data_cache_policy_id" {
  value = aws_cloudfront_cache_policy.data.id
}
