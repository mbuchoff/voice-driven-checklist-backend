data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  repository_parts   = split("/", var.repository)
  repository_subject = "${local.repository_parts[0]}@${var.repository_owner_id}/${local.repository_parts[1]}@${var.repository_id}"

  account_id    = data.aws_caller_identity.current.account_id
  partition     = data.aws_partition.current.partition
  boundary_name = "voice-checklist-github-deployment-boundary"
  boundary_arn  = "arn:${local.partition}:iam::${local.account_id}:policy/${local.boundary_name}"
  runtime_boundary_names = {
    development = "voice-checklist-development-runtime-boundary"
    production  = "voice-checklist-production-runtime-boundary"
  }
  runtime_boundary_arns = {
    for environment, name in local.runtime_boundary_names :
    environment => "arn:${local.partition}:iam::${local.account_id}:policy/${name}"
  }
  github_provider_arn = "arn:${local.partition}:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com"
  state_bucket_arn    = "arn:${local.partition}:s3:::${var.state_bucket}"

  plan_state_objects = [
    "${local.state_bucket_arn}/voice-checklist/auth/development.tfstate",
    "${local.state_bucket_arn}/voice-checklist/auth/production.tfstate",
    "${local.state_bucket_arn}/voice-checklist/backend/development.tfstate",
    "${local.state_bucket_arn}/voice-checklist/backend/production.tfstate",
  ]

  google_oauth_secret_arns = [
    "arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:voice-checklist/development/deployment/google-oauth-*",
    "arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:voice-checklist/production/deployment/google-oauth-*",
  ]

  environment_state_objects = {
    development = [
      "${local.state_bucket_arn}/voice-checklist/backend/development.tfstate",
    ]
    production = [
      "${local.state_bucket_arn}/voice-checklist/auth/production.tfstate",
      "${local.state_bucket_arn}/voice-checklist/backend/production.tfstate",
    ]
  }

  environment_lock_objects = {
    development = [
      "${local.state_bucket_arn}/voice-checklist/backend/development.tfstate.tflock",
    ]
    production = [
      "${local.state_bucket_arn}/voice-checklist/auth/production.tfstate.tflock",
      "${local.state_bucket_arn}/voice-checklist/backend/production.tfstate.tflock",
    ]
  }

  environment_role_arns = [
    "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-github-*",
  ]

  persistent_delete_actions = [
    "cognito-idp:Delete*",
    "dynamodb:DeleteTable",
    "dynamodb:DeleteBackup",
    "dynamodb:DeleteTableReplica",
    "kms:DisableKey",
    "kms:ScheduleKeyDeletion",
    "logs:DeleteLogGroup",
    "logs:DeleteLogStream",
    "rds:DeleteDBCluster",
    "rds:DeleteDBInstance",
    "secretsmanager:DeleteSecret",
    "sqs:DeleteQueue",
    "sqs:PurgeQueue",
  ]

  role_policy_mutation_actions = [
    "iam:AttachRolePolicy",
    "iam:DeleteRole",
    "iam:DeleteRolePermissionsBoundary",
    "iam:DeleteRolePolicy",
    "iam:DetachRolePolicy",
    "iam:PutRolePermissionsBoundary",
    "iam:PutRolePolicy",
    "iam:UpdateAssumeRolePolicy",
  ]

  boundary_mutation_actions = [
    "iam:CreatePolicyVersion",
    "iam:DeletePolicy",
    "iam:DeletePolicyVersion",
    "iam:SetDefaultPolicyVersion",
  ]

  plan_permissions = [
    "cognito-idp:Describe*",
    "cognito-idp:Get*",
    "cognito-idp:List*",
    "iam:Get*",
    "iam:List*",
    "lambda:Get*",
    "lambda:List*",
    "logs:Describe*",
    "logs:Get*",
    "logs:List*",
    "sts:GetCallerIdentity",
  ]
}

