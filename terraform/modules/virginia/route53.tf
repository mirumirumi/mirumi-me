# mirumi.me

resource "aws_route53_zone" "mirumi_me" {
  name  = "mirumi.me"
  count = var.env_name == "prd" ? 1 : 0
  tags  = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_route53_record" "mirumi_me_A" {
  zone_id = aws_route53_zone.mirumi_me[count.index].zone_id
  name    = "mirumi.me"
  type    = "A"
  count   = var.env_name == "prd" ? 1 : 0

  alias {
    name                   = "${var.cloudfront_domain_name_mirumi_me}."
    zone_id                = "Z2FDTNDATAQYW2" # https://bit.ly/3HV6NFX
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "mirumi_me_ACM" {
  zone_id         = aws_route53_zone.mirumi_me[count.index].zone_id
  name            = tolist(aws_acm_certificate.mirumi_me[count.index].domain_validation_options)[0]["resource_record_name"] # https://bit.ly/3brCgDf
  records         = [tolist(aws_acm_certificate.mirumi_me[count.index].domain_validation_options)[0]["resource_record_value"]]
  type            = "CNAME"
  ttl             = 3600
  allow_overwrite = true
  count           = var.env_name == "prd" ? 1 : 0
}

# mirumi.media

resource "aws_route53_zone" "mirumi_media" {
  name  = "mirumi.media"
  count = var.env_name == "prd" ? 1 : 0
  tags  = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_route53_record" "mirumi_media_A" {
  zone_id = aws_route53_zone.mirumi_media[count.index].zone_id
  name    = "mirumi.media"
  type    = "A"
  count   = var.env_name == "prd" ? 1 : 0

  alias {
    name                   = "${var.cloudfront_domain_name_mirumi_media}."
    zone_id                = "Z2FDTNDATAQYW2" # https://bit.ly/3HV6NFX
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "mirumi_media_ACM" {
  zone_id         = aws_route53_zone.mirumi_media[count.index].zone_id
  name            = tolist(aws_acm_certificate.mirumi_media[count.index].domain_validation_options)[0]["resource_record_name"] # https://bit.ly/3brCgDf
  records         = [tolist(aws_acm_certificate.mirumi_media[count.index].domain_validation_options)[0]["resource_record_value"]]
  type            = "CNAME"
  ttl             = 3600
  allow_overwrite = true
  count           = var.env_name == "prd" ? 1 : 0
}
