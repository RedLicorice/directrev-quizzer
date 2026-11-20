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
  default = "us-east-1"
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

variable "dataset_oidc_subjects" {
  description = "Per-dataset override of the GitHub Actions OIDC `sub` claim(s) the publisher role trusts. Needed only for a dataset repo that has GitHub's \"immutable subject claims\" enabled (check with `gh api repos/<owner>/<repo>/actions/oidc/customization/sub`): then the sub is `repo:<owner>@<ownerId>/<repo>@<repoId>:environment:<env>` instead of the classic `repo:<owner>/<repo>:environment:<env>`. Default (no entry): the classic format."
  type        = map(list(string))
  default     = {}
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

variable "admin_lambda_dist_dir" {
  description = "Directory with the bundled admin Lambda (npm run build:admin in infra/)."
  type        = string
  default     = null
}

variable "edge_function_file" {
  description = "Built CloudFront Function file (npm run build:edge in infra/)."
  type        = string
  default     = null
}

variable "custom_domain" {
  description = "Optional custom host name (DNS on Cloudflare, not Route 53), e.g. quizzer.example.com. Null keeps the default *.cloudfront.net domain."
  type        = string
  default     = null
  validation {
    condition     = var.custom_domain == null || can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", var.custom_domain))
    error_message = "custom_domain must be a lower-case host name (letters, digits, hyphens, at least one dot), e.g. quizzer.example.com."
  }
}

variable "also_serve_cloudfront_domain" {
  description = "With a custom_domain, keep the default *.cloudfront.net domain working too (a second accepted app host, e.g. when a network blocks the custom domain). Ignored without custom_domain."
  type        = bool
  default     = false
}

variable "invite_links" {
  description = "Campaigns (reusable registration URLs that create accounts with no dataset): TTL and use limits offered to admins, text limits, the description shown on the public join page, and the per-IP limit on the join form."
  type = object({
    default_ttl_hours        = optional(number, 168)
    max_ttl_hours            = optional(number, 720)
    default_max_uses         = optional(number, 1)
    max_max_uses             = optional(number, 50)
    name_max_length          = optional(number, 60)
    public_note_max_length   = optional(number, 500)
    internal_note_max_length = optional(number, 200)
    join_attempts            = optional(number, 10)
    join_window_seconds      = optional(number, 600)
    join_description         = optional(string, "Quizzer: allenamento e simulazioni d'esame per le certificazioni cloud e di integrazione. Crea il tuo account per iniziare.")
  })
  default = {}
  validation {
    condition = alltrue([
      for v in [
        var.invite_links.default_ttl_hours,
        var.invite_links.max_ttl_hours,
        var.invite_links.default_max_uses,
        var.invite_links.max_max_uses,
        var.invite_links.name_max_length,
        var.invite_links.public_note_max_length,
        var.invite_links.internal_note_max_length,
        var.invite_links.join_attempts,
        var.invite_links.join_window_seconds,
      ] : v >= 1 && v == floor(v)
    ])
    error_message = "Every numeric invite_links value must be a positive integer."
  }
  validation {
    condition     = var.invite_links.default_ttl_hours <= var.invite_links.max_ttl_hours && var.invite_links.default_max_uses <= var.invite_links.max_max_uses
    error_message = "invite_links defaults must not exceed their maximums."
  }
  validation {
    condition     = length(trimspace(var.invite_links.join_description)) > 0
    error_message = "invite_links.join_description must not be empty."
  }
}
