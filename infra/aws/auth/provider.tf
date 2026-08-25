provider "aws" {
  region = var.aws_region

  # Repository stays resource-specific because adding it here would retag protected Cognito resources.
  default_tags {
    tags = merge(
      {
        Application = "Voice Checklist"
        Environment = var.environment
        ManagedBy   = "OpenTofu"
      },
      var.tags,
    )
  }
}
