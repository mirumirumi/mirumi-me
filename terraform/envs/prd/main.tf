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

  # フェーズ 1 では Route53 と ACM を旧リポジトリに残すため、既存証明書の ARN を直接指す。
  # 移設したら module.virginia の出力へ差し替える
  acm_arn_mirumi_me    = "arn:aws:acm:us-east-1:145943270736:certificate/f2197a78-d84c-42f2-9d89-0811b5c2a63a"
  acm_arn_mirumi_media = "arn:aws:acm:us-east-1:145943270736:certificate/2780fa06-a8a2-490a-8c54-ff842cedbab6"
}

module "modules" { // If you want to change the name, you must do `moved` etc
  source = "../../modules/common"

  env_name = local.env_name
  tags     = local.tags

  acm_arn_mirumi_me    = local.acm_arn_mirumi_me
  acm_arn_mirumi_media = local.acm_arn_mirumi_media
}
