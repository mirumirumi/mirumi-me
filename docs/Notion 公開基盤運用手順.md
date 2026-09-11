# Notion 公開基盤運用手順

これは僕が書いたものじゃないよ、Workers API 実装時に Codex が用意したもの。

## 基本契約

- コンテンツの正本は Notion、現在配信中の状態は S3 の `_internal/publish-index-v1.json`
- 公開処理は Workers Workflow から名前付き `BuildContainer` の直列 job を呼ぶ
- Container が Notion 取得、画像同期、Nuxt SSG、S3 更新までを行い、publish index を最後に更新する
- CloudFront invalidation のあと、Notion の `internal-state` と公開結果を書き戻す
- `_nuxt` の hash asset、旧画像、旧 WordPress object は自動削除しない
- `_internal/*` は CloudFront から取得できない bucket policy にする

## Notion 移行の完了条件

production bootstrap だけでは移行完了ではない。コメント、検索、PV、管理拡張、バックアップなど
`tools/migrate-to-notion/やること.md` の必須項目を完了し、runtime の WordPress 依存をすべて撤去したあとに WordPress を完全廃止する。

移行期間中はコメント、検索、PV、いいねが WordPress に依存する。
コメント feed は移行せず廃止する。
Notion だけに存在する新規記事では現行コメント処理が WordPress post ID を解決できないため、コメント基盤の切り替え前に運用を開始しない。

## 記事の公開と非公開

通常操作は Notion のボタンから行う。

- `公開待ち` → Webhook → 公開成功後に `公開中`
- `非公開待ち` → Webhook → 非公開成功後に `非公開`
- Webhook は同じ event ID の重複配送を正常系として扱う
- build 中に page が再編集された場合は S3 更新前に中止する
- 一度公開した slug は publish index が所有し続ける。slug 変更や別 page での再利用は自動では行わない
- production の render warning は 1 件でも公開を止める

手動の部分公開は Access 配下の `POST /admin/publish`、状態確認は `GET /admin/workflows/:instanceId` を使う。action は request ではなく Notion の最新 state から決まる。

### 非公開にしたはずの記事が一覧に残っているとき

publish index の保存は S3 配信のあとに行うため、最後の index 保存だけが失敗すると配信内容と index がずれる。
公開なら次の公開でそのまま揃うが、非公開では記事の実体が消えたまま index が公開中の記録を保つため、
次の部分公開で一覧、sitemap、feed にその記事が復活してリンク切れになる。復旧は full build を回すだけでよい。

### Webhook subscription の初回設定

購読するイベントは `page.properties_updated` だけでよい。
Worker が処理するのはこの型のみで、他の型は署名検証後に `ignored` として 200 を返すだけになる。

Notion が送った `verification_token` は通常ログへ出さず、`CONTENT_CACHE` に 10 分だけ保存する。
subscription 作成直後に Access 配下の `GET /admin/notion-webhook-verification` で 1 回だけ取得し、
Notion の確認画面へ貼り付けたあと、同じ値を `NOTION_WEBHOOK_SECRET` へ登録する。
endpoint は取得時に一時保存値を削除する。期限切れの場合は Notion 側から token を再送する。

## Cloudflare Access

- `mirumi-me-preview` は dev / prd の `/preview` と `/preview/*`、`mirumi-me-admin` は `/admin` と `/admin/*` を保護する
- どちらも Cloudflare account member だけを許可し、session duration は 24 時間
- application cookie は SameSite=Strict、HttpOnly、Binding Cookie、Path Cookie を有効にする
- Worker は `ACCESS_PREVIEW_AUD` と `ACCESS_ADMIN_AUD` を分けて JWT を検証し、issuer は共通の `ACCESS_TEAM_DOMAIN` を使う
- `mirumi-me-local-x-post` は dev の `POST /_dev/x-post` だけを専用 service token で保護する。production は同 route を 404 にする

## application release と full build

`wrangler deploy` は Worker、Workflow、Container のコード配備だけを行う。
サイト全体の更新には、続けて Workflow の full build が必要。

```bash
cd server
bun run deploy:dev
bunx wrangler workflows trigger mirumi-me-publish-dev \
  '{"mode":"full","source":"release","requestId":"release-COMMIT_SHA-RUN_ATTEMPT","requestedAt":"ISO_DATETIME","pageIds":[]}' \
  --env dev \
  --id release-COMMIT_SHA-RUN_ATTEMPT
```

dev の初回だけ、上の `mode` を `bootstrap` にする。
dev CloudFront distribution は通常無効のままとし、外部配信の確認時だけ一時的に有効化して、確認後に必ず無効へ戻す。

