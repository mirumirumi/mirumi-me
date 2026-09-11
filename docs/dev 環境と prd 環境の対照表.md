# dev 環境と prd 環境の対照表

dev / prd のリソースと、共通にしているものの理由をまとめる。
リソースを増やすときはこの表に 1 行足す。

判断基準は「dev の操作ミスが prd の配信・データ・課金へ波及しうるか」。
波及しうるものは分ける。外部アカウントに 1 つしか持てないものは共通のままにする。

## Cloudflare

| リソース | prd | dev | 区分 | メモ |
| --- | --- | --- | --- | --- |
| Worker | `mirumi-me-prd` | `mirumi-me-dev` | 分離 | |
| Workflow | `mirumi-me-publish-prd` | `mirumi-me-publish-dev` | 分離 | |
| Container | `mirumi-me-build-prd` | `mirumi-me-build-dev` | 分離 | 同じ Dockerfile |
| KV `CONTENT_CACHE` | 未作成 | `ab630ddb…` | 分離 | prd の namespace ID 未設定のままだと deploy が通らない |
| R2 `BACKUP` | `mirumi-me-backup-prd` | `mirumi-me-backup-dev` | 分離 | Cron 実装はこれから |
| Analytics Engine | `mirumi_me_pv_prd` | `mirumi_me_pv_dev` | 分離 | write / read 実装はこれから |
| Rate limit namespace | `913240002` | `913240001` | 分離 | |
| Access `mirumi-me-preview` | 共通 AUD | 共通 AUD | 共通 | 同一人物・同一ポリシーのため 1 アプリで dev / prd 両方の `/preview` を保護 |
| Access `mirumi-me-admin` | 共通 AUD | 共通 AUD | 共通 | 同上 |
| Access `mirumi-me-local-x-post` | なし | 専用 AUD | dev のみ | prd では同 route を 404 にする |
| Access service token | なし | `mirumi-me-local-development` | dev のみ | 有効期限 1 年 |
| `workers.dev` サブドメイン | 共通 | 共通 | 共通 | アカウントに 1 つ |

## AWS

| リソース | prd | dev | 区分 | メモ |
| --- | --- | --- | --- | --- |
| site S3 bucket | `mirumime-prd-mirumi-me` | `mirumime-dev-mirumi-me` | 分離 | |
| media S3 bucket | `mirumime-prd-mirumi-media` | prd と同じ | 共通 | key が content hash ベースで衝突が無害。dev の画像も prd に残る点は許容する |
| site CloudFront | `E1UPWIMHFP5TEC`（mirumi.me） | `E16GU2ZPNLT91U`（`d3694gpnjd4x49`） | 分離 | dev は通常無効 |
| CloudFront origin 方式 | S3 ウェブサイトエンドポイント | prd と同じ | 共通 | カスタムオリジン（http-only）。OAI / OAC ではない。index document とルーティングルールを S3 側が処理するため CloudFront Function が不要 |
| origin アクセス制御 | `Referer` カスタムヘッダ | prd と同じ方式 | 共通 | bucket policy が `aws:Referer` 一致時だけ `GetObject` を許可。現在の値はバケット名そのもので推測可能 |
| `_internal/*` の Deny | 未設定 | 設定済み | 分離 | prd は bootstrap の GO 後に設定する |
| media CloudFront | mirumi.media | prd と同じ | 共通 | media bucket と同じ理由 |
| IAM アクセスキー | 共通 | 共通 | 共通（要検討） | dev から prd の site bucket へ書ける状態。分離候補 |
| サムネイル生成 Lambda | 専用 URL | 専用 URL | 分離 | `THUMBNAIL_FUNCTION_URL` |
| お問い合わせ Lambda | あり | なし | prd のみ | 当面そのまま |
| Route53 / ACM | あり | なし | prd のみ | dev はカスタムドメインを持たない |

## Notion

| リソース | prd | dev | 区分 | メモ |
| --- | --- | --- | --- | --- |
| ワークスペース | `mirumi.me` | prd と同じ | 共通 | MCP も `ntn` も同時に 1 ワークスペースしか見られないため、分けると接続の張り替えが常時発生する |
| posts / pages data source | `399e5acd…` / `53765425…` | `3c065425…` / `dc065425…` | 分離 | 同一ワークスペース内で `(dev)` として分ける |
| comments data source | `201f8de6…` | `3d365425…` | 分離 | |
| categories data source | `b2786440…` | prd と同じ | 共通 | 15 件で変化が少なく、dev 側に複製する利点がない |
| `NOTION_TOKEN` | 共通 | 分離 | 分離 | dev の integration は dev の 3 データソースと共用 categories にしか接続していない |
| `NOTION_WEBHOOK_SECRET` | 分離 | 分離 | 分離 | |
| `internal-state` property ID | `o=BU` | `o=BU` | 共通 | データソースを複製しても Notion がプロパティ ID を維持するため |
| integration の bot 名 | `workers-api` | `workers-api (dev)` | 分離 | `status` の式は 4 データソースとも `contains(..., "workers-api")` で共通 |

## 外部サービス

| リソース | prd | dev | 区分 | メモ |
| --- | --- | --- | --- | --- |
| Amazon Creators credential | 共通 | 共通 | 共通 | アカウントに 1 つ |
| `AMAZON_ASSOCIATE_TAG` | `milmemo-22` | 同じ | 共通 | 同上 |
| `AMAZON_CARD_SIGNING_SECRET` | 分離 | 分離 | 分離 | 署名 token が環境をまたがないようにする |
| xAI API key | 共通 | 共通 | 共通 | アカウントに 1 つ。dev の呼び出しも課金対象 |
| Turnstile | site key ハードコード | prd と同じ | 共通（要対応） | ウィジェットはホスト名制限があるため dev ホスト名の登録が必要 |
| GA4 | `G-Y7HSDMHBW5` | prd と同じ | 共通（要対応） | dev では読み込まないようにする |
| AdSense | `ca-pub-2873410957106428` | prd と同じ | 共通（要対応） | 同上 |
| 通知メール | `marumorumirumeri@outlook.com` | 未定 | 未定 | コメント実装時に決める |

## CI / ローカル

| リソース | prd | dev | 区分 | メモ |
| --- | --- | --- | --- | --- |
| GitHub Actions deploy | `main` push | `dev` push | 分離 | `ENV_NAME` が ref 名から切り替わる |
| `CLOUDFLARE_API_TOKEN` | 共通 | 共通 | 共通 | deploy 権限のみのトークン 1 本 |
| ローカル `app/.env` | 使わない | dev を参照 | dev のみ | Notion token と Access service token |

## dev にまだ揃っていないもの

- dev サイトの常時閲覧手段。dev CloudFront を常時有効にし、CloudFront Function で閲覧を絞る方針
- `Referer` によるオリジン保護の値がバケット名そのもので推測可能。ランダムな秘密値へ変更する
- GA / AdSense の環境別無効化。常時閲覧を始める前提条件になる
- dev 専用の AWS IAM ユーザー
- prd の KV namespace
