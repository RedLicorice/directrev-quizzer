terraform {
  # >= 1.10: S3 backend native locking (use_lockfile). Also satisfied by OpenTofu >= 1.10.
  required_version = ">= 1.10"
  required_providers {
    aws     = { source = "hashicorp/aws", version = "~> 6.60" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
}
