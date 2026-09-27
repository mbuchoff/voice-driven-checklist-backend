output "function_name" {
  description = "Placeholder Lambda name; null before an environment has a runtime baseline."
  value       = local.deploy_runtime ? one(aws_lambda_function.placeholder).function_name : null
}

output "active_alias" {
  description = "Active Lambda alias; null before an environment has a runtime baseline."
  value       = local.deploy_runtime ? one(aws_lambda_alias.active).name : null
}

output "api_endpoint" {
  description = "Development HTTP API endpoint; null before an environment has a runtime baseline."
  value       = local.deploy_runtime ? one(aws_apigatewayv2_api.backend).api_endpoint : null
}

output "powersync_jwks_uri" {
  description = "Public JWKS URI for PowerSync custom authentication."
  value       = local.deploy_runtime ? "${one(aws_apigatewayv2_api.backend).api_endpoint}/.well-known/jwks.json" : null
}
