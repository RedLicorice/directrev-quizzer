# Root module test with mock providers: no credentials, nothing is created.
# Wiring, dependency-cycle freedom (a plan/apply graph exists at all), SSM runtime config,
# budget and the GitHub variables the three repos need.
mock_provider "aws" {
  mock_resource "aws_cloudfront_key_value_store" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:key-value-store/0000-kvs" }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::123456789012:function/quizzer-prod-session-check" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/mock" }
  }
  mock_resource "aws_cognito_user_pool" {
    defaults = {
      id  = "eu-central-1_TESTPOOL"
      arn = "arn:aws:cognito-idp:eu-central-1:123456789012:userpool/eu-central-1_TESTPOOL"
    }
  }
  mock_resource "aws_cognito_user_pool_client" {
    defaults = { id = "testclientid123" }
  }
  mock_resource "aws_cloudfront_distribution" {
    defaults = {
      id          = "E1TESTDIST"
      arn         = "arn:aws:cloudfront::123456789012:distribution/E1TESTDIST"
      domain_name = "d111111abcdef8.cloudfront.net"
    }
  }
  mock_resource "aws_lambda_function" {
    defaults = { arn = "arn:aws:lambda:eu-central-1:123456789012:function:quizzer-prod-auth" }
  }
  mock_resource "aws_lambda_function_url" {
    defaults = { function_url = "https://abcdefghijklmnop.lambda-url.eu-central-1.on.aws/" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
  }
  mock_resource "aws_acm_certificate" {
    defaults = {
      arn = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555"
      domain_validation_options = [{
        domain_name           = "quizzer.gdago.space"
        resource_record_name  = "_aaaa.quizzer.gdago.space."
        resource_record_type  = "CNAME"
        resource_record_value = "_bbbb.acm-validations.aws."
      }]
    }
  }
  mock_resource "aws_acm_certificate_validation" {
    defaults = { certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/11111111-2222-3333-4444-555555555555" }
  }
}

mock_provider "archive" {
  mock_data "archive_file" {
    defaults = { output_base64sha256 = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=" }
  }
}

override_resource {
  target = module.site.aws_s3_bucket.app
  values = { arn = "arn:aws:s3:::quizzer-prod-app-123456789012" }
}

override_resource {
  target = module.site.aws_s3_bucket.data
  values = { arn = "arn:aws:s3:::quizzer-prod-data-123456789012" }
}

override_resource {
  target = module.site.aws_s3_bucket.logs
  values = { arn = "arn:aws:s3:::quizzer-prod-logs-123456789012" }
}

override_resource {
  target = module.ci.aws_iam_role.app
  values = { arn = "arn:aws:iam::123456789012:role/quizzer-prod-app-publisher" }
}

# Instance keys (dataset["aws-dva-c02"]) are not accepted as override targets by OpenTofu,
# so every dataset role gets the same mocked ARN here; per-dataset names and policies are
# asserted in modules/ci/tests.
override_resource {
  target = module.ci.aws_iam_role.dataset
  values = { arn = "arn:aws:iam::123456789012:role/quizzer-prod-ds-publisher" }
}

variables {
  account_id            = "123456789012"
  cognito_domain_prefix = "quizzer-x7k2"
  admin_email           = "owner@example.com"
  auth_lambda_dist_dir  = "tests"
  admin_lambda_dist_dir = "tests"
}

run "full_stack" {
  command = apply

  assert {
    condition = jsondecode(aws_ssm_parameter.config.value) == {
      userPoolId    = "eu-central-1_TESTPOOL"
      clientId      = "testclientid123"
      cognitoDomain = "quizzer-x7k2.auth.us-east-1.amazoncognito.com"
      region        = "us-east-1"
      appHosts      = ["d111111abcdef8.cloudfront.net"]
      datasets      = ["aws-dva-c02", "mule-mcd-01"]
      datasetRepos = {
        aws-dva-c02 = { repo = "RedLicorice/quizzer-dataset-aws-dva-c02", file = "questions.json" }
        mule-mcd-01 = { repo = "RedLicorice/quizzer-dataset-mule-mcd-01", file = "questions.json" }
      }
      sessionTtlSeconds = 1800
      refreshCookieDays = 30
    }
    error_message = "SSM runtime config must match CONTRACT.md §6."
  }
  assert {
    condition     = aws_ssm_parameter.config.name == "/quizzer/prod/config" && aws_ssm_parameter.config.type == "String"
    error_message = "Config parameter name/type (no secrets inside)."
  }
  assert {
    condition     = output.app_url == "https://d111111abcdef8.cloudfront.net/"
    error_message = "App URL on the default CloudFront domain."
  }
  assert {
    condition = output.github_variables == {
      "RedLicorice/directrev-quizzer" = {
        AWS_ROLE_ARN               = "arn:aws:iam::123456789012:role/quizzer-prod-app-publisher"
        AWS_REGION                 = "us-east-1"
        APP_BUCKET                 = "quizzer-prod-app-123456789012"
        CLOUDFRONT_DISTRIBUTION_ID = "E1TESTDIST"
      }
      "RedLicorice/quizzer-dataset-aws-dva-c02" = {
        AWS_ROLE_ARN               = "arn:aws:iam::123456789012:role/quizzer-prod-ds-publisher"
        AWS_REGION                 = "us-east-1"
        DATA_BUCKET                = "quizzer-prod-data-123456789012"
        CLOUDFRONT_DISTRIBUTION_ID = "E1TESTDIST"
      }
      "RedLicorice/quizzer-dataset-mule-mcd-01" = {
        AWS_ROLE_ARN               = "arn:aws:iam::123456789012:role/quizzer-prod-ds-publisher"
        AWS_REGION                 = "us-east-1"
        DATA_BUCKET                = "quizzer-prod-data-123456789012"
        CLOUDFRONT_DISTRIBUTION_ID = "E1TESTDIST"
      }
    }
    error_message = "GitHub variables for the app repo and each dataset repo."
  }
  assert {
    condition = (
      aws_budgets_budget.monthly.limit_amount == "5.00" &&
      aws_budgets_budget.monthly.limit_unit == "USD" &&
      aws_budgets_budget.monthly.time_unit == "MONTHLY" &&
      alltrue([for n in aws_budgets_budget.monthly.notification : n.subscriber_email_addresses == toset(["owner@example.com"])])
    )
    error_message = "Monthly 5 USD budget with e-mail alerts."
  }
  assert {
    condition     = output.kvs_arn == "arn:aws:cloudfront::123456789012:key-value-store/0000-kvs"
    error_message = "KVS ARN output (used by rotate-session-key.sh)."
  }
}

run "dev_workspace_names" {
  command = plan
  variables {
    environment = "dev"
  }
  assert {
    condition     = aws_ssm_parameter.config.name == "/quizzer/dev/config"
    error_message = "A second environment gets its own names."
  }
}

run "rejects_bad_account_id" {
  command = plan
  variables {
    account_id = "12345"
  }
  expect_failures = [var.account_id]
}

run "custom_domain" {
  command = apply
  variables {
    custom_domain = "quizzer.gdago.space"
  }

  assert {
    condition     = jsondecode(aws_ssm_parameter.config.value).appHosts == ["quizzer.gdago.space"]
    error_message = "With a custom domain only it is accepted as app host (the *.cloudfront.net host must not be)."
  }
  assert {
    condition     = output.app_url == "https://quizzer.gdago.space/"
    error_message = "App URL on the custom domain."
  }
  assert {
    condition = output.acm_validation_records == [{
      name  = "_aaaa.quizzer.gdago.space."
      type  = "CNAME"
      value = "_bbbb.acm-validations.aws."
    }]
    error_message = "Validation records are exposed for Cloudflare."
  }
  assert {
    condition     = output.cname_target == "d111111abcdef8.cloudfront.net"
    error_message = "CNAME target is the distribution domain."
  }
  assert {
    condition     = aws_acm_certificate.this[0].validation_method == "DNS"
    error_message = "ACM certificate uses DNS validation."
  }
  assert {
    condition     = aws_acm_certificate_validation.this[0].certificate_arn == aws_acm_certificate.this[0].arn
    error_message = "The distribution gets the validated certificate (certificate_arn), not the raw certificate."
  }
}

run "rejects_bad_custom_domain" {
  command = plan
  variables {
    custom_domain = "Quizzer.Gdago.Space"
  }
  expect_failures = [var.custom_domain]
}
