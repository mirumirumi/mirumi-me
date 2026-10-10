provider "aws" {
  region = "ap-northeast-1"
}

terraform {
  backend "s3" {
    bucket = "common-dev-tfstate-artifactstore"
    region = "ap-northeast-1"
    key    = "mirumi-me/terraform.tfstate"
  }
}

locals {
  env_name = "dev"
  tags = {
    project = "mirumi-me"
    env     = local.env_name
    IaC     = "tf"
  }
}

# dev は mirumi.media と DNS を持たず、prd のものを共用する
module "modules" { // If you want to change the name, you must do `moved` etc
  source = "../../modules/common"

  env_name = local.env_name
  tags     = local.tags

  acm_arn_mirumi_me    = null
  acm_arn_mirumi_media = null
}
