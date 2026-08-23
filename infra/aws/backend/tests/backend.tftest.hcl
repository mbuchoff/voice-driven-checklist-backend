mock_provider "aws" {}

variables {
  artifact_digest = "ASNFZ4mrze8BI0VniavN7wJEn06J1JtAAAS01jL84Vg="
  artifact_path   = "tests/fixtures/placeholder.zip"
  aws_region      = "us-east-1"
  commit_sha      = "0123456789abcdef0123456789abcdef01234567"
}

run "development_runtime_contract" {
  command = plan

  variables {
    deploy_runtime = true
    environment    = "development"
  }

  assert {
    condition = (
      length(aws_lambda_function.placeholder) == 1 &&
      one(aws_lambda_function.placeholder).runtime == "nodejs24.x" &&
      one(aws_lambda_function.placeholder).publish == true &&
      toset(one(aws_lambda_function.placeholder).architectures) == toset(["arm64"])
    )
    error_message = "Development must publish the harmless Node.js 24 ARM Lambda artifact."
  }

  assert {
    condition = (
      length(aws_lambda_alias.active) == 1 &&
      one(aws_lambda_alias.active).name == "active" &&
      one(aws_lambda_alias.active).description == "commit 0123456789abcdef0123456789abcdef01234567"
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
    deploy_runtime = false
    environment    = "production"
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
    deploy_runtime = false
    environment    = "staging"
  }

  expect_failures = [var.environment]
}
