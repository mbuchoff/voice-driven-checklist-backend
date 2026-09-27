locals {
  function_name          = "voice-checklist-${var.environment}-placeholder"
  execution_role_arn     = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.function_name}"
  deployment_description = "commit ${var.commit_sha}; deployment ${var.deployment_url}"
  alias_description      = "commit ${var.commit_sha}; artifact ${var.artifact_sha256}"
  deploy_runtime         = var.environment == "development"
  runtime_secret_arn     = "arn:${data.aws_partition.current.partition}:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.runtime_secret_parameter_name}"
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

resource "aws_cloudwatch_log_group" "placeholder" {
  count = local.deploy_runtime ? 1 : 0

  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 30

  lifecycle {
    destroy = false
  }
}

resource "aws_cloudwatch_log_group" "api" {
  count = local.deploy_runtime ? 1 : 0

  name              = "/aws/apigateway/voice-checklist-${var.environment}-api"
  retention_in_days = 30

  lifecycle {
    destroy = false
  }
}

resource "aws_iam_role" "placeholder" {
  count = local.deploy_runtime ? 1 : 0

  name                 = local.function_name
  permissions_boundary = var.permissions_boundary_arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "placeholder" {
  count = local.deploy_runtime ? 1 : 0

  name = "cloudwatch-logs"
  role = local.function_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteFunctionLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "${one(aws_cloudwatch_log_group.placeholder).arn}:*"
      },
      {
        Sid      = "ReadRuntimeSecret"
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = local.runtime_secret_arn
      },
    ]
  })

  depends_on = [aws_iam_role.placeholder]
}

resource "aws_lambda_function" "placeholder" {
  count = local.deploy_runtime ? 1 : 0

  architectures    = ["arm64"]
  description      = local.deployment_description
  filename         = var.artifact_path
  function_name    = local.function_name
  handler          = "index.handler"
  memory_size      = 128
  publish          = true
  role             = local.execution_role_arn
  runtime          = "nodejs24.x"
  source_code_hash = var.artifact_digest
  timeout          = 10

  environment {
    variables = {
      COGNITO_CLIENT_IDS            = join(",", var.cognito_client_ids)
      COGNITO_USER_POOL_ID          = var.cognito_user_pool_id
      MONGODB_DATABASE              = var.mongodb_database
      MONGODB_URI                   = var.mongodb_uri
      POWERSYNC_ENDPOINT            = var.powersync_endpoint
      POWERSYNC_JWT_ISSUER          = var.powersync_jwt_issuer
      POWERSYNC_JWT_KID             = var.powersync_jwt_key_id
      RUNTIME_SECRET_PARAMETER_NAME = var.runtime_secret_parameter_name
    }
  }

  logging_config {
    log_format = "JSON"
  }

  depends_on = [aws_iam_role_policy.placeholder]
}

resource "aws_lambda_alias" "active" {
  count = local.deploy_runtime ? 1 : 0

  description      = local.alias_description
  function_name    = one(aws_lambda_function.placeholder).function_name
  function_version = one(aws_lambda_function.placeholder).version
  name             = "active"
}

resource "aws_apigatewayv2_api" "backend" {
  count = local.deploy_runtime ? 1 : 0

  name          = "voice-checklist-${var.environment}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["authorization", "content-type"]
    allow_methods = ["GET", "POST"]
    allow_origins = var.cors_allowed_origins
    max_age       = 300
  }

  lifecycle {
    destroy = false
  }
}

resource "aws_apigatewayv2_integration" "backend" {
  count = local.deploy_runtime ? 1 : 0

  api_id                 = one(aws_apigatewayv2_api.backend).id
  integration_type       = "AWS_PROXY"
  integration_uri        = one(aws_lambda_alias.active).invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

resource "aws_apigatewayv2_route" "backend" {
  for_each = local.deploy_runtime ? toset([
    "GET /.well-known/jwks.json",
    "GET /health",
    "POST /v1/powersync/credentials",
  ]) : toset([])

  api_id    = one(aws_apigatewayv2_api.backend).id
  route_key = each.value
  target    = "integrations/${one(aws_apigatewayv2_integration.backend).id}"
}

resource "aws_apigatewayv2_stage" "default" {
  count = local.deploy_runtime ? 1 : 0

  api_id      = one(aws_apigatewayv2_api.backend).id
  auto_deploy = true
  name        = "$default"

  access_log_settings {
    destination_arn = one(aws_cloudwatch_log_group.api).arn
    format = jsonencode({
      integrationStatus = "$context.integration.status"
      requestId         = "$context.requestId"
      responseLength    = "$context.responseLength"
      routeKey          = "$context.routeKey"
      status            = "$context.status"
    })
  }

  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }
}

resource "aws_lambda_permission" "api" {
  count = local.deploy_runtime ? 1 : 0

  action        = "lambda:InvokeFunction"
  function_name = one(aws_lambda_function.placeholder).function_name
  principal     = "apigateway.amazonaws.com"
  qualifier     = one(aws_lambda_alias.active).name
  source_arn    = "${one(aws_apigatewayv2_api.backend).execution_arn}/*/*"
  statement_id  = "AllowApiGatewayInvoke"
}
