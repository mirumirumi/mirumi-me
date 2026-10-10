resource "aws_acm_certificate" "mirumi_me" {
  provider = aws.useast1
  count    = var.env_name == "prd" ? 1 : 0

  domain_name       = "mirumi.me"
  validation_method = "DNS"

  tags = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_acm_certificate_validation" "mirumi_me" {
  provider = aws.useast1
  count    = var.env_name == "prd" ? 1 : 0

  certificate_arn         = aws_acm_certificate.mirumi_me[count.index].arn
  validation_record_fqdns = [for record in aws_route53_record.mirumi_me_ACM : record.fqdn]
}



resource "aws_acm_certificate" "mirumi_media" {
  provider = aws.useast1
  count    = var.env_name == "prd" ? 1 : 0

  domain_name       = "mirumi.media"
  validation_method = "DNS"

  tags = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_acm_certificate_validation" "mirumi_media" {
  provider = aws.useast1
  count    = var.env_name == "prd" ? 1 : 0

  certificate_arn         = aws_acm_certificate.mirumi_media[count.index].arn
  validation_record_fqdns = [for record in aws_route53_record.mirumi_media_ACM : record.fqdn]
}
