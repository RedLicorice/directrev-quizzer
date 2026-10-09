locals {
  name_prefix = "quizzer-${var.environment}"
  datasets    = { for id in var.dataset_ids : id => { repo = "${var.github_owner}/quizzer-dataset-${id}" } }
  app_repo    = "${var.github_owner}/${var.app_repo_name}"

  edge_function_file   = coalesce(var.edge_function_file, "${path.module}/../../edge/session-check.js")
  auth_lambda_dist_dir = coalesce(var.auth_lambda_dist_dir, "${path.module}/../../lambda/auth/dist")
  config_parameter     = "/quizzer/${var.environment}/config"
}

module "edge" {
  source        = "../../modules/edge"
  name_prefix   = local.name_prefix
  function_code = file(local.edge_function_file)
}

# Zip of the esbuild bundle. Build it first: `cd infra && npm ci && npm run build:lambda`.
data "archive_file" "auth" {
  type        = "zip"
  source_dir  = local.auth_lambda_dist_dir
  output_path = "${path.module}/.build/auth.zip"
}

module "lambdas" {
  source                = "../../modules/lambdas"
  name_prefix           = local.name_prefix
  account_id            = var.account_id
  region                = var.region
  auth_zip_path         = data.archive_file.auth.output_path
  auth_zip_sha256       = data.archive_file.auth.output_base64sha256
  config_parameter_name = local.config_parameter
  kvs_arn               = module.edge.kvs_arn
  distribution_arn      = module.site.distribution_arn
  log_retention_days    = var.log_retention_days
}

module "site" {
  source                          = "../../modules/site"
  name_prefix                     = local.name_prefix
  account_id                      = var.account_id
  session_check_function_arn      = module.edge.function_arn
  app_response_headers_policy_id  = module.edge.app_response_headers_policy_id
  data_response_headers_policy_id = module.edge.data_response_headers_policy_id
  data_cache_policy_id            = module.edge.data_cache_policy_id
  auth_function_url               = module.lambdas.function_url
  log_retention_days              = var.log_retention_days
}

module "identity" {
  source        = "../../modules/identity"
  name_prefix   = local.name_prefix
  region        = var.region
  domain_prefix = var.cognito_domain_prefix
  app_domain    = module.site.distribution_domain_name
  dataset_ids   = var.dataset_ids
}

# Runtime config of the auth Lambda (CONTRACT.md §6). It depends on the client and the
# distribution; the Lambda only knows its *name*, which breaks the dependency cycle.
resource "aws_ssm_parameter" "config" {
  #checkov:skip=CKV2_AWS_34:public, non-secret config (ids and host names); a SecureString would need KMS permissions
  name        = local.config_parameter
  description = "Quizzer auth Lambda runtime config (no secrets)"
  type        = "String"
  tier        = "Standard"
  value = jsonencode({
    userPoolId        = module.identity.user_pool_id
    clientId          = module.identity.client_id
    cognitoDomain     = module.identity.cognito_domain
    region            = var.region
    appHosts          = [module.site.distribution_domain_name]
    datasets          = sort(var.dataset_ids)
    sessionTtlSeconds = 1800
    refreshCookieDays = 30
  })
}

module "ci" {
  source                      = "../../modules/ci"
  name_prefix                 = local.name_prefix
  account_id                  = var.account_id
  create_github_oidc_provider = var.create_github_oidc_provider
  app_repo                    = local.app_repo
  app_oidc_subjects           = ["repo:${local.app_repo}:environment:${var.app_github_environment}"]
  datasets                    = local.datasets
  dataset_environment         = var.dataset_github_environment
  app_bucket_arn              = module.site.app_bucket_arn
  data_bucket_arn             = module.site.data_bucket_arn
  distribution_arn            = module.site.distribution_arn
}

resource "aws_budgets_budget" "monthly" {
  name         = "${local.name_prefix}-monthly"
  budget_type  = "COST"
  limit_amount = format("%.2f", var.budget_amount_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.admin_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.admin_email]
  }
}
