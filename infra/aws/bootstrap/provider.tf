provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = "Voice Checklist"
      Environment = "shared"
      ManagedBy   = "OpenTofu"
      Repository  = var.repository
    }
  }
}
