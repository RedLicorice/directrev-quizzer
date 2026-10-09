variable "account_id" {
  description = "AWS account id (12 digits). Passed in instead of looked up, so plans/tests need no credentials."
  type        = string
  validation {
    condition     = can(regex("^[0-9]{12}$", var.account_id))
    error_message = "account_id must be 12 digits."
  }
}

variable "region" {
  type    = string
  default = "eu-central-1"
}

variable "environment" {
  description = "Environment name (prod). A second workspace with `dev` gets separate names."
  type        = string
  default     = "prod"
  validation {
    condition     = can(regex("^[a-z][a-z0-9]{1,9}$", var.environment))
    error_message = "Short lower-case name, e.g. prod or dev."
  }
}

variable "cognito_domain_prefix" {
  description = "Prefix of the Cognito managed login domain (<prefix>.auth.<region>.amazoncognito.com), globally unique, e.g. quizzer-x7k2."
  type        = string
}

variable "admin_email" {
  description = "Owner/admin e-mail: budget alerts (the admin user itself is invited with scripts/invite-user.sh)."
  type        = string
}

variable "github_owner" {
  description = "GitHub user/organisation that owns the repositories."
  type        = string
  default     = "RedLicorice"
}

variable "app_repo_name" {
  type    = string
  default = "directrev-quizzer"
}

variable "app_github_environment" {
  description = "GitHub environment of the app deploy job (OIDC sub = repo:<owner>/<app>:environment:<env>)."
  type        = string
  default     = "prod"
}

variable "dataset_ids" {
  description = "Dataset ids; repository = <github_owner>/quizzer-dataset-<id>."
  type        = list(string)
  default     = ["aws-dva-c02", "mule-mcd-01"]
}

variable "dataset_github_environment" {
  type    = string
  default = "prod"
}

variable "budget_amount_usd" {
  type    = number
  default = 5
}

variable "create_github_oidc_provider" {
  type    = bool
  default = true
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "auth_lambda_dist_dir" {
  description = "Directory with the bundled auth Lambda (npm run build:lambda in infra/)."
  type        = string
  default     = null
}

variable "edge_function_file" {
  description = "Built CloudFront Function file (npm run build:edge in infra/)."
  type        = string
  default     = null
}
