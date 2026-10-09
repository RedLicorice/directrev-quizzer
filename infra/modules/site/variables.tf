variable "name_prefix" {
  type = string
}

variable "account_id" {
  description = "AWS account id (used in bucket names; no aws_caller_identity lookups)."
  type        = string
}

variable "session_check_function_arn" {
  type = string
}

variable "app_response_headers_policy_id" {
  type = string
}

variable "data_response_headers_policy_id" {
  type = string
}

variable "data_cache_policy_id" {
  type = string
}

variable "auth_function_url" {
  description = "Function URL of the auth Lambda (https://<id>.lambda-url.<region>.on.aws/)."
  type        = string
}

variable "price_class" {
  type    = string
  default = "PriceClass_100"
}

variable "log_retention_days" {
  type    = number
  default = 90
}

variable "app_noncurrent_days" {
  description = "Days after which non-current app object versions (old hashed chunks) expire."
  type        = number
  default     = 30
}

variable "data_noncurrent_days" {
  type    = number
  default = 90
}
