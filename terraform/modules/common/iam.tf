# Worker / Container が publish と定期バックアップで使う IAM ユーザー。
# Cloudflare 側から AWS のロールを引き受ける手段がないため静的キーになるが、
# 環境ごとにユーザーを分けて dev のキーから prd の site bucket と distribution へ届かないようにする。
# アクセスキーは state に秘密を残さないよう Terraform では作らない（README 参照）

data "aws_caller_identity" "current" {
}

resource "aws_iam_user" "publisher" {
  name = "mirumime-${var.env_name}-publisher"
  tags = var.tags
}

# s3:ListBucket がないと存在しないキーの GetObject / HeadObject が 404 ではなく 403 になり、
# 「publish index がない」「media が未登録」を判定できず job が落ちる。
# mirumi.media は dev も prd のバケットへ書くため、どちらの環境でも prd のバケットを対象にする
resource "aws_iam_user_policy" "publisher" {
  name = "mirumime-${var.env_name}-publisher"
  user = aws_iam_user.publisher.name

  policy = <<POLICY
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SiteBucket",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "${aws_s3_bucket.mirumi_me.arn}/*"
    },
    {
      "Sid": "MediaBucket",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::mirumime-prd-mirumi-media/*"
    },
    {
      "Sid": "BackupBucket",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "${aws_s3_bucket.backup.arn}/*"
    },
    {
      "Sid": "ListBuckets",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": [
        "${aws_s3_bucket.mirumi_me.arn}",
        "arn:aws:s3:::mirumime-prd-mirumi-media"
      ]
    },
    {
      "Sid": "Invalidation",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${aws_cloudfront_distribution.mirumi_me.id}"
    }
  ]
}
POLICY
}
