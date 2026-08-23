data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id          = data.aws_caller_identity.current.account_id
  partition           = data.aws_partition.current.partition
  boundary_name       = "voice-checklist-github-deployment-boundary"
  boundary_arn        = "arn:${local.partition}:iam::${local.account_id}:policy/${local.boundary_name}"
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
      "${local.state_bucket_arn}/voice-checklist/backend/development.tfstate.tflock",
    ]
    production = [
      "${local.state_bucket_arn}/voice-checklist/auth/production.tfstate",
      "${local.state_bucket_arn}/voice-checklist/auth/production.tfstate.tflock",
      "${local.state_bucket_arn}/voice-checklist/backend/production.tfstate",
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
    "apigateway:GET",
    "cognito-idp:Describe*",
    "cognito-idp:Get*",
    "cognito-idp:List*",
    "dynamodb:Describe*",
    "dynamodb:List*",
    "iam:Get*",
    "iam:List*",
    "lambda:Get*",
    "lambda:List*",
    "logs:Describe*",
    "logs:Get*",
    "logs:List*",
    "sqs:GetQueueAttributes",
    "sqs:List*",
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
        Resource = local.boundary_arn
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
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.repository}:pull_request"
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
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.repository}:environment:development"
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
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.repository}:environment:production"
        }
      }
    }]
  })

  environment_deploy_actions = [
    "apigateway:*",
    "dynamodb:*",
    "lambda:*",
    "logs:*",
    "sqs:*",
    "sts:GetCallerIdentity",
  ]

  environment_secret_actions = [
    "secretsmanager:CreateSecret",
    "secretsmanager:DescribeSecret",
    "secretsmanager:GetSecretValue",
    "secretsmanager:ListSecretVersionIds",
    "secretsmanager:PutSecretValue",
    "secretsmanager:RestoreSecret",
    "secretsmanager:TagResource",
    "secretsmanager:UntagResource",
    "secretsmanager:UpdateSecret",
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

  iam_runtime_actions = [
    "iam:CreateRole",
    "iam:DeleteRole",
    "iam:DeleteRolePolicy",
    "iam:GetRole",
    "iam:GetRolePolicy",
    "iam:ListRolePolicies",
    "iam:PassRole",
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
        Sid      = "ManageDevelopmentBackend"
        Effect   = "Allow"
        Action   = local.environment_deploy_actions
        Resource = "*"
      },
      {
        Sid      = "ManageDevelopmentRuntimeRoles"
        Effect   = "Allow"
        Action   = local.iam_runtime_actions
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-development-*"
        Condition = {
          StringEqualsIfExists = {
            "iam:PermissionsBoundary" = local.boundary_arn
          }
        }
      },
      {
        Sid    = "ManageDevelopmentApplicationBuckets"
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          "arn:${local.partition}:s3:::voice-checklist-development-*",
          "arn:${local.partition}:s3:::voice-checklist-development-*/*",
        ]
      },
      {
        Sid      = "ManageDevelopmentRuntimeSecrets"
        Effect   = "Allow"
        Action   = local.environment_secret_actions
        Resource = "arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:voice-checklist/development/runtime/*"
      },
      {
        Sid      = "ReadWriteDevelopmentState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = local.environment_state_objects.development
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
        Sid      = "ManageProductionBackend"
        Effect   = "Allow"
        Action   = local.environment_deploy_actions
        Resource = "*"
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
        Action   = local.environment_secret_actions
        Resource = "arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:voice-checklist/production/deployment/google-oauth-*"
      },
      {
        Sid      = "ManageProductionRuntimeRoles"
        Effect   = "Allow"
        Action   = local.iam_runtime_actions
        Resource = "arn:${local.partition}:iam::${local.account_id}:role/voice-checklist-production-*"
        Condition = {
          StringEqualsIfExists = {
            "iam:PermissionsBoundary" = local.boundary_arn
          }
        }
      },
      {
        Sid    = "ManageProductionApplicationBuckets"
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          "arn:${local.partition}:s3:::voice-checklist-production-*",
          "arn:${local.partition}:s3:::voice-checklist-production-*/*",
        ]
      },
      {
        Sid      = "ManageProductionRuntimeSecrets"
        Effect   = "Allow"
        Action   = local.environment_secret_actions
        Resource = "arn:${local.partition}:secretsmanager:${var.aws_region}:${local.account_id}:secret:voice-checklist/production/runtime/*"
      },
      {
        Sid      = "ReadWriteProductionState"
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = local.environment_state_objects.production
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
