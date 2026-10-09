output "app_url" {
  description = "Public URL of the app."
  value       = "https://${module.site.distribution_domain_name}/"
}

output "distribution_domain_name" {
  value = module.site.distribution_domain_name
}

output "distribution_id" {
  value = module.site.distribution_id
}

output "app_bucket" {
  value = module.site.app_bucket
}

output "data_bucket" {
  value = module.site.data_bucket
}

output "logs_bucket" {
  value = module.site.logs_bucket
}

output "user_pool_id" {
  value = module.identity.user_pool_id
}

output "cognito_domain" {
  value = module.identity.cognito_domain
}

output "kvs_arn" {
  description = "KeyValueStore with the session HMAC keys (scripts/rotate-session-key.sh)."
  value       = module.edge.kvs_arn
}

output "auth_function_name" {
  value = module.lambdas.function_name
}

output "config_parameter" {
  value = aws_ssm_parameter.config.name
}

output "role_arn_app" {
  value = module.ci.app_role_arn
}

output "role_arn_dataset" {
  value = module.ci.dataset_role_arns
}

# Exact GitHub Actions *variables* (not secrets) for each repository.
output "github_variables" {
  description = "Repository (or `prod` environment) variables to set in each GitHub repo."
  value = merge(
    {
      (local.app_repo) = {
        AWS_ROLE_ARN               = module.ci.app_role_arn
        AWS_REGION                 = var.region
        APP_BUCKET                 = module.site.app_bucket
        CLOUDFRONT_DISTRIBUTION_ID = module.site.distribution_id
      }
    },
    {
      for id, d in local.datasets : d.repo => {
        AWS_ROLE_ARN               = module.ci.dataset_role_arns[id]
        AWS_REGION                 = var.region
        DATA_BUCKET                = module.site.data_bucket
        CLOUDFRONT_DISTRIBUTION_ID = module.site.distribution_id
      }
    },
  )
}
