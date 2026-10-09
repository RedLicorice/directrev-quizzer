terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.60" }
  }
  # Step 1: local state (this block commented out). Step 2: after the first apply,
  # uncomment, fill backend.hcl and run `terraform init -migrate-state -backend-config=backend.hcl`.
  # See infra/README.md, "Bootstrap".
  backend "s3" {
    key          = "bootstrap/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = { app = "quizzer", managed-by = "terraform", stack = "bootstrap" }
  }
}
