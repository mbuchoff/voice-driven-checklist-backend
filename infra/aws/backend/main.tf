locals {
  function_name          = "voice-checklist-${var.environment}-placeholder"
  execution_role_arn     = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${local.function_name}"
  deployment_description = "commit ${var.commit_sha}; deployment ${var.deployment_url}"
  alias_description      = "commit ${var.commit_sha}; artifact ${var.artifact_sha256}"
  deploy_runtime         = var.environment == "development"
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
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ]
      Resource = "${one(aws_cloudwatch_log_group.placeholder).arn}:*"
    }]
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
