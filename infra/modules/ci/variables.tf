variable "name_prefix" {
  type = string
}

variable "account_id" {
  type = string
}

variable "create_github_oidc_provider" {
  description = "Create the GitHub OIDC provider (false if the account already has one: then it is referenced by ARN)."
  type        = bool
  default     = true
}

variable "app_repo" {
  description = "owner/name of the app repository."
  type        = string
}

variable "app_oidc_subjects" {
  description = "Allowed `sub` claims for the app publisher role."
  type        = list(string)
}

variable "datasets" {
  description = "Dataset id -> repository (owner/name) and optional OIDC subject override. One publisher role per dataset."
  type = map(object({
    repo = string
    # Override for repos with GitHub's "immutable subject claims" enabled, where the
    # sub is `repo:<owner>@<ownerId>/<repo>@<repoId>:environment:<env>` instead of the
    # classic `repo:<owner>/<repo>:environment:<env>`. Exact strings only (see
    # tests/ci.tftest.hcl "No wildcard subjects"): find the real ids with
    # `gh api repos/<owner>/<repo>/actions/oidc/customization/sub`.
    oidc_subjects = optional(list(string))
  }))
}

variable "dataset_environment" {
  description = "GitHub environment the dataset publish jobs run in (sub = repo:<repo>:environment:<env>)."
  type        = string
  default     = "prod"
}

variable "app_bucket_arn" {
  type = string
}

variable "data_bucket_arn" {
  type = string
}

variable "distribution_arn" {
  type = string
}