本番では workflow 名と env を `mirumi-me-publish-prd` / `prd` に変える。
GitHub Actions では commit SHA と run attempt を instance ID に含め、Cloudflare deploy token だけを持たせる。
Notion / AWS の secret は GitHub へ置かない。
deploy token は対象 account だけに絞り、`Workers Scripts Edit` と Container 配備用の `Containers Edit` を許可する。
ローカルで使う場合もファイルには保存せず、`CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を必要なプロセスだけへ一時的に渡し、作業後に token を revoke する。

通常 full build は `公開中`の現在本文だけを再生成する。
`公開待ち / 非公開待ち`の route は上書きせず、一覧、sitemap、feed には publish index の最後の公開値を使う。

現行の `.github/workflows/deploy.yml` からこの方式への切り替えは、production bootstrap と同じ明示 GO のあとに行う。

## ローカル frontend 開発

初回だけ `app/.env.example` を `app/.env` へコピーし、Notion integration token と Cloudflare Access service token を入れる。
`app/.env` は Git 管理しない。通常はそのまま `bun run dev` でよい。

```bash
bun run dev
```

Codex App から起動して Windows 側の一時ディレクトリが継承される場合だけ、
Nuxt の Unix socket 用に `TMPDIR=/tmp bun run dev` とする。

- 一覧 metadata は Notion から 5 分ごと、本文は表示した記事だけ 30 分ごとに取得する
- cache は `app/.cache/notion-dev` に保存し、Notion や外部 API の一時障害時は古い値を使う
- 内部 Bookmark は Notion metadata、外部 Bookmark はローカル取得、X post は Access 配下の dev Worker と KV / ローカル cache で解決する
- 本文と thumbnail の Notion 一時 URL はそのまま使うため、画像同期、変換、タイトルカード生成は行わない
- Amazon は静的 fallback card を出したあと、dev Worker の Creators API endpoint で hydration する。失敗時は fallback を維持する

Container の最終成果物を確認したい場合だけ、従来どおり build manifest を優先して読む。

```bash
MIRUMI_BUILD_MANIFEST_DIR=/tmp/mirumi-build/JOB/manifest bun run dev
```

`nuxt generate` と production build は manifest 必須で、Notion 直接取得へ fallback しない。

### ローカル token の更新

- Notion token は integration secret を再発行・失効したときだけ `app/.env` を更新する
- Access token `mirumi-me-local-development` は 1 年。期限 30 日前から `bun run dev` の log で警告する
- 通常更新は Cloudflare の service token を refresh して有効期限を 1 年延長し、`CF_ACCESS_SERVICE_TOKEN_EXPIRES_AT` だけを書き換える
- secret を rotate するときは旧 secret の猶予時間を設定し、新 secret を `app/.env` へ入れて疎通確認後に旧 secret を失効する
- refresh / rotate に必要な Cloudflare API token は `app/.env` へ置かず、Zero Trust UI または Cloudflare MCP から操作する

## 画像

### 新規 Notion upload

- 本文静止画: 800 / 1200 / 1600 px、拡大なし、WebP quality 80
- thumbnail: 412x216 / 600x315 / 1200x630、cover、WebP quality 80
- 記事ヘッダー: mobile 600、desktop 1200
- トップと内部ブログカード: 412
- key: `{assetHash}-{cleanStem}-{size}.webp`
- thumbnail の `cleanStem` は Notion Files property のファイル名を使う。名前を変えると URL も変わるが、旧 object は残す
- 同じ画像セットは同じ `assetHash`、入力 bytes または変換契約が変われば hash も変わる
- 本文 animation は変換せず byte-for-byte で S3 へコピーし、`srcset` を付けない
- animated thumbnail は現在 validation error

### 既存 WordPress 画像の最終移行

`normalize-media` は既定で dry-run。参照中の画像だけを調べ、旧 URL から canonical URL への mapping を作る。

```bash
cd tools/migrate-to-notion
bun run fetch
bun run normalize-media

# report と preview mapping を確認してから実画像を追加する
bun run normalize-media --apply

