mock_provider "aws" {
  override_resource {
    target = aws_iam_openid_connect_provider.github
    values = { arn = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
  }
}

variables {
  name_prefix       = "quizzer-test"
  account_id        = "123456789012"
  app_repo          = "RedLicorice/directrev-quizzer"
  app_oidc_subjects = ["repo:RedLicorice/directrev-quizzer:environment:prod"]
  datasets = {
    "aws-dva-c02" = { repo = "RedLicorice/quizzer-dataset-aws-dva-c02" }
    "mule-mcd-01" = { repo = "RedLicorice/quizzer-dataset-mule-mcd-01" }
  }
  app_bucket_arn   = "arn:aws:s3:::quizzer-test-app-123456789012"
  data_bucket_arn  = "arn:aws:s3:::quizzer-test-data-123456789012"
  distribution_arn = "arn:aws:cloudfront::123456789012:distribution/E1TESTDIST"
}

run "oidc_trust" {
  command = apply
  assert {
    condition     = aws_iam_openid_connect_provider.github[0].url == "https://token.actions.githubusercontent.com" && aws_iam_openid_connect_provider.github[0].client_id_list == toset(["sts.amazonaws.com"])
    error_message = "GitHub OIDC provider with audience sts.amazonaws.com."
  }
  assert {
    condition = alltrue([for id in ["aws-dva-c02", "mule-mcd-01"] :
      jsondecode(aws_iam_role.dataset[id].assume_role_policy).Statement == [{
        Effect    = "Allow"
        Principal = { Federated = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com" }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = { StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = ["repo:RedLicorice/quizzer-dataset-${id}:environment:prod"]
        } }
      }]
    ])
    error_message = "Each dataset role trusts exactly repo:RedLicorice/quizzer-dataset-<id>:environment:prod (StringEquals, no wildcards)."
  }
  assert {
    condition     = jsondecode(aws_iam_role.app.assume_role_policy).Statement[0].Condition.StringEquals["token.actions.githubusercontent.com:sub"] == ["repo:RedLicorice/directrev-quizzer:environment:prod"]
    error_message = "App role trusts only the app repo prod environment."
  }
  assert {
    condition     = alltrue([for r in concat([aws_iam_role.app], values(aws_iam_role.dataset)) : !strcontains(r.assume_role_policy, "StringLike") && !strcontains(r.assume_role_policy, "*")])
    error_message = "No wildcard subjects."
  }
}

run "dataset_policies_limited_to_prefix" {
  command = apply
  assert {
    condition = alltrue([for id in ["aws-dva-c02", "mule-mcd-01"] :
      jsondecode(aws_iam_role_policy.dataset[id].policy).Statement == [
        { Sid = "ListOwnPrefix", Effect = "Allow", Action = ["s3:ListBucket"], Resource = ["arn:aws:s3:::quizzer-test-data-123456789012"],
        Condition = { StringLike = { "s3:prefix" = ["data/${id}/", "data/${id}/*"] } } },
        { Sid = "WriteOwnPrefix", Effect = "Allow", Action = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"], Resource = ["arn:aws:s3:::quizzer-test-data-123456789012/data/${id}/*"] },
        { Sid = "Invalidate", Effect = "Allow", Action = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"], Resource = ["arn:aws:cloudfront::123456789012:distribution/E1TESTDIST"] },
      ]
    ])
    error_message = "Dataset roles: only data/<id>/ of the data bucket + invalidations of this distribution."
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.dataset["aws-dva-c02"].policy, "mule-mcd-01") && !strcontains(aws_iam_role_policy.dataset["mule-mcd-01"].policy, "aws-dva-c02")
    error_message = "A dataset repo cannot touch the other dataset."
  }
  assert {
    condition     = !strcontains(aws_iam_role_policy.dataset["aws-dva-c02"].policy, "quizzer-test-app")
    error_message = "Dataset roles cannot touch the app bucket."
  }
}

run "app_policy_limited_to_app_bucket" {
  command = apply
  assert {
    condition     = alltrue([for s in jsondecode(aws_iam_role_policy.app.policy).Statement : alltrue([for r in s.Resource : startswith(r, "arn:aws:s3:::quizzer-test-app-123456789012") || r == "arn:aws:cloudfront::123456789012:distribution/E1TESTDIST"])])
    error_message = "App role: app bucket and the distribution only."
  }
  assert {
    condition = alltrue([for p in concat([aws_iam_role_policy.app.policy], [for k, v in aws_iam_role_policy.dataset : v.policy]) :
      alltrue([for s in jsondecode(p).Statement : alltrue([for a in s.Action : !strcontains(a, "*")]) && alltrue([for r in s.Resource : r != "*"])])
    ])
    error_message = "No wildcard actions and no Resource \"*\"."
  }
}

run "existing_oidc_provider" {
  command = apply
  variables {
    create_github_oidc_provider = false
  }
  assert {
    condition     = length(aws_iam_openid_connect_provider.github) == 0 && output.oidc_provider_arn == "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com"
    error_message = "Reuse the account's provider by ARN."
  }
}
