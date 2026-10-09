output "app_role_arn" {
  value = aws_iam_role.app.arn
}

output "dataset_role_arns" {
  value = { for id, r in aws_iam_role.dataset : id => r.arn }
}

output "oidc_provider_arn" {
  value = local.provider_arn
}
