# mirumi.me

resource "aws_s3_bucket" "mirumi_me" {
  bucket = "mirumime-${var.env_name}-mirumi-me"
  tags   = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

# いつからかエラーが出るようになったらしく、Terraform で管理しないようがいい雰囲気があるっぽいので外した（No changes）
# https://zenn.dev/dyokoo3/scraps/ed9c3ef9b425b2
# resource "aws_s3_bucket_acl" "mirumi_me" {
#   bucket = "mirumime-${var.env_name}-mirumi-me"
#   acl    = "private"
# }

resource "aws_s3_bucket_public_access_block" "mirumi_me" {
  bucket = "mirumime-${var.env_name}-mirumi-me"

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_website_configuration" "mirumi_me" {
  bucket = "mirumime-${var.env_name}-mirumi-me"

  index_document {
    suffix = "index.html"
  }
}

locals {
  # dev は誰にも配信していないので一発で入れ替えてよい。
  # prd は CloudFront の伝播中に 403 が出るため、policy を [旧, 新] にする → distribution を新へ →
  # policy を [新] だけにする、の 3 段階で入れ替える
  origin_referer = var.env_name == "dev" ? random_string.origin_referer[0].result : aws_s3_bucket.mirumi_me.bucket_domain_name
}

# bucket policy に平文で入る値なので sensitive にはしない。
# random_password にすると distribution の plan 差分まで伏せられて確認できなくなる
resource "random_string" "origin_referer" {
  count   = var.env_name == "dev" ? 1 : 0
  length  = 48
  special = false
}

# Function のゲートを解錠する鍵。Referer とは用途が別なので値も分ける
resource "random_password" "site_gate_unlock" {
  count   = var.env_name == "dev" ? 1 : 0
  length  = 32
  special = false
}

# publish index は page ID と revision を含むため配信しない。
# production は bootstrap の明示 GO 時に dev と同じ Deny を入れる
resource "aws_s3_bucket_policy" "mirumi_me" {
  bucket = "mirumime-${var.env_name}-mirumi-me"
  policy = <<POLICY
{
  "Version": "2012-10-17",
  "Id": "MirumiMeOriginCustomHeader",
  "Statement": [
    {
      "Sid": "MirumiMeOriginCustomHeader",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${aws_s3_bucket.mirumi_me.id}/*",
      "Condition": {
        "StringLike": {
          "aws:Referer": [
            "${local.origin_referer}"
          ]
        }
      }
    }%{if var.env_name == "dev"},
    {
      "Sid": "DenyInternalObjectsFromWebsiteOrigin",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${aws_s3_bucket.mirumi_me.id}/_internal/*",
      "Condition": {
        "StringLike": {
          "aws:Referer": "${local.origin_referer}"
        }
      }
    }%{endif}
  ]
}
POLICY
}

# 定期バックアップ

# Worker の Cron が Notion の raw 応答と配信中の BuildPage を R2 に置いたあと、同じ内容を Deep Archive するためのバケット
# 完全プライベートで、保持期間は決めておらず lifecycle は付けない
resource "aws_s3_bucket" "backup" {
  bucket = "mirumime-${var.env_name}-backup"
  tags   = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket = aws_s3_bucket.backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# mirumi.media

resource "aws_s3_bucket" "mirumi_media" {
  count  = var.env_name == "prd" ? 1 : 0
  bucket = "mirumime-${var.env_name}-mirumi-media"
  tags   = var.tags

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_acl" "mirumi_media" {
  count  = var.env_name == "prd" ? 1 : 0
  bucket = "mirumime-${var.env_name}-mirumi-media"
  acl    = "private"
}

resource "aws_s3_bucket_policy" "mirumi_media" {
  count  = var.env_name == "prd" ? 1 : 0
  bucket = "mirumime-${var.env_name}-mirumi-media"
  policy = <<POLICY
{
  "Id": "OAIBucketPolicy",
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "OAIBucketPolicy",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity ${aws_cloudfront_origin_access_identity.mirumi_media[count.index].id}"
      },
      "Action": "s3:GetObject",
      "Resource": "${aws_s3_bucket.mirumi_media[count.index].arn}/*"
    }
  ]
}
POLICY
}
