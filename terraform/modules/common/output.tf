output "cloudfront_domain_name_mirumi_me" {
  value = one(aws_cloudfront_distribution.mirumi_me[*].domain_name)
}

output "cloudfront_domain_name_mirumi_media" {
  value = one(aws_cloudfront_distribution.mirumi_media[*].domain_name)
}
