variable "aws_region" {
  description = "AWS Region containing the application infrastructure."
  type        = string
  default     = "us-east-1"
}

variable "repository" {
  description = "GitHub owner/repository trusted by the OIDC roles."
  type        = string
  default     = "mbuchoff/voice-driven-checklist-backend"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.repository))
    error_message = "repository must use the owner/name form."
  }
}

variable "repository_id" {
  description = "Immutable GitHub repository ID trusted by the OIDC roles."
  type        = number
  default     = 1344113852

  validation {
    condition     = var.repository_id > 0 && floor(var.repository_id) == var.repository_id
    error_message = "repository_id must be a positive integer."
  }
}

variable "repository_owner_id" {
  description = "Immutable GitHub repository owner ID trusted by the OIDC roles."
  type        = number
  default     = 13501758

  validation {
    condition     = var.repository_owner_id > 0 && floor(var.repository_owner_id) == var.repository_owner_id
    error_message = "repository_owner_id must be a positive integer."
  }
}

variable "trusted_actor_id" {
  description = "GitHub user ID allowed to request deployment credentials."
  type        = number
  default     = 13501758

  validation {
    condition     = var.trusted_actor_id > 0 && floor(var.trusted_actor_id) == var.trusted_actor_id
    error_message = "trusted_actor_id must be a positive integer."
  }
}

variable "state_bucket" {
  description = "Pre-existing encrypted and versioned S3 bucket for OpenTofu state."
  type        = string

  validation {
    condition     = length(var.state_bucket) >= 3 && length(var.state_bucket) <= 63
    error_message = "state_bucket must be a valid S3 bucket name length."
  }
}
