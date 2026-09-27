variable "environment" {
  description = "Backend environment to provision."
  type        = string

  validation {
    condition     = contains(["development", "production"], var.environment)
    error_message = "environment must be development or production."
  }
}

variable "aws_region" {
  description = "AWS Region for backend resources."
  type        = string
  default     = "us-east-1"
}

variable "artifact_path" {
  description = "Path to the exact Lambda zip selected for deployment."
  type        = string

  validation {
    condition     = fileexists(var.artifact_path)
    error_message = "artifact_path must identify an existing artifact."
  }
}

variable "artifact_digest" {
  description = "Base64-encoded SHA-256 expected by Lambda source_code_hash."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9+/]{43}=$", var.artifact_digest))
    error_message = "artifact_digest must be a base64-encoded SHA-256."
  }
}

variable "artifact_sha256" {
  description = "Lowercase hexadecimal SHA-256 recorded in deployment descriptions."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{64}$", var.artifact_sha256))
    error_message = "artifact_sha256 must be a lowercase hexadecimal SHA-256."
  }
}

variable "commit_sha" {
  description = "Full selected Git commit recorded in deployment descriptions."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.commit_sha))
    error_message = "commit_sha must be a full lowercase Git SHA."
  }
}

variable "deployment_url" {
  description = "GitHub Deployment URL associated with the selected commit."
  type        = string

  validation {
    condition     = startswith(var.deployment_url, "https://github.com/mbuchoff/voice-driven-checklist-backend/")
    error_message = "deployment_url must belong to the backend GitHub repository."
  }
}

variable "permissions_boundary_arn" {
  description = "Bootstrap-owned permissions boundary for runtime execution roles."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:iam::[0-9]{12}:policy/voice-checklist-", var.permissions_boundary_arn))
    error_message = "permissions_boundary_arn must identify a Voice Checklist IAM policy."
  }
}

variable "cognito_user_pool_id" {
  description = "Cognito user pool whose access tokens the runtime accepts."
  type        = string
  default     = ""

  validation {
    condition     = var.environment != "development" || can(regex("^[a-z]{2}-[a-z]+-[0-9]+_[A-Za-z0-9]+$", var.cognito_user_pool_id))
    error_message = "Development requires a valid Cognito user pool ID."
  }
}

variable "cognito_client_ids" {
  description = "Public Cognito app clients whose access tokens the runtime accepts."
  type        = list(string)
  default     = []

  validation {
    condition     = var.environment != "development" || length(var.cognito_client_ids) > 0
    error_message = "Development requires at least one Cognito app client ID."
  }
}

variable "mongodb_uri" {
  description = "Credential-free MongoDB Atlas connection URI."
  type        = string
  default     = ""

  validation {
    condition     = var.environment != "development" || can(regex("^mongodb\\+srv://[^:@/]+(?:/.*)?$", var.mongodb_uri))
    error_message = "Development requires a credential-free MongoDB SRV URI."
  }
}

variable "mongodb_database" {
  description = "MongoDB database owned by this backend environment."
  type        = string
  default     = ""

  validation {
    condition     = var.environment != "development" || length(var.mongodb_database) > 0
    error_message = "Development requires a MongoDB database."
  }
}

variable "powersync_endpoint" {
  description = "PowerSync instance endpoint and required JWT audience."
  type        = string
  default     = ""

  validation {
    condition     = var.environment != "development" || can(regex("^https://", var.powersync_endpoint))
    error_message = "Development requires an HTTPS PowerSync endpoint."
  }
}

variable "powersync_jwt_issuer" {
  description = "Stable issuer identifier placed in backend-minted PowerSync JWTs."
  type        = string
  default     = ""

  validation {
    condition     = var.environment != "development" || can(regex("^https://", var.powersync_jwt_issuer))
    error_message = "Development requires an HTTPS PowerSync JWT issuer identifier."
  }
}

variable "powersync_jwt_key_id" {
  description = "Public key identifier placed in PowerSync JWTs and JWKS."
  type        = string
  default     = ""

  validation {
    condition     = var.environment != "development" || length(var.powersync_jwt_key_id) > 0
    error_message = "Development requires a PowerSync signing-key ID."
  }
}

variable "runtime_secret_version" {
  description = "Numeric SSM SecureString version pinned into the published Lambda version."
  type        = number
  default     = 0

  validation {
    condition     = var.environment != "development" || (var.runtime_secret_version >= 1 && floor(var.runtime_secret_version) == var.runtime_secret_version)
    error_message = "Development requires a positive numeric runtime-secret version."
  }
}

variable "cors_allowed_origins" {
  description = "Exact browser origins allowed to call the development API."
  type        = list(string)
  default     = []

  validation {
    condition = var.environment != "development" || (
      length(var.cors_allowed_origins) > 0 &&
      alltrue([for origin in var.cors_allowed_origins : can(regex(
        "^https?://(([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\\.([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*|\\[[0-9A-Fa-f:.]+\\])(:([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?$",
        origin,
      ))])
    )
    error_message = "Development requires at least one exact HTTP or HTTPS CORS origin."
  }
}

variable "tags" {
  description = "Additional tags for all resources."
  type        = map(string)
  default     = {}
}
