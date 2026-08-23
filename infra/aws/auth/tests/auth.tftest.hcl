mock_provider "aws" {}

override_data {
  target = data.aws_secretsmanager_secret_version.google_oauth
  values = {
    secret_string = "{\"client_id\":\"test-client.apps.googleusercontent.com\",\"client_secret\":\"test-secret\"}"
  }
}

variables {
  aws_region               = "us-east-1"
  cognito_domain_prefix    = "voice-checklist-test"
  google_oauth_secret_name = "voice-checklist/test/deployment/google-oauth"
}

run "development_auth_contract" {
  command = plan

  variables {
    environment = "development"
  }

  assert {
    condition = toset(keys(aws_cognito_user_pool_client.app)) == toset([
      "android_debug",
      "web_localhost",
    ])
    error_message = "Development must create separate Android debug and localhost web clients."
  }

  assert {
    condition     = aws_cognito_user_pool.auth.deletion_protection == "INACTIVE"
    error_message = "Development relies on OpenTofu and plan policy protection so deliberate replacement remains possible."
  }
}

run "production_auth_contract" {
  command = plan

  variables {
    environment = "production"
  }

  assert {
    condition     = toset(keys(aws_cognito_user_pool_client.app)) == toset(["android_play"])
    error_message = "Production must create only the Android Play client until web hosting is selected."
  }

  assert {
    condition     = aws_cognito_user_pool.auth.deletion_protection == "ACTIVE"
    error_message = "AWS deletion protection must remain active on the production user pool."
  }
}

run "secret_contract" {
  command = plan

  variables {
    environment = "development"
  }

  assert {
    condition = (
      aws_secretsmanager_secret.google_oauth.name == "voice-checklist/test/deployment/google-oauth" &&
      aws_secretsmanager_secret.google_oauth.recovery_window_in_days == 30
    )
    error_message = "The stack must own recoverable metadata for its environment-scoped Google OAuth secret."
  }

  assert {
    condition = (
      jsondecode(data.aws_secretsmanager_secret_version.google_oauth.secret_string).client_id == "test-client.apps.googleusercontent.com" &&
      jsondecode(data.aws_secretsmanager_secret_version.google_oauth.secret_string).client_secret == "test-secret"
    )
    error_message = "The deployment must retrieve the complete Google credential from AWS Secrets Manager."
  }
}

run "public_client_security_contract" {
  command = plan

  variables {
    environment = "development"
  }

  assert {
    condition = alltrue([
      for client in values(aws_cognito_user_pool_client.app) :
      client.generate_secret == false &&
      client.allowed_oauth_flows_user_pool_client == true &&
      toset(client.allowed_oauth_flows) == toset(["code"]) &&
      toset(client.supported_identity_providers) == toset(["Google"]) &&
      client.enable_token_revocation == true &&
      !contains(client.explicit_auth_flows, "ALLOW_REFRESH_TOKEN_AUTH")
    ])
    error_message = "Every app client must remain a revocable Google-only public code-flow client."
  }
}

run "rejects_unknown_environment" {
  command = plan

  variables {
    environment = "staging"
  }

  expect_failures = [var.environment]
}
