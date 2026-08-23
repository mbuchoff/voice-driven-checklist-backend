provider "aws" {
  region = var.aws_region

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
