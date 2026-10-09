provider "aws" {
  region              = var.region
  allowed_account_ids = [var.account_id]
  default_tags {
    tags = {
      app         = "quizzer"
      environment = var.environment
      managed-by  = "terraform"
    }
  }
}
