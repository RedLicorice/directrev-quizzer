# Cognito user pool (Essentials), invite-only, email sign-in, optional TOTP MFA,
# prefix domain with managed login v2, public app client with code + PKCE.

locals {
  app_url = coalesce(var.invite_app_url, "https://${var.app_domain}/")
}

resource "aws_cognito_user_pool" "this" {
  name                     = "${var.name_prefix}-users"
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = "ACTIVE"

  # Invite only: no self sign-up.
  admin_create_user_config {
    allow_admin_create_user_only = true
    invite_message_template {
      email_subject = "Invito a Quizzer"
      email_message = "Sei stato invitato a Quizzer: ${local.app_url}<br><br>Utente: {username}<br>Password temporanea: {####}<br><br>Al primo accesso ti verrà chiesto di scegliere una nuova password. Puoi attivare un'app di autenticazione (TOTP) come secondo fattore."
      sms_message   = "Quizzer: utente {username}, password temporanea {####}"
    }
  }

  # MFA optional, TOTP (software token) only: plan v3 deltas.
  mfa_configuration = "OPTIONAL"
  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
    password_history_size            = 0
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  username_configuration {
    case_sensitive = false
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cognito_user_pool_domain" "this" {
  domain                = var.domain_prefix
  user_pool_id          = aws_cognito_user_pool.this.id
  managed_login_version = 2

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cognito_user_pool_client" "app" {
  name         = "${var.name_prefix}-app"
  user_pool_id = aws_cognito_user_pool.this.id

  # Public client: the auth Lambda performs code + PKCE (S256) without a secret.
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${var.app_domain}/auth/callback"]
  logout_urls                          = ["https://${var.app_domain}/signed-out.html"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  read_attributes  = ["email", "email_verified", "name", "given_name"]
  write_attributes = ["name", "given_name"]
}

# Managed login v2 needs a style for the client, otherwise the hosted pages error out.
resource "aws_cognito_managed_login_branding" "app" {
  user_pool_id                = aws_cognito_user_pool.this.id
  client_id                   = aws_cognito_user_pool_client.app.id
  use_cognito_provided_values = true
}

resource "aws_cognito_user_group" "dataset" {
  for_each     = toset(var.dataset_ids)
  name         = "ds-${each.key}"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Access to /data/${each.key}/"
}

resource "aws_cognito_user_group" "all" {
  name         = "ds-all"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Access to every dataset (session ds = [\"*\"])"
}

resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.this.id
  description  = "Administrators (session adm = true)"
}
