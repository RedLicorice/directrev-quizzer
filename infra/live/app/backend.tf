# Partial configuration: bucket/region come from `backend.hcl` (see backend.hcl.example and
# infra/README.md), so no account id is hard-coded here.
#   terraform init -backend-config=backend.hcl
# https://developer.hashicorp.com/terraform/language/backend/s3 (use_lockfile, no DynamoDB)
terraform {
  backend "s3" {
    key          = "app/terraform.tfstate"
    use_lockfile = true
    encrypt      = true
  }
}
