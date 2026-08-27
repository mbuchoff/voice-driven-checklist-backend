locals {
  name_prefix = "voice-checklist-${var.environment}"

  development_clients = {
    android_debug = {
      callback_urls = ["voicechecklist://auth/callback"]
    }
    web_localhost = {
      callback_urls = ["http://localhost:8082/auth/callback"]
    }
  }

  production_clients = {
    android_play = {
      callback_urls = ["voicechecklist://auth/callback"]
    }
  }

  clients      = var.environment == "development" ? local.development_clients : local.production_clients
  google_oauth = jsondecode(data.aws_secretsmanager_secret_version.google_oauth.secret_string)
}

resource "aws_secretsmanager_secret" "google_oauth" {
  name                    = var.google_oauth_secret_name
  description             = "Google OAuth web credential for Voice Checklist ${var.environment} authentication"
  recovery_window_in_days = 30
  tags = {
    Repository = "mbuchoff/voice-driven-checklist-backend"
  }

  lifecycle {
    destroy = false
  }
}

data "aws_secretsmanager_secret_version" "google_oauth" {
  secret_id = var.google_oauth_secret_name
}

resource "aws_cognito_user_pool" "auth" {
  name                = local.name_prefix
  deletion_protection = var.environment == "production" ? "ACTIVE" : "INACTIVE"
  mfa_configuration   = "OFF"
  user_pool_tier      = "ESSENTIALS"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  username_configuration {
    case_sensitive = false
  }

  lifecycle {
    destroy = false
  }
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.auth.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
    attributes_url_add_attributes = "true"
    authorize_scopes              = "openid email profile"
    authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
    client_id                     = nonsensitive(local.google_oauth.client_id)
    client_secret                 = local.google_oauth.client_secret
    oidc_issuer                   = "https://accounts.google.com"
    token_request_method          = "POST"
    token_url                     = "https://www.googleapis.com/oauth2/v4/token"
  }

  attribute_mapping = {
    email    = "email"
    name     = "name"
    username = "sub"
  }

  lifecycle {
    destroy = false
  }
}

resource "aws_cognito_user_pool_domain" "auth" {
  domain                = var.cognito_domain_prefix
  managed_login_version = 2
  user_pool_id          = aws_cognito_user_pool.auth.id

  lifecycle {
    destroy = false
  }
}

resource "aws_cognito_user_pool_client" "app" {
  for_each = local.clients

  name         = "${local.name_prefix}-${each.key}"
  user_pool_id = aws_cognito_user_pool.auth.id

  access_token_validity  = 60
  id_token_validity      = 60
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  refresh_token_rotation {
    feature                    = "ENABLED"
    retry_grace_period_seconds = 10
  }

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes = [
    "openid",
    "email",
    "profile",
    "aws.cognito.signin.user.admin",
  ]
  callback_urls                = each.value.callback_urls
  default_redirect_uri         = each.value.callback_urls[0]
  supported_identity_providers = [aws_cognito_identity_provider.google.provider_name]

  enable_token_revocation       = true
  explicit_auth_flows           = ["ALLOW_USER_AUTH"]
  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  read_attributes               = ["email", "name"]

  lifecycle {
    destroy = false
  }
}

resource "aws_cognito_managed_login_branding" "app" {
  for_each = aws_cognito_user_pool_client.app

  client_id                   = each.value.id
  user_pool_id                = aws_cognito_user_pool.auth.id
  use_cognito_provided_values = true

  depends_on = [aws_cognito_user_pool_domain.auth]
}
