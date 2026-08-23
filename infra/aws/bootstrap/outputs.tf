output "plan_role_arn" {
  description = "Read-only role used by trusted pull-request plans."
  value       = aws_iam_role.github_plan.arn
}

output "development_deploy_role_arn" {
  description = "Role used by the protected development GitHub environment."
  value       = aws_iam_role.github_development_deploy.arn
}

output "production_deploy_role_arn" {
  description = "Role reserved for the protected production GitHub environment."
  value       = aws_iam_role.github_production_deploy.arn
}

output "deployment_boundary_arn" {
  description = "Permissions boundary required on GitHub and runtime roles."
  value       = aws_iam_policy.deployment_boundary.arn
}
