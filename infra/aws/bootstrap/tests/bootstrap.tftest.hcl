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
  aws_region          = "us-east-1"
  repository          = "mbuchoff/voice-driven-checklist-backend"
  repository_id       = 1344113852
  repository_owner_id = 13501758
  state_bucket        = "voice-checklist-tofu-state-use1-198771014193"
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
      ] : role.permissions_boundary == "arn:aws:iam::198771014193:policy/voice-checklist-github-deployment-boundary"
    ])
    error_message = "Every GitHub role must carry the deployment permissions boundary."
  }
}

run "repository_trust_contract" {
  command = plan

  assert {
    condition = (
      strcontains(aws_iam_role.github_plan.assume_role_policy, "repo:mbuchoff@13501758/voice-driven-checklist-backend@1344113852:pull_request") &&
      strcontains(aws_iam_role.github_development_deploy.assume_role_policy, "repo:mbuchoff@13501758/voice-driven-checklist-backend@1344113852:environment:development") &&
      strcontains(aws_iam_role.github_production_deploy.assume_role_policy, "repo:mbuchoff@13501758/voice-driven-checklist-backend@1344113852:environment:production")
    )
    error_message = "Each role must trust only the intended repository context."
  }

  assert {
    condition = alltrue([
      for role in [
        aws_iam_role.github_development_deploy,
        aws_iam_role.github_production_deploy,
      ] : (
        strcontains(role.assume_role_policy, "token.actions.githubusercontent.com:ref") &&
        strcontains(role.assume_role_policy, "refs/heads/main") &&
        strcontains(role.assume_role_policy, "token.actions.githubusercontent.com:repository_id") &&
        strcontains(role.assume_role_policy, "token.actions.githubusercontent.com:repository_owner_id")
      )
    ])
    error_message = "Deployment roles must trust only the main-owned workflow in the immutable repository identity."
  }
}

run "plan_secret_read_contract" {
  command = plan

  assert {
    condition     = strcontains(aws_iam_role_policy.plan.policy, "secretsmanager:GetResourcePolicy")
    error_message = "The read-only plan role must be able to inspect managed secret resource policies."
  }
}

run "environment_isolation_contract" {
  command = plan

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.development_deploy.policy).Statement :
      statement.Sid != "ManageDevelopmentBackend" || (
        statement.Resource != "*" &&
        !strcontains(jsonencode(statement.Action), "dynamodb:") &&
        !strcontains(jsonencode(statement.Action), "sqs:") &&
        !strcontains(jsonencode(statement.Action), "apigateway:")
      )
    ])
    error_message = "Development backend mutations must be scoped to development resources that exist in this root."
  }

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.development_deploy.policy).Statement :
      !strcontains(jsonencode(statement.Resource), "voice-checklist-production-")
    ])
    error_message = "The development deployment role must not address production application resources."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_role_policy.development_deploy.policy).Statement :
      statement.Sid == "CreateDevelopmentRuntimeRoles" &&
      try(statement.Condition.StringEquals["iam:PermissionsBoundary"], "") == aws_iam_policy.runtime_boundary["development"].arn
    ])
    error_message = "Development runtime roles must be created with the exact least-privilege runtime boundary."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_role_policy.development_deploy.policy).Statement :
      statement.Sid == "PassDevelopmentRuntimeRoles" &&
      try(statement.Condition.StringEquals["iam:PassedToService"], "") == "lambda.amazonaws.com"
    ])
    error_message = "Development roles may be passed only to Lambda."
  }

  assert {
    condition = alltrue([
      for environment, boundary in aws_iam_policy.runtime_boundary :
      !strcontains(boundary.policy, "\"Action\":\"*\"") &&
      !strcontains(boundary.policy, "\"Resource\":\"*\"")
    ])
    error_message = "Runtime permissions boundaries must be explicit least-privilege ceilings."
  }
}

run "state_object_retention_contract" {
  command = plan

  assert {
    condition = alltrue(flatten([
      for policy in [
        aws_iam_role_policy.development_deploy.policy,
        aws_iam_role_policy.production_deploy.policy,
      ] : [
        for statement in jsondecode(policy).Statement :
        !strcontains(jsonencode(statement.Action), "s3:DeleteObject") ||
        alltrue([
          for resource in try(tolist(statement.Resource), [statement.Resource]) :
          endswith(resource, ".tflock")
        ])
      ]
    ]))
    error_message = "Deployment roles may delete state lock files, never state objects."
  }
}

run "production_deployment_secret_contract" {
  command = plan

  assert {
    condition = alltrue([
      for statement in jsondecode(aws_iam_role_policy.production_deploy.policy).Statement :
      statement.Sid != "ReadProductionDeploymentSecret" || (
        !strcontains(jsonencode(statement.Action), "secretsmanager:PutSecretValue") &&
        !strcontains(jsonencode(statement.Action), "secretsmanager:UpdateSecret") &&
        !strcontains(jsonencode(statement.Action), "secretsmanager:CreateSecret") &&
        !strcontains(jsonencode(statement.Action), "secretsmanager:RestoreSecret")
      )
    ])
    error_message = "The production deployment role may read, but never write, the externally seeded Google credential."
  }
}

run "production_cognito_delete_deny_contract" {
  command = plan

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_role_policy.production_deploy.policy).Statement :
      statement.Effect == "Deny" &&
      contains(statement.Action, "cognito-idp:DeleteUserPool") &&
      contains(statement.Action, "cognito-idp:DeleteUserPoolClient")
    ])
    error_message = "The production deployment role must explicitly deny deletion of Cognito pools and clients."
  }

  assert {
    condition = anytrue([
      for statement in jsondecode(aws_iam_policy.deployment_boundary.policy).Statement :
      statement.Effect == "Deny" &&
      contains(statement.Action, "iam:PutRolePolicy") &&
      contains(statement.Action, "iam:AttachRolePolicy") &&
      contains(statement.Action, "iam:PutRolePermissionsBoundary")
    ])
    error_message = "The boundary must deny GitHub roles the ability to rewrite their policies or boundary."
  }
}