resource "aws_iam_openid_connect_provider" "github" {
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
  ]
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_policy" "deployment_boundary" {
  name        = local.boundary_name
  description = "Maximum permissions for Voice Checklist GitHub and runtime roles"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowGrantedActions"
        Effect   = "Allow"
        Action   = "*"
        Resource = "*"
      },
      {
        Sid      = "DenyPersistentResourceDeletion"
        Effect   = "Deny"
        Action   = local.persistent_delete_actions
        Resource = "*"
      },
      {
        Sid    = "DenyApplicationObjectDeletion"
        Effect = "Deny"
        Action = [
          "s3:DeleteBucket",
          "s3:DeleteObject",
          "s3:DeleteObjectVersion",
        ]
        Resource = [
          "arn:${local.partition}:s3:::voice-checklist-development-*",
          "arn:${local.partition}:s3:::voice-checklist-development-*/*",
          "arn:${local.partition}:s3:::voice-checklist-production-*",
          "arn:${local.partition}:s3:::voice-checklist-production-*/*",
        ]
      },
      {
        Sid      = "DenyGitHubRolePolicyMutation"
        Effect   = "Deny"
        Action   = local.role_policy_mutation_actions
        Resource = local.environment_role_arns
      },
      {
        Sid      = "DenyBoundaryMutation"
        Effect   = "Deny"
        Action   = local.boundary_mutation_actions
        Resource = concat([local.boundary_arn], values(local.runtime_boundary_arns))
      },
    ]
  })
}

resource "aws_iam_policy" "runtime_boundary" {
  for_each = local.runtime_boundary_names

  name        = each.value
  description = "Maximum permissions for Voice Checklist ${each.key} runtime roles"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteEnvironmentLambdaLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:${local.partition}:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/voice-checklist-${each.key}-*:log-stream:*"
      },
    ]
  })
}

resource "aws_iam_role" "github_plan" {
  name                 = "voice-checklist-github-plan"
  permissions_boundary = local.boundary_arn
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.github_provider_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud"                 = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub"                 = "repo:${local.repository_subject}:environment:infrastructure-plan"
          "token.actions.githubusercontent.com:actor_id"            = tostring(var.trusted_actor_id)
          "token.actions.githubusercontent.com:repository_id"       = tostring(var.repository_id)
          "token.actions.githubusercontent.com:repository_owner_id" = tostring(var.repository_owner_id)
          "token.actions.githubusercontent.com:workflow"            = "Infrastructure Plan"
        }
      }
    }]
  })

  depends_on = [aws_iam_openid_connect_provider.github, aws_iam_policy.deployment_boundary]
}

resource "aws_iam_role_policy" "plan" {
  name = "read-only-plans"
  role = aws_iam_role.github_plan.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = local.plan_permissions
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetResourcePolicy",
          "secretsmanager:GetSecretValue",
          "secretsmanager:ListSecretVersionIds",
        ]
        Resource = local.google_oauth_secret_arns
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:GetObjectVersion",
        ]
        Resource = local.plan_state_objects
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = local.state_bucket_arn
        Condition = {
          StringLike = {
            "s3:prefix" = "voice-checklist/*"
          }
        }
      },
    ]
  })
}

resource "aws_iam_role" "github_development_deploy" {
  name                 = "voice-checklist-github-development-deploy"
  permissions_boundary = local.boundary_arn
  assume_role_policy   = local.development_assume_role_policy

  depends_on = [aws_iam_openid_connect_provider.github, aws_iam_policy.deployment_boundary]
}

resource "aws_iam_role" "github_production_deploy" {
  name                 = "voice-checklist-github-production-deploy"
  permissions_boundary = local.boundary_arn
  assume_role_policy   = local.production_assume_role_policy

  depends_on = [aws_iam_openid_connect_provider.github, aws_iam_policy.deployment_boundary]
}

