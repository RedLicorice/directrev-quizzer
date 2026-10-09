mock_provider "aws" {
  mock_resource "aws_cognito_user_pool" {
    defaults = {
      id  = "eu-central-1_TESTPOOL"
      arn = "arn:aws:cognito-idp:eu-central-1:123456789012:userpool/eu-central-1_TESTPOOL"
    }
  }
}

variables {
  name_prefix   = "quizzer-test"
  region        = "eu-central-1"
  domain_prefix = "quizzer-x7k2"
  app_domain    = "d111111abcdef8.cloudfront.net"
  dataset_ids   = ["aws-dva-c02", "mule-mcd-01"]
}

run "user_pool" {
  command = apply
  assert {
    condition     = aws_cognito_user_pool.this.admin_create_user_config[0].allow_admin_create_user_only
    error_message = "Invite only: admin-create-user only, no self sign-up."
  }
  assert {
    condition     = aws_cognito_user_pool.this.mfa_configuration == "OPTIONAL" && aws_cognito_user_pool.this.software_token_mfa_configuration[0].enabled
    error_message = "MFA OPTIONAL with TOTP."
  }
  assert {
    condition     = length(aws_cognito_user_pool.this.sms_configuration) == 0 && length(coalesce(aws_cognito_user_pool.this.web_authn_configuration, [])) == 0
    error_message = "No SMS MFA, no passkeys (plan v3)."
  }
  assert {
    condition     = aws_cognito_user_pool.this.user_pool_tier == "ESSENTIALS" && aws_cognito_user_pool.this.username_attributes == toset(["email"])
    error_message = "Essentials tier, e-mail sign-in."
  }
  assert {
    condition     = aws_cognito_user_pool.this.deletion_protection == "ACTIVE"
    error_message = "Deletion protection on."
  }
  assert {
    condition     = strcontains(aws_cognito_user_pool.this.admin_create_user_config[0].invite_message_template[0].email_message, "https://d111111abcdef8.cloudfront.net/") && strcontains(aws_cognito_user_pool.this.admin_create_user_config[0].invite_message_template[0].email_message, "{####}")
    error_message = "Invitation contains the app URL and the temporary password placeholder."
  }
  assert {
    condition     = aws_cognito_user_pool_domain.this.domain == "quizzer-x7k2" && aws_cognito_user_pool_domain.this.managed_login_version == 2
    error_message = "Prefix domain, managed login v2."
  }
  assert {
    condition     = output.cognito_domain == "quizzer-x7k2.auth.eu-central-1.amazoncognito.com"
    error_message = "cognito_domain output."
  }
}

run "client" {
  command = apply
  assert {
    condition = (
      aws_cognito_user_pool_client.app.generate_secret == false &&
      aws_cognito_user_pool_client.app.allowed_oauth_flows == toset(["code"]) &&
      aws_cognito_user_pool_client.app.allowed_oauth_flows_user_pool_client &&
      aws_cognito_user_pool_client.app.allowed_oauth_scopes == toset(["openid", "email", "profile"])
    )
    error_message = "Public client, authorization code only (PKCE enforced by the Lambda)."
  }
  assert {
    condition     = aws_cognito_user_pool_client.app.callback_urls == toset(["https://d111111abcdef8.cloudfront.net/auth/callback"]) && aws_cognito_user_pool_client.app.logout_urls == toset(["https://d111111abcdef8.cloudfront.net/signed-out.html"])
    error_message = "Callback/logout URLs from the distribution domain."
  }
  assert {
    condition     = aws_cognito_user_pool_client.app.enable_token_revocation && aws_cognito_user_pool_client.app.prevent_user_existence_errors == "ENABLED"
    error_message = "Token revocation and user existence protection."
  }
  assert {
    condition     = aws_cognito_user_pool_client.app.refresh_token_validity == 30 && aws_cognito_user_pool_client.app.token_validity_units[0].refresh_token == "days"
    error_message = "Refresh token 30 days."
  }
  assert {
    condition     = !contains(tolist(aws_cognito_user_pool_client.app.explicit_auth_flows), "ALLOW_USER_PASSWORD_AUTH") && !contains(tolist(aws_cognito_user_pool_client.app.explicit_auth_flows), "ALLOW_ADMIN_USER_PASSWORD_AUTH")
    error_message = "No plain password auth flows."
  }
  assert {
    condition     = aws_cognito_managed_login_branding.app.use_cognito_provided_values
    error_message = "Managed login v2 needs a branding style."
  }
}

run "groups" {
  command = apply
  assert {
    condition     = toset(output.group_names) == toset(["ds-aws-dva-c02", "ds-mule-mcd-01", "ds-all", "admin"])
    error_message = "Groups ds-<id>, ds-all, admin."
  }
}

run "rejects_bad_prefix" {
  command = plan
  variables {
    domain_prefix = "my-aws-login"
  }
  expect_failures = [var.domain_prefix]
}
