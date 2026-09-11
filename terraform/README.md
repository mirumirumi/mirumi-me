# terraform

mirumi.me と mirumi.media の AWS リソースを管理する。
もともと `aws-common-infrastructures` にあったものをこのリポジトリへ移設した。

## 構成

| | 中身 |
| --- | --- |
| `modules/site` | サイト本体の S3 と CloudFront。dev / prd 両方に存在する |
| `modules/media` | mirumi.media の S3 と CloudFront。prd だけに存在し dev も共用する |
| `modules/dns` | mirumi.me / mirumi.media の Route53 と ACM。prd だけ |
| `envs/dev`、`envs/prd` | backend と module の組み立て |

Terraform のバージョンは `.terraform-version` で固定する。
**旧リポジトリの state を触るときは 1.2.2 を使う。**新しい版で触ると state のフォーマットが上がり、
旧リポジトリの CI（1.2.2 固定）が読めなくなる。

## 配信の仕組み

サイト本体の CloudFront は S3 の**ウェブサイトエンドポイント**をカスタムオリジンとして使う。
OAC / OAI はウェブサイトエンドポイントでは使えないため、CloudFront が付ける `Referer`
カスタムヘッダと bucket policy の条件一致でオリジン直叩きを塞いでいる。

この方式のおかげで、ディレクトリインデックス解決（`/foo` → `foo/index.html`）と
リダイレクトルールを S3 側が処理でき、CloudFront Function が不要になっている。

mirumi.media だけは通常の S3 オリジンなので OAI を使う。

## 移設の手順

旧リポジトリ `aws-common-infrastructures` は push で自動 `terraform apply` が走る。
移設中に旧リポジトリへ push すると、コードから消えたリソースが destroy される。

1. **旧リポジトリの CI を止める**。これを最初にやる
2. `envs/*/imports.tf` を置いたまま `terraform apply` する。`import` は state に載せるだけで
   AWS の実リソースには触らない
3. `terraform plan` が **No changes** になることを確認する。これがコードと実物が一致した証明
4. `imports.tf` を削除する
5. 旧リポジトリで `terraform state rm`（1.2.2 で実行）してから、対応するコードを削除する
6. 旧リポジトリで `plan` が No changes になることを確認する

Route53 と ACM はフェーズ 2 として分ける。ゾーンを作り直すと NS が変わって DNS が停止するため、
サイトと media の移設を検証してから着手する。フェーズ 1 の間は `envs/prd/main.tf` の
`acm_certificate_arn_*` が既存証明書の ARN を直接指す。

`aws_acm_certificate_validation` は import できない。証明書が発行済みなら apply 時に
即座に完了するだけで証明書自体には何もしないため、plan に `+ create` が出ても問題ない。

## 現状との差分として意図的に残しているもの

- dev の CloudFront は `enabled = false`。閲覧を絞る CloudFront Function を入れてから true にする
- `_internal/*` の Deny は dev だけ。production は bootstrap の明示 GO 時に
  `modules/site/s3.tf` の `deny_internal_objects` を prd でも true にする
- `Referer` の値がバケット名そのもので推測可能。ランダムな秘密値へ変更する

## GitHub Actions の認証

長期のアクセスキーは置かず、GitHub の OIDC で IAM ロールを引き受ける。

| | |
| --- | --- |
| OIDC provider | `arn:aws:iam::145943270736:oidc-provider/token.actions.githubusercontent.com` |
| dev のロール | `mirumime-dev-ci` |
| prd のロール | `mirumime-prd-ci` |
| GitHub 側に必要な設定 | リポジトリ変数 `AWS_ACCOUNT_ID` |

ロールは環境ごとに分けている。信頼ポリシーが `sub` を
`repo:mirumirumi/mirumi-me:ref:refs/heads/deploy/{env}/terraform` に固定しているため、
別のリポジトリや別のブランチからは引き受けられない。
権限も分離してあり、dev のロールから production の bucket、distribution、Route53 へは到達できない。