locals {
  development_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.github_provider_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud"                 = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub"                 = "repo:${local.repository_subject}:environment:development"
          "token.actions.githubusercontent.com:actor_id"            = tostring(var.trusted_actor_id)
          "token.actions.githubusercontent.com:ref"                 = "refs/heads/main"
          "token.actions.githubusercontent.com:repository_id"       = tostring(var.repository_id)
          "token.actions.githubusercontent.com:repository_owner_id" = tostring(var.repository_owner_id)
        }
      }
    }]
  })

  production_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.github_provider_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud"                 = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub"                 = "repo:${local.repository_subject}:environment:production"
          "token.actions.githubusercontent.com:actor_id"            = tostring(var.trusted_actor_id)
          "token.actions.githubusercontent.com:ref"                 = "refs/heads/main"
          "token.actions.githubusercontent.com:repository_id"       = tostring(var.repository_id)
          "token.actions.githubusercontent.com:repository_owner_id" = tostring(var.repository_owner_id)
        }
      }
    }]
  })

  environment_read_actions = [
    "logs:DescribeLogGroups",
    "sts:GetCallerIdentity",
  ]

  log_group_management_actions = [
    "logs:CreateLogGroup",
    "logs:DeleteRetentionPolicy",
    "logs:ListTagsForResource",
    "logs:PutRetentionPolicy",
    "logs:TagResource",
    "logs:UntagResource",
  ]

  deployment_secret_read_actions = [
    "secretsmanager:DescribeSecret",
    "secretsmanager:GetResourcePolicy",
    "secretsmanager:GetSecretValue",
    "secretsmanager:ListSecretVersionIds",
  ]

  production_cognito_actions = [
    "cognito-idp:Create*",
    "cognito-idp:Describe*",
    "cognito-idp:Get*",
    "cognito-idp:List*",
    "cognito-idp:Set*",
    "cognito-idp:TagResource",
    "cognito-idp:UntagResource",
    "cognito-idp:Update*",
  ]

  iam_runtime_role_actions = [
    "iam:DeleteRole",
    "iam:DeleteRolePolicy",
    "iam:GetRole",
    "iam:GetRolePolicy",
    "iam:ListRolePolicies",
    "iam:PutRolePolicy",
    "iam:TagRole",
    "iam:UntagRole",
    "iam:UpdateAssumeRolePolicy",
    "iam:UpdateRole",
    "iam:UpdateRoleDescription",
  ]
}

resource "aws_iam_role_policy" "development_deploy" {
  name   = "development-backend-deploy"
  role   = aws_iam_role.github_development_deploy.name
  policy = local.development_deploy_policy
}

resource "aws_iam_role_policy" "production_deploy" {
  name   = "production-backend-deploy"
  role   = aws_iam_role.github_production_deploy.name
  policy = local.production_deploy_policy
}

