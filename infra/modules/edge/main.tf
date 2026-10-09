# Edge pieces: KeyValueStore (HMAC session keys), CloudFront Function session-check,
# response headers policies and the /data cache policy.

# Holds `qz-current-kid` and `qz-key-<kid>` (CONTRACT.md §3.1). Terraform does NOT manage
# the keys: they are secrets and must stay out of the state (scripts/rotate-session-key.sh).
resource "aws_cloudfront_key_value_store" "session" {
  name    = "${var.name_prefix}-session"
  comment = "Quizzer session HMAC keys (managed by scripts/rotate-session-key.sh)"
}

# https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/kvs-with-functions-associate.html
resource "aws_cloudfront_function" "session_check" {
  name                         = "${var.name_prefix}-session-check"
  runtime                      = "cloudfront-js-2.0"
  comment                      = "Verifies __Host-qz_session and authorizes /data/<id>/"
  publish                      = true
  code                         = var.function_code
  key_value_store_associations = [aws_cloudfront_key_value_store.session.arn]
}

locals {
  security_headers = {
    hsts_max_age = 63072000
  }
}

# App shell, /auth/* pages: security headers only.
resource "aws_cloudfront_response_headers_policy" "app" {
  name    = "${var.name_prefix}-app-headers"
  comment = "HSTS, nosniff, frame DENY, referrer policy, CSP"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = local.security_headers.hsts_max_age
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    content_security_policy {
      content_security_policy = var.content_security_policy
      override                = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=()"
      override = true
    }
    items {
      header   = "Cross-Origin-Opener-Policy"
      value    = "same-origin"
      override = true
    }
  }
}

# /data/*: same security headers + `Cache-Control: private, no-cache` towards the browser,
# so every reuse is revalidated through CloudFront (and the session check).
resource "aws_cloudfront_response_headers_policy" "data" {
  name    = "${var.name_prefix}-data-headers"
  comment = "Security headers + Cache-Control private, no-cache for dataset files"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = local.security_headers.hsts_max_age
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
    content_type_options {
      override = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }
    content_security_policy {
      content_security_policy = var.content_security_policy
      override                = true
    }
  }

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "private, no-cache"
      override = true
    }
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=()"
      override = true
    }
    items {
      header   = "Cross-Origin-Opener-Policy"
      value    = "same-origin"
      override = true
    }
  }
}

# Shared edge cache for authorized users: cookies, headers and query strings are NOT part
# of the cache key (authorization happens in the viewer-request function, before the cache).
resource "aws_cloudfront_cache_policy" "data" {
  name        = "${var.name_prefix}-data-cache"
  comment     = "Dataset files: edge TTL, no cookies in the cache key"
  min_ttl     = 0
  default_ttl = var.data_edge_ttl_seconds
  max_ttl     = var.data_edge_ttl_seconds

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_brotli = true
    enable_accept_encoding_gzip   = true
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}
