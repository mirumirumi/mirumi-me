provider "aws" {
  region = "ap-northeast-1"
}

terraform {
  backend "s3" {
    bucket = "common-prd-tfstate-artifactstore"
    region = "ap-northeast-1"
    key    = "mirumi-me/terraform.tfstate"
  }
}

locals {
  env_name = "prd"
  tags = {
    project = "mirumi-me"
    env     = local.env_name
    IaC     = "tf"
  }
}

module "modules" { // If you want to change the name, you must do `moved` etc
  source = "../../modules/common"

  env_name = local.env_name
  tags     = local.tags

  acm_arn_mirumi_me    = module.virginia.acm_arn_mirumi_me
  acm_arn_mirumi_media = module.virginia.acm_arn_mirumi_media
}

module "virginia" {
  source = "../../modules/virginia"

  env_name = local.env_name
  tags     = local.tags

  cloudfront_domain_name_mirumi_me    = module.modules.cloudfront_domain_name_mirumi_me
  cloudfront_domain_name_mirumi_media = module.modules.cloudfront_domain_name_mirumi_media
}
