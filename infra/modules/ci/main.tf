# GitHub Actions OIDC: no static keys. One role for the app repo (app bucket only) and one
# role per dataset repo (data/<id>/* only). Trust policy as documented in
# https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services

locals {
  oidc_host         = "token.actions.githubusercontent.com"
  oidc_provider_arn = "arn:aws:iam::${var.account_id}:oidc-provider/${local.oidc_host}"
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : local.oidc_provider_arn

  trust = {
    for k, subs in merge(
      { app = var.app_oidc_subjects },
      { for id, d in var.datasets : "ds-${id}" => coalesce(d.oidc_subjects, ["repo:${d.repo}:environment:${var.dataset_environment}"]) },
      ) : k => {
      Version = "2012-10-17"
      Statement = [{
        Effect    = "Allow"
        Principal = { Federated = local.provider_arn }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "${local.oidc_host}:aud" = "sts.amazonaws.com"
            "${local.oidc_host}:sub" = subs
          }
        }
      }]
    }
  }

  invalidation = {
    Sid      = "Invalidate"
    Effect   = "Allow"
    Action   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    Resource = [var.distribution_arn]
  }

  app_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListAppBucket"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [var.app_bucket_arn]
      },
      {
        Sid      = "WriteAppObjects"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
        Resource = ["${var.app_bucket_arn}/*"]
      },
      local.invalidation,
    ]
  }

  dataset_policies = {
    for id, d in var.datasets : id => {
      Version = "2012-10-17"
      Statement = [
        {
          Sid      = "ListOwnPrefix"
          Effect   = "Allow"
          Action   = ["s3:ListBucket"]
          Resource = [var.data_bucket_arn]
          Condition = {
            StringLike = { "s3:prefix" = ["data/${id}/", "data/${id}/*"] }
          }
        },
        {
          Sid      = "WriteOwnPrefix"
          Effect   = "Allow"
          Action   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
          Resource = ["${var.data_bucket_arn}/data/${id}/*"]
        },
        local.invalidation,
      ]
    }
  }
}

resource "aws_iam_role" "app" {
  name                 = "${var.name_prefix}-app-publisher"
  description          = "GitHub Actions ${var.app_repo}: deploy the SPA to the app bucket"
  assume_role_policy   = jsonencode(local.trust.app)
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "app" {
  name   = "publish-app"
  role   = aws_iam_role.app.id
  policy = jsonencode(local.app_policy)
}

resource "aws_iam_role" "dataset" {
  for_each             = var.datasets
  name                 = "${var.name_prefix}-ds-${each.key}-publisher"
  description          = "GitHub Actions ${each.value.repo}: publish data/${each.key}/"
  assume_role_policy   = jsonencode(local.trust["ds-${each.key}"])
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "dataset" {
  for_each = var.datasets
  name     = "publish-${each.key}"
  role     = aws_iam_role.dataset[each.key].id
  policy   = jsonencode(local.dataset_policies[each.key])
}
