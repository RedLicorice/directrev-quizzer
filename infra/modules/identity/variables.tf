variable "name_prefix" {
  type = string
}

variable "domain_prefix" {
  description = "Cognito prefix domain: <prefix>.auth.<region>.amazoncognito.com. Globally unique."
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", var.domain_prefix)) && !can(regex("aws|amazon|cognito", var.domain_prefix))
    error_message = "Lower-case letters, digits and hyphens; must not contain aws, amazon or cognito."
  }
}

variable "app_domain" {
  description = "Host name of the app (the CloudFront domain); callback and logout URLs derive from it."
  type        = string
}

variable "extra_app_domains" {
  description = "Additional host names that may serve the app (e.g. the CloudFront domain next to a custom domain); their callback and logout URLs are allowed too."
  type        = list(string)
  default     = []
}

variable "dataset_ids" {
  type = list(string)
  validation {
    condition     = alltrue([for d in var.dataset_ids : can(regex("^[a-z0-9][a-z0-9-]{0,62}$", d))])
    error_message = "Dataset ids: ^[a-z0-9][a-z0-9-]{0,62}$."
  }
}

variable "invite_app_url" {
  description = "URL shown in the invitation email (defaults to https://<app_domain>/)."
  type        = string
  default     = null
}

variable "region" {
  type = string
}
