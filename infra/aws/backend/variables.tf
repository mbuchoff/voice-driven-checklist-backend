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

variable "tags" {
  description = "Additional tags for all resources."
  type        = map(string)
  default     = {}
}
