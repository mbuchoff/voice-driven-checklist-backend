mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "198771014193"
    }
  }
}

variables {
  aws_region   = "us-east-1"
  repository  = "mbuchoff/voice-driven-checklist-backend"
  state_bucket = "voice-checklist-tofu-state-use1-198771014193"
}

run "github_oidc_contract" {
  command = plan

  assert {
    condition = (
      aws_iam_openid_connect_provider.github.url == "https://token.actions.githubusercontent.com" &&
      toset(aws_iam_openid_connect_provider.github.client_id_list) == toset(["sts.amazonaws.com"])
    )
    error_message = "GitHub Actions must authenticate through the repository-scoped OIDC provider."
  }

  assert {
    condition = alltrue([
      for role in [
        aws_iam_role.github_plan,
        aws_iam_role.github_development_deploy,
        aws_iam_role.github_production_deploy,
      ] : role.permissions_boundary == aws_iam_policy.deployment_boundary.arn
    ])
    error_message = "Every GitHub role must carry the deployment permissions boundary."
  }
}

run "repository_trust_contract" {
  command = plan

  assert {
    condition = (
      strcontains(aws_iam_role.github_plan.assume_role_policy, "repo:mbuchoff/voice-driven-checklist-backend:pull_request") &&
      strcontains(aws_iam_role.github_development_deploy.assume_role_policy, "repo:mbuchoff/voice-driven-checklist-backend:environment:development") &&
      strcontains(aws_iam_role.github_production_deploy.assume_role_policy, "repo:mbuchoff/voice-driven-checklist-backend:environment:production")
    )
    error_message = "Each role must trust only the intended repository context."
  }
}

run "production_cognito_delete_deny_contract" {
  command = plan

  assert {
    condition = alltrue([
      for action in [
        "cognito-idp:DeleteUserPool",
        "cognito-idp:DeleteUserPoolClient",
      ] : strcontains(aws_iam_role_policy.production_deploy.policy, action)
    ])
    error_message = "The production deployment role must explicitly deny deletion of Cognito pools and clients."
  }

  assert {
    condition = (
      strcontains(aws_iam_policy.deployment_boundary.policy, "iam:PutRolePolicy") &&
      strcontains(aws_iam_policy.deployment_boundary.policy, "iam:AttachRolePolicy") &&
      strcontains(aws_iam_policy.deployment_boundary.policy, "iam:PutRolePermissionsBoundary")
    )
    error_message = "The boundary must deny GitHub roles the ability to rewrite their policies or boundary."
  }
}
