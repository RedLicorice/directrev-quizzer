variable "name_prefix" {
  description = "Prefix for resource names (e.g. quizzer-prod)."
  type        = string
}

variable "function_code" {
  description = "Source of the CloudFront Function session-check (infra/edge/session-check.js)."
  type        = string
  validation {
    condition     = length(var.function_code) < 10240
    error_message = "CloudFront Functions code must be smaller than 10 KB."
  }
}

variable "content_security_policy" {
  description = "Content-Security-Policy sent on every response (plan v1 §D / v2 §6)."
  type        = string
  default     = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  validation {
    condition     = length(var.content_security_policy) <= 1783
    error_message = "CloudFront limits the CSP header value to 1783 characters."
  }
}

variable "data_edge_ttl_seconds" {
  description = "Edge TTL for /data/* objects (browser gets private, no-cache)."
  type        = number
  default     = 86400
}
