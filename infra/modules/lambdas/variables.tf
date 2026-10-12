variable "name_prefix" {
  type = string
}

variable "account_id" {
  type = string
}

variable "region" {
  type = string
}

variable "auth_zip_path" {
  description = "Path of the auth Lambda zip (built from infra/lambda/auth/dist)."
  type        = string
}

variable "auth_zip_sha256" {
  description = "base64 SHA-256 of the zip (archive_file.output_base64sha256)."
  type        = string
}

variable "config_parameter_name" {
  description = "Name of the SSM parameter holding the runtime config (read by the Lambda; no graph dependency)."
  type        = string
}

variable "kvs_arn" {
  type = string
}

variable "distribution_arn" {
  description = "ARN of the CloudFront distribution allowed to invoke the Function URL through OAC."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "reserved_concurrency" {
  description = "Reserved concurrency for auth (-1 = none). New accounts may have a total limit of 10, in which case reserving fails."
  type        = number
  default     = -1
}

variable "admin_zip_path" {
  description = "Path of the admin Lambda zip (built from infra/lambda/admin/dist)."
  type        = string
}

variable "admin_zip_sha256" {
  description = "base64 SHA-256 of the admin Lambda zip (archive_file.output_base64sha256)."
  type        = string
}

variable "admin_reserved_concurrency" {
  description = "Reserved concurrency for the admin Lambda (-1 = none)."
  type        = number
  default     = -1
}
