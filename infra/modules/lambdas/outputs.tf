output "function_name" {
  value = aws_lambda_function.auth.function_name
}

output "function_arn" {
  value = aws_lambda_function.auth.arn
}

output "function_url" {
  value = aws_lambda_function_url.auth.function_url
}

output "role_arn" {
  value = aws_iam_role.auth.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.auth.name
}
