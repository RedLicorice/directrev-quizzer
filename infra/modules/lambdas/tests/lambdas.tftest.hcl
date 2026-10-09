mock_provider "aws" {
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::123456789012:role/quizzer-test-auth-lambda" }
  }
  override_resource {
    target = aws_lambda_function.auth
    values = { arn = "arn:aws:lambda:eu-central-1:123456789012:function:quizzer-test-auth" }
  }
}

variables {
  name_prefix           = "quizzer-test"
  account_id            = "123456789012"
  region                = "eu-central-1"
  auth_zip_path         = "auth.zip"
  auth_zip_sha256       = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU="
  config_parameter_name = "/quizzer/prod/config"
  kvs_arn               = "arn:aws:cloudfront::123456789012:key-value-store/0000-kvs"
  distribution_arn      = "arn:aws:cloudfront::123456789012:distribution/E1TESTDIST"
}

run "function" {
  command = apply
  assert {
    condition     = aws_lambda_function.auth.runtime == "nodejs22.x" && aws_lambda_function.auth.architectures == tolist(["arm64"]) && aws_lambda_function.auth.handler == "index.handler"
    error_message = "Node 22 on arm64."
  }
  assert {
    condition     = tomap(aws_lambda_function.auth.environment[0].variables) == tomap({ CONFIG_PARAMETER = "/quizzer/prod/config", KVS_ARN = "arn:aws:cloudfront::123456789012:key-value-store/0000-kvs", NODE_OPTIONS = "--enable-source-maps" })
    error_message = "Only the parameter name and KVS ARN in env: no Cognito ids (no dependency cycle), no secrets."
  }
  assert {
    condition     = aws_lambda_function_url.auth.authorization_type == "AWS_IAM"
    error_message = "Function URL must require IAM (OAC)."
  }
  assert {
    condition     = aws_cloudwatch_log_group.auth.retention_in_days == 90 && aws_cloudwatch_log_group.auth.name == "/aws/lambda/quizzer-test-auth"
    error_message = "Log group with 90 days retention."
  }
}

run "cloudfront_permissions" {
  command = apply
  assert {
    condition = (
      aws_lambda_permission.cloudfront_url.action == "lambda:InvokeFunctionUrl" &&
      aws_lambda_permission.cloudfront_url.principal == "cloudfront.amazonaws.com" &&
      aws_lambda_permission.cloudfront_url.source_arn == "arn:aws:cloudfront::123456789012:distribution/E1TESTDIST" &&
      aws_lambda_permission.cloudfront_url.function_url_auth_type == "AWS_IAM"
    )
    error_message = "InvokeFunctionUrl only for this distribution."
  }
  assert {
    condition = (
      aws_lambda_permission.cloudfront_invoke.action == "lambda:InvokeFunction" &&
      aws_lambda_permission.cloudfront_invoke.principal == "cloudfront.amazonaws.com" &&
      aws_lambda_permission.cloudfront_invoke.source_arn == "arn:aws:cloudfront::123456789012:distribution/E1TESTDIST"
    )
    error_message = "InvokeFunction only for this distribution."
  }
}

run "least_privilege" {
  command = apply
  assert {
    condition = jsondecode(aws_iam_role_policy.auth.policy).Statement == [
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = ["arn:aws:logs:eu-central-1:123456789012:log-group:/aws/lambda/quizzer-test-auth:*"] },
      { Sid = "ReadConfig", Effect = "Allow", Action = ["ssm:GetParameter"], Resource = ["arn:aws:ssm:eu-central-1:123456789012:parameter/quizzer/prod/config"] },
      { Sid = "ReadSessionKeys", Effect = "Allow", Action = ["cloudfront-keyvaluestore:GetKey", "cloudfront-keyvaluestore:DescribeKeyValueStore"], Resource = ["arn:aws:cloudfront::123456789012:key-value-store/0000-kvs"] },
    ]
    error_message = "auth Lambda policy: logs, one SSM parameter, the KVS. Nothing else."
  }
  assert {
    condition     = jsondecode(aws_iam_role.auth.assume_role_policy).Statement[0].Principal == { Service = "lambda.amazonaws.com" }
    error_message = "Only Lambda can assume the role."
  }
}
