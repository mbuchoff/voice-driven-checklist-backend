output "function_name" {
  description = "Placeholder Lambda name; null before an environment has a runtime baseline."
  value       = var.deploy_runtime ? one(aws_lambda_function.placeholder).function_name : null
}

output "active_alias" {
  description = "Active Lambda alias; null before an environment has a runtime baseline."
  value       = var.deploy_runtime ? one(aws_lambda_alias.active).name : null
}
