variable "environment" {
  description = "Authentication environment to provision."
  type        = string

  validation {
    condition     = contains(["development", "production"], var.environment)
    error_message = "environment must be development or production."
  }
}

variable "aws_region" {
  description = "AWS Region for the Cognito user pool."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]+$", var.aws_region))
    error_message = "aws_region must be a valid AWS Region name."
  }
}

variable "cognito_domain_prefix" {
  description = "Globally unique prefix for the Cognito managed-login domain."
  type        = string

  validation {
    condition = (
      can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", var.cognito_domain_prefix)) &&
      !can(regex("aws|amazon|cognito", var.cognito_domain_prefix))
    )
    error_message = "cognito_domain_prefix must be 1-63 lowercase letters, numbers, or interior hyphens and cannot contain aws, amazon, or cognito."
  }
}

variable "google_oauth_secret_name" {
  description = "Name of the environment-scoped Secrets Manager secret containing client_id and client_secret."
  type        = string

  validation {
    condition     = startswith(var.google_oauth_secret_name, "voice-checklist/")
    error_message = "google_oauth_secret_name must use the voice-checklist/ namespace."
  }
}

variable "tags" {
  description = "Additional tags for all resources."
  type        = map(string)
  default     = {}
}
