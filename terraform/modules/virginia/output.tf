output "acm_arn_mirumi_me" {
  value = one(aws_acm_certificate.mirumi_me[*].arn)
}

output "acm_arn_mirumi_media" {
  value = one(aws_acm_certificate.mirumi_media[*].arn)
}
