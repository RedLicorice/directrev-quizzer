# Optional custom domain. CloudFront only accepts ACM certificates issued in us-east-1,
# which is the default provider region of this root (var.region).
#
# Two-step apply (DNS is on Cloudflare, not Route 53, so validation records are added by
# hand):
#   terraform apply -target=aws_acm_certificate.this
#   terraform output -json acm_validation_records     # add them in Cloudflare, DNS only
#   terraform apply
resource "aws_acm_certificate" "this" {
  count             = var.custom_domain == null ? 0 : 1
  domain_name       = var.custom_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Waits for the validation CNAME; the distribution depends on this resource, never on the
# distribution itself (no cycle).
resource "aws_acm_certificate_validation" "this" {
  count                   = var.custom_domain == null ? 0 : 1
  certificate_arn         = aws_acm_certificate.this[0].arn
  validation_record_fqdns = [for d in aws_acm_certificate.this[0].domain_validation_options : d.resource_record_name]
}