locals {
  development_deploy_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadDevelopmentBackend"
        Effect   = "Allow"
        Action   = local.environment_read_actions
        Resource = "*"
      },
      {
        Sid      = "ManageDevelopmentBackend"
        Effect   = "Allow"
        Action   = "lambda:*"
        Resource = "arn:${local.partition}:lambda:${var.aws_region}:${local.account_id}:function:voice-checklist-development-*"
      },
      {
        Sid      = "ManageDevelopmentLogGroups"
        Effect   = "Allow"
        Action   = local.log_group_management_actions
        Resource = "arn:${local.partition}:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/voice-checklist-development-*"
      },
      {
        Sid      = "CreateDevelopmentRuntimeRoles"
        Effect   = "Allow"
        Action   = "iam:CreateRole"
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-development-*"
        Condition = {
          StringEquals = {
            "iam:PermissionsBoundary" = local.runtime_boundary_arns.development
          }
        }
      },
      {
        Sid      = "ManageDevelopmentRuntimeRoles"
        Effect   = "Allow"
        Action   = local.iam_runtime_role_actions
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-development-*"
      },
      {
        Sid      = "SetDevelopmentRuntimeBoundary"
        Effect   = "Allow"
        Action   = "iam:PutRolePermissionsBoundary"
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-development-*"
        Condition = {
          StringEquals = {
            "iam:PermissionsBoundary" = local.runtime_boundary_arns.development
          }
        }
      },
      {
        Sid      = "PassDevelopmentRuntimeRoles"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-development-*"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "lambda.amazonaws.com"
          }
        }
      },
      {
        Sid      = "ReadWriteDevelopmentStateAndLocks"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = concat(local.environment_state_objects.development, local.environment_lock_objects.development)
      },
      {
        Sid      = "DeleteDevelopmentStateLocks"
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = local.environment_lock_objects.development
      },
      {
        Sid      = "ListStateBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = local.state_bucket_arn
        Condition = {
          StringLike = {
            "s3:prefix" = "voice-checklist/backend/development.tfstate*"
          }
        }
      },
    ]
  })

  production_deploy_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadProductionBackend"
        Effect   = "Allow"
        Action   = local.environment_read_actions
        Resource = "*"
      },
      {
        Sid      = "ManageProductionBackend"
        Effect   = "Allow"
        Action   = "lambda:*"
        Resource = "arn:${local.partition}:lambda:${var.aws_region}:${local.account_id}:function:voice-checklist-production-*"
      },
      {
        Sid      = "ManageProductionLogGroups"
        Effect   = "Allow"
        Action   = local.log_group_management_actions
        Resource = "arn:${local.partition}:logs:${var.aws_region}:${local.account_id}:log-group:/aws/lambda/voice-checklist-production-*"
      },
      {
        Sid    = "DenyCognitoDeletion"
        Effect = "Deny"
        Action = [
          "cognito-idp:DeleteUserPool",
          "cognito-idp:DeleteUserPoolClient",
        ]
        Resource = "*"
      },
      {
        Sid      = "ManageProductionAuthentication"
        Effect   = "Allow"
        Action   = local.production_cognito_actions
        Resource = "arn:${local.partition}:cognito-idp:${var.aws_region}:${local.account_id}:userpool/*"
      },
      {
        Sid      = "ReadProductionDeploymentSecret"
        Effect   = "Allow"
        Action   = local.deployment_secret_read_actions
        Resource = "arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:voice-checklist/production/deployment/google-oauth-*"
      },
      {
        Sid      = "CreateProductionRuntimeRoles"
        Effect   = "Allow"
        Action   = "iam:CreateRole"
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-production-*"
        Condition = {
          StringEquals = {
            "iam:PermissionsBoundary" = local.runtime_boundary_arns.production
          }
        }
      },
      {
        Sid      = "ManageProductionRuntimeRoles"
        Effect   = "Allow"
        Action   = local.iam_runtime_role_actions
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-production-*"
      },
      {
        Sid      = "SetProductionRuntimeBoundary"
        Effect   = "Allow"
        Action   = "iam:PutRolePermissionsBoundary"
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-production-*"
        Condition = {
          StringEquals = {
            "iam:PermissionsBoundary" = local.runtime_boundary_arns.production
          }
        }
      },
      {
        Sid      = "PassProductionRuntimeRoles"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-production-*"
        Condition = {
          StringEquals = {
            "iam:PassedToService" = "lambda.amazonaws.com"
          }
        }
      },
      {
        Sid      = "ReadWriteProductionStateAndLocks"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject"]
        Resource = concat(local.environment_state_objects.production, local.environment_lock_objects.production)
      },
      {
        Sid      = "DeleteProductionStateLocks"
        Effect   = "Allow"
        Action   = "s3:DeleteObject"
        Resource = local.environment_lock_objects.production
      },
      {
        Sid      = "ListStateBucket"
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = local.state_bucket_arn
        Condition = {
          StringLike = {
            "s3:prefix" = [
              "voice-checklist/auth/production.tfstate*",
              "voice-checklist/backend/production.tfstate*",
            ]
          }
        }
      },
    ]
  })
}
