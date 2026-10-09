output "user_pool_id" {
  value = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  value = aws_cognito_user_pool.this.arn
}

output "client_id" {
  value = aws_cognito_user_pool_client.app.id
}

output "cognito_domain" {
  description = "Host name of the managed login (prefix domain)."
  value       = "${aws_cognito_user_pool_domain.this.domain}.auth.${var.region}.amazoncognito.com"
}

output "group_names" {
  value = concat([for g in aws_cognito_user_group.dataset : g.name], [aws_cognito_user_group.all.name, aws_cognito_user_group.admin.name])
}
