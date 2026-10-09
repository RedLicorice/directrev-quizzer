mock_provider "aws" {
  mock_resource "aws_cloudfront_key_value_store" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:key-value-store/0000-kvs" }
  }
}

variables {
  name_prefix   = "quizzer-test"
  function_code = file("../../edge/session-check.js")
}

run "function_and_kvs" {
  command = apply
  assert {
    condition     = aws_cloudfront_function.session_check.runtime == "cloudfront-js-2.0" && aws_cloudfront_function.session_check.publish
    error_message = "session-check must run on cloudfront-js-2.0 and be published."
  }
  assert {
    condition     = aws_cloudfront_function.session_check.key_value_store_associations == toset([aws_cloudfront_key_value_store.session.arn])
    error_message = "The function is associated with the session KVS."
  }
  assert {
    condition     = strcontains(aws_cloudfront_function.session_check.code, "import cf from 'cloudfront';") && length(aws_cloudfront_function.session_check.code) < 10240
    error_message = "Built function code (< 10 KB) is deployed."
  }
}

run "response_headers" {
  command = apply
  assert {
    condition = alltrue([for p in [aws_cloudfront_response_headers_policy.app, aws_cloudfront_response_headers_policy.data] :
      p.security_headers_config[0].strict_transport_security[0].access_control_max_age_sec == 63072000 &&
      p.security_headers_config[0].strict_transport_security[0].include_subdomains &&
      p.security_headers_config[0].content_type_options[0].override &&
      p.security_headers_config[0].frame_options[0].frame_option == "DENY" &&
      p.security_headers_config[0].referrer_policy[0].referrer_policy == "strict-origin-when-cross-origin"
    ])
    error_message = "HSTS 2y, nosniff, frame DENY, strict-origin-when-cross-origin on both policies."
  }
  assert {
    condition = alltrue([for p in [aws_cloudfront_response_headers_policy.app, aws_cloudfront_response_headers_policy.data] :
      p.security_headers_config[0].content_security_policy[0].content_security_policy == "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    ])
    error_message = "CSP from plan §D on both policies."
  }
  assert {
    condition     = one([for i in aws_cloudfront_response_headers_policy.data.custom_headers_config[0].items : i if i.header == "Cache-Control"]).value == "private, no-cache"
    error_message = "/data responses: Cache-Control private, no-cache."
  }
  assert {
    condition     = one([for i in aws_cloudfront_response_headers_policy.data.custom_headers_config[0].items : i if i.header == "Cache-Control"]).override
    error_message = "Cache-Control must override the S3 value."
  }
  assert {
    condition     = length([for i in aws_cloudfront_response_headers_policy.app.custom_headers_config[0].items : i if i.header == "Cache-Control"]) == 0
    error_message = "The app policy must not force Cache-Control (hashed assets are immutable)."
  }
}

run "data_cache_key_excludes_cookies" {
  command = apply
  assert {
    condition = (
      aws_cloudfront_cache_policy.data.parameters_in_cache_key_and_forwarded_to_origin[0].cookies_config[0].cookie_behavior == "none" &&
      aws_cloudfront_cache_policy.data.parameters_in_cache_key_and_forwarded_to_origin[0].headers_config[0].header_behavior == "none" &&
      aws_cloudfront_cache_policy.data.parameters_in_cache_key_and_forwarded_to_origin[0].query_strings_config[0].query_string_behavior == "none"
    )
    error_message = "Cookies/headers/query strings must not be in the /data cache key."
  }
}

run "rejects_oversized_function" {
  command = plan
  variables {
    function_code = format("%011000d", 0)
  }
  expect_failures = [var.function_code]
}
