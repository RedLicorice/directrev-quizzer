# auth Lambda behind a Function URL (AuthType AWS_IAM) that only the CloudFront
# distribution can invoke (OAC). No Cognito ids in env vars: they come from SSM at runtime
# (breaks the client <-> distribution <-> function cycle, plan v2 §4.4).

locals {
  function_name = "${var.name_prefix}-auth"
  # ARN built from the name: no dependency on the aws_ssm_parameter resource.
  config_parameter_arn = "arn:aws:ssm:${var.region}:${var.account_id}:parameter${var.config_parameter_name}"
  log_group_arn        = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${local.function_name}"
}

resource "aws_cloudwatch_log_group" "auth" {
  #checkov:skip=CKV_AWS_158:logs contain no tokens or secrets; KMS would add cost and key management
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "auth" {
  name = "${local.function_name}-lambda"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.account_id } }
    }]
  })
}

locals {
  auth_policy = {
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = ["${local.log_group_arn}:*"]
      },
      {
        Sid      = "ReadConfig"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = [local.config_parameter_arn]
      },
      {
        # https://docs.aws.amazon.com/service-authorization/latest/reference/list_amazoncloudfrontkeyvaluestore.html
        Sid      = "ReadSessionKeys"
        Effect   = "Allow"
        Action   = ["cloudfront-keyvaluestore:GetKey", "cloudfront-keyvaluestore:DescribeKeyValueStore"]
        Resource = [var.kvs_arn]
      },
    ]
  }
}

resource "aws_iam_role_policy" "auth" {
  name   = "auth-least-privilege"
  role   = aws_iam_role.auth.id
  policy = jsonencode(local.auth_policy)
}

resource "aws_lambda_function" "auth" {
  #checkov:skip=CKV_AWS_116:synchronous invocations only (Function URL): a DLQ never receives anything
  #checkov:skip=CKV_AWS_117:no VPC: the function only calls public AWS/Cognito endpoints
  #checkov:skip=CKV_AWS_173:env vars hold no secrets (parameter name and KVS ARN); default AWS-managed encryption
  #checkov:skip=CKV_AWS_272:no code signing for a single-operator deployment
  #checkov:skip=CKV_AWS_50:no X-Ray tracing (cost/noise); structured logs in CloudWatch
  function_name                  = local.function_name
  description                    = "Quizzer /auth/*: Cognito PKCE login and session cookies"
  role                           = aws_iam_role.auth.arn
  runtime                        = "nodejs22.x"
  architectures                  = ["arm64"]
  handler                        = "index.handler"
  filename                       = var.auth_zip_path
  source_code_hash               = var.auth_zip_sha256
  memory_size                    = 256
  timeout                        = 10
  reserved_concurrent_executions = var.reserved_concurrency

  environment {
    variables = {
      CONFIG_PARAMETER = var.config_parameter_name
      KVS_ARN          = var.kvs_arn
      NODE_OPTIONS     = "--enable-source-maps"
    }
  }

  depends_on = [aws_cloudwatch_log_group.auth, aws_iam_role_policy.auth]
}

resource "aws_lambda_function_url" "auth" {
  function_name      = aws_lambda_function.auth.function_name
  authorization_type = "AWS_IAM"
}

# Both permissions are required for OAC on Lambda Function URLs:
# https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "AllowCloudFrontServicePrincipal"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.auth.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = var.distribution_arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id  = "AllowCloudFrontServicePrincipalInvokeFunction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth.function_name
  principal     = "cloudfront.amazonaws.com"
  source_arn    = var.distribution_arn
}
