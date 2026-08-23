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

variable "state_bucket" {
  description = "Pre-existing encrypted and versioned S3 bucket for OpenTofu state."
  type        = string

  validation {
    condition     = length(var.state_bucket) >= 3 && length(var.state_bucket) <= 63
    error_message = "state_bucket must be a valid S3 bucket name length."
  }
}
