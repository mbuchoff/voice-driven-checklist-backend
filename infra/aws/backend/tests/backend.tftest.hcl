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
}

variables {
  artifact_digest          = "ASNFZ4mrze8BI0VniavN7wJEn06J1JtAAAS01jL84Vg="
  artifact_sha256          = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  artifact_path            = "tests/fixtures/placeholder.zip"
  aws_region               = "us-east-1"
  commit_sha               = "0123456789abcdef0123456789abcdef01234567"
  deployment_url           = "https://github.com/mbuchoff/voice-driven-checklist-backend/deployments/development"
  permissions_boundary_arn = "arn:aws:iam::198771014193:policy/voice-checklist-development-runtime-boundary"
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
      strcontains(one(aws_lambda_function.placeholder).description, var.commit_sha) &&
      strcontains(one(aws_lambda_function.placeholder).description, var.deployment_url)
    )
    error_message = "Development must publish the harmless Node.js 24 ARM Lambda artifact."
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
      length(aws_cloudwatch_log_group.placeholder) == 0
    )
    error_message = "Issue #28 must not establish a production Lambda baseline."
  }
}

run "rejects_unknown_environment" {
  command = plan

  variables {
    environment = "staging"
  }

  expect_failures = [var.environment]
}
