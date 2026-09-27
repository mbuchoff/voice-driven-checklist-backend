mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "198771014193"
    }
  }

  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:us-east-1:198771014193:log-group:/aws/mock"
    }
  }

  mock_resource "aws_apigatewayv2_api" {
    defaults = {
      api_endpoint  = "https://example.execute-api.us-east-1.amazonaws.com"
      execution_arn = "arn:aws:execute-api:us-east-1:198771014193:example"
    }
  }
}

variables {
  artifact_digest          = "ASNFZ4mrze8BI0VniavN7wJEn06J1JtAAAS01jL84Vg="
  artifact_sha256          = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  artifact_path            = "tests/fixtures/placeholder.zip"
  aws_region               = "us-east-1"
  cognito_client_ids       = ["android-client", "web-client"]
  cognito_user_pool_id     = "us-east-1_06KAQuIlH"
  commit_sha               = "0123456789abcdef0123456789abcdef01234567"
  cors_allowed_origins     = ["http://localhost:4014"]
  deployment_url           = "https://github.com/mbuchoff/voice-driven-checklist-backend/deployments/development"
  mongodb_database         = "voice_checklist_dev"
  mongodb_uri              = "mongodb+srv://example.mongodb.net/"
  permissions_boundary_arn = "arn:aws:iam::198771014193:policy/voice-checklist-development-runtime-boundary"
  powersync_endpoint       = "https://development.powersync.example"
  powersync_jwt_issuer     = "https://api.example.test"
  powersync_jwt_key_id     = "development-1"
  runtime_secret_version   = 42
}

run "development_runtime_contract" {
  command = plan

  variables {
    environment = "development"
  }

  assert {
    condition = (
      length(aws_lambda_function.placeholder) == 1 &&
      one(aws_lambda_function.placeholder).runtime == "nodejs24.x" &&
      one(aws_lambda_function.placeholder).publish == true &&
      toset(one(aws_lambda_function.placeholder).architectures) == toset(["arm64"]) &&
      one(aws_lambda_function.placeholder).environment[0].variables.COGNITO_USER_POOL_ID == "us-east-1_06KAQuIlH" &&
      one(aws_lambda_function.placeholder).environment[0].variables.RUNTIME_SECRET_PARAMETER_NAME == "/voice-checklist/development/runtime" &&
      one(aws_lambda_function.placeholder).environment[0].variables.RUNTIME_SECRET_VERSION == "42" &&
      strcontains(one(aws_lambda_function.placeholder).description, var.commit_sha) &&
      strcontains(one(aws_lambda_function.placeholder).description, var.deployment_url)
    )
    error_message = "Development must publish the harmless Node.js 24 ARM Lambda artifact."
  }

  assert {
    condition = (
      length(aws_apigatewayv2_api.backend) == 1 &&
      one(aws_apigatewayv2_api.backend).protocol_type == "HTTP" &&
      length(aws_apigatewayv2_stage.default) == 1 &&
      one(aws_apigatewayv2_stage.default).auto_deploy == true &&
      one(aws_apigatewayv2_stage.default).default_route_settings[0].throttling_burst_limit == 20 &&
      one(aws_apigatewayv2_stage.default).default_route_settings[0].throttling_rate_limit == 10 &&
      length(aws_apigatewayv2_route.backend) == 3 &&
      length(aws_lambda_permission.api) == 1
    )
    error_message = "Development must expose only the declared HTTP API routes through the active Lambda alias."
  }

  assert {
    condition = (
      strcontains(aws_iam_role_policy.placeholder[0].policy, "ssm:GetParameter") &&
      strcontains(aws_iam_role_policy.placeholder[0].policy, "/voice-checklist/development/runtime")
    )
    error_message = "The runtime role may read only its environment-scoped SSM secret."
  }

  assert {
    condition = (
      length(aws_lambda_alias.active) == 1 &&
      one(aws_lambda_alias.active).name == "active" &&
      strcontains(one(aws_lambda_alias.active).description, var.commit_sha) &&
      strcontains(one(aws_lambda_alias.active).description, var.artifact_sha256)
    )
    error_message = "The active alias must identify the selected commit."
  }

  assert {
    condition = (
      length(aws_cloudwatch_log_group.placeholder) == 1 &&
      one(aws_cloudwatch_log_group.placeholder).retention_in_days == 30
    )
    error_message = "Development logs must be environment-scoped and retained for 30 days."
  }
}

run "production_has_no_placeholder_runtime" {
  command = plan

  variables {
    environment = "production"
  }

  assert {
    condition = (
      length(aws_lambda_function.placeholder) == 0 &&
      length(aws_lambda_alias.active) == 0 &&
      length(aws_cloudwatch_log_group.placeholder) == 0 &&
      length(aws_apigatewayv2_api.backend) == 0 &&
      length(aws_apigatewayv2_stage.default) == 0 &&
      length(aws_lambda_permission.api) == 0
    )
    error_message = "Issue #28 must not establish a production Lambda baseline."
  }
}

run "rejects_query_in_cors_origin" {
  command = plan

  variables {
    environment          = "development"
    cors_allowed_origins = ["https://example.test?mistyped=true"]
  }

  expect_failures = [var.cors_allowed_origins]
}

run "rejects_credentials_in_cors_origin" {
  command = plan

  variables {
    environment          = "development"
    cors_allowed_origins = ["https://user@example.test"]
  }

  expect_failures = [var.cors_allowed_origins]
}

run "rejects_wildcard_cors_origin" {
  command = plan

  variables {
    environment          = "development"
    cors_allowed_origins = ["https://*.example.test"]
  }

  expect_failures = [var.cors_allowed_origins]
}

run "rejects_out_of_range_cors_port" {
  command = plan

  variables {
    environment          = "development"
    cors_allowed_origins = ["https://example.test:65536"]
  }

  expect_failures = [var.cors_allowed_origins]
}

run "rejects_unknown_environment" {
  command = plan

  variables {
    environment = "staging"
  }

  expect_failures = [var.environment]
}