# production mapping を必須入力として変換・投入する
bun run dry-run
bun run upload
```

- `--apply` だけが media S3 へ書く
- `upload` だけが Notion へ書く
- static image の mapping 欠落は import error
- 既存 animation と ICO は旧 URL のまま
- 旧 object は削除しない
- final import 後の Notion 画像 URL に `-1999x...` などの WordPress 寸法サフィックスを残さない

## Amazon 商品カード

今後の新規記事でも `[amazon]` shortcode を使う。

```text
[amazon asin="B000000000" kw="検索語" title="fallback 商品名"]
```

- `asin`、`kw`、`title` はすべて必須
- legacy `size` は Nuxt が使っていないため廃止。移行時に削除する
- SSG では静的 fallback card を必ず出す
- browser が署名済み ASIN を最大 10 件ずつ Workers API へ送り、Creators API の title、画像、公式 `detailPageURL` で更新する
- 署名は public HTML に埋め込む capability token であり secret ではない。公開済み ASIN の request は第三者も再送できるが、未署名の ASIN は取得できない
- browser の接続先は build 時の `WORKERS_API_ORIGIN` から Nuxt public runtime config へ埋め込む
- Amazon API の CORS は環境別 `FRONTEND_ORIGIN`、Worker 自身、dev の loopback origin だけを許可する
- `nuxt dev` は明示設定がなければ dev Worker へ接続し、generate は prd Worker を既定にする
- OAuth token は有効期限前まで、商品情報は最大 1 日 KV cache する
- 商品なしは 1 時間、OAuth・通信・一時的な API failure は 5 分 negative cache する
- endpoint は Cloudflare location ごとに 60 request / 分へ制限し、超過時は静的 fallback card を維持する
- API failure や JavaScript 無効時も fallback card を維持する
- 商品が返らない場合は画像を追加せず、`title` を表示名にした静的 card を維持する

## 必須設定

`server/wrangler.jsonc` の vars に加え、dev / prd へ次の secret を登録する。

- Notion: `NOTION_TOKEN`, `NOTION_WEBHOOK_SECRET`
- Amazon: `AMAZON_CARD_SIGNING_SECRET`, `AMAZON_CREATORS_CREDENTIAL_ID`, `AMAZON_CREATORS_CREDENTIAL_SECRET`
- コメント: `TURNSTILE_SECRET`。コメント API 実装までは設定だけで未使用
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `THUMBNAIL_FUNCTION_URL`
- X: `XAI_API_KEY`
- KV: dev / prd の `CONTENT_CACHE` namespace ID

AWS credential は site / media bucket と対象 CloudFront distribution だけへ絞る。
Creators API の日本向け credential version `3.3` と media bucket 名は vars で管理する。

- site bucket: object の `GetObject` / `PutObject` / `DeleteObject`
- media bucket: object の `GetObject`（`HeadObject` を含む）/ `PutObject`
- CloudFront: 対象 distribution の `CreateInvalidation`

空の site bucket への bootstrap は publish index の `GetObject` 権限がなくても成功しうる。
初回設定では bootstrap 後に同じ page の partial publish も通し、読取権限まで確認する。

## 失敗時

- Notion client は 429 の `Retry-After` に従って最大 5 回 retry し、その後の一時失敗は Workflow が retry する
- Container、S3、CloudFront の一時失敗は Workflow が retry する
- S3 object 更新後に失敗しても publish index が最後なので、同じ job を再実行できる
- publish index 更新後に response を失っても、同じ revision の publish / unpublish を再実行できる
- Notion update の response を失った場合は page を再取得し、期待値が反映済みなら成功扱いにする
- 失敗時の Notion state は publish index の実配信状態から復元し、index を読めない場合は state を推測しない
- rollback は旧 GitHub deploy workflow または S3 versioning 上の直前 object を使う

## production bootstrap 前

- dev で新規公開、更新、非公開、重複 Webhook、途中失敗を実動確認する
- dev / prd の bucket、CloudFront、KV、Secrets と Access policy を確認する
- Creators API を実 ASIN で確認する
- production の site bucket に `_internal/*` の Deny を入れる。dev には入っているが production にはまだない
- media normalization の unresolved static image を 0 件にする
- dev Notion data source へ external WebP canary を投入する
- 470 page の route uniqueness と full generate を通す
- production bootstrap、Webhook subscription 有効化、GitHub release 切り替えは別の明示 GO 後に行う

## WordPress 廃止前

- 既存コメントの記事との対応、本文、承認状態、親子関係、日時、投稿者名、非公開のメールアドレスを保ったまま新しい保存先へ移行する
- コメント投稿、Turnstile、承認・返信、通知、コメント feed を新基盤へ切り替える
- 検索画面、PV 送信、`site-admin-extension` を Workers / Analytics Engine / Notion へ切り替える
- 廃止するいいね UI と WordPress endpoint 呼び出しを削除する
- Cron による R2 / S3 バックアップを稼働させる
- `app/src/app.config.ts` の `mirumi.in` / WordPress `baseURL` と、旧 GitHub release 処理を削除する
- repository、生成 HTML、browser の実通信に WordPress endpoint が残っていないことを確認する
