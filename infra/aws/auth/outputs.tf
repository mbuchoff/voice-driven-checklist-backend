output "aws_region" {
  description = "Expo public Cognito Region."
  value       = var.aws_region
}

output "user_pool_id" {
  description = "Expo public Cognito user pool ID."
  value       = aws_cognito_user_pool.auth.id
}

output "cognito_domain" {
  description = "Expo public Cognito managed-login origin."
  value       = "https://${var.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com"
}

output "google_redirect_uri" {
  description = "The only redirect URI to register on the Google OAuth web client."
  value       = "https://${var.cognito_domain_prefix}.auth.${var.aws_region}.amazoncognito.com/oauth2/idpresponse"
}

output "android_client_id" {
  description = "Expo public Android app client ID."
  value = (
    var.environment == "development"
    ? aws_cognito_user_pool_client.app["android_debug"].id
    : aws_cognito_user_pool_client.app["android_play"].id
  )
}

output "web_client_id" {
  description = "Expo public localhost web client ID; null in production until web hosting is selected."
  value       = var.environment == "development" ? aws_cognito_user_pool_client.app["web_localhost"].id : null
}
