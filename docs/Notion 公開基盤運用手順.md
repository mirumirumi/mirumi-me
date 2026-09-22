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

移行期間中は検索、PV、いいねが WordPress に依存する。
コメントはコードとしては新基盤へ切り替え済みで、Notion の comments schema 作成と既存コメントの import が残る。
コメント feed は移行せず廃止する。

## 記事の公開と非公開

通常操作は Notion のボタンから行う。

- `公開待ち` → Webhook → 公開成功後に `公開中`
- `非公開待ち` → Webhook → 非公開成功後に `非公開`
- Webhook は同じ event ID の重複配送を正常系として扱う
- build 中に page が再編集された場合は S3 更新前に中止する
- 一度公開した slug は publish index が所有し続ける。slug 変更や別 page での再利用は自動では行わない
- `公開日` は初回公開で 1 回だけ Worker が決める。`更新日` は再公開で本文・title・画像などの内容が
  前回の配信から変わったときだけ Worker が決める（判定は publish index の `sourceHash`）。
  誤字修正でも動く。full build は Notion へ書き戻さないので `更新日` も動かない
- production の render warning は 1 件でも公開を止める

手動の部分公開は Access 配下の `POST /admin/publish`、状態確認は `GET /admin/workflows/:instanceId` を使う。action は request ではなく Notion の最新 state から決まる。

### 非公開にしたはずの記事が一覧に残っているとき

publish index の保存は S3 配信のあとに行うため、最後の index 保存だけが失敗すると配信内容と index がずれる。
公開なら次の公開でそのまま揃うが、非公開では記事の実体が消えたまま index が公開中の記録を保つため、
次の部分公開で一覧、sitemap、feed にその記事が復活してリンク切れになる。復旧は full build を回すだけでよい。

### Webhook subscription の初回設定

購読するイベントは `page.properties_updated` と `page.created` の 2 つ。
`page.created` はコメントの承認・返信（Notion UI でテンプレートから一度にプロパティを埋めて作った row）を
取りこぼさないためのもので、Worker は page を 1 回取得して comments の承認済み row のときだけ動く。
他の型は署名検証後に `ignored` として 200 を返すだけになる。

Notion が送った `verification_token` は通常ログへ出さず、`CONTENT_CACHE` に 10 分だけ保存する。
subscription 作成直後に Access 配下の `GET /admin/notion-webhook-verification` で 1 回だけ取得し、
Notion の確認画面へ貼り付けたあと、同じ値を `NOTION_WEBHOOK_SECRET` へ登録する。
endpoint は取得時に一時保存値を削除する。期限切れの場合は Notion 側から token を再送する。

## コメント

設計の経緯は `.contexts/コメント基盤の移行設計.md`。保存先は private な Notion `comments` データソースで、
Nuxt は Notion も Worker も読まない。Container が approved を取得して `BuildPage.comments` に入れ、
コメント本文は静的 HTML と payload に焼き込まれる。ローカル dev は常に 0 件。

- 公開フォームは `POST /api/comments` だけ。Origin は `FRONTEND_ORIGIN` のみ、IP 単位の rate limit のあと
  publish index の公開中 slug、同じ slug の承認済み親、Turnstile（hostname と action `comment`）を順に検証し、
  `status=承認待ち` / `from=公開フォーム` の row を作る。同じ `request-id` の再送は作り直さず 202
- Notion で `status` / `本文` / `投稿者名` / `親コメント` が変わるか、承認済み row が作られると
  `CommentRefreshWorkflow` が動く。publish index の `contentHash` が指す
  `_internal/published-pages-v1/{pageId}/{contentHash}.json` の snapshot から comments だけを差し替え、
  記事 1 本の HTML / payload（と hash 付き `_nuxt`）だけを置いて invalidation する。集約 route、XML、
  `deployedNotionEdit`、posts の row には触れない
- 失敗は row の `公開エラー` に残り、`status` は desired state として残る。次の承認操作か full build で収束する
- **この Container を初めて deploy したあとは full build を 1 回通す。** snapshot が無い記事は
  comment-refresh が「公開済み snapshot がありません」で失敗する
- 非表示にするときは `status` を `承認待ち` か `スパム` に変える。返信が付いた親だけを非表示にしても
  子は消えず、最も近い表示中の先祖（無ければ root）につなぎ直して描画する。row を削除した場合も
  子は root へ繰り上がるが、slug を追えず refresh は動かないので、削除ではなく `ゴミ箱` にする
- owner reply は親 row のボタン `返信` で作る（「ページを追加」がテンプレート「管理者の返信」で `投稿者名` /
  `管理者コメント=true` / `from=管理者` / `本文形式=プレーンテキスト` / `status=承認待ち` を埋め、`親コメント=このページ`
  を足して開く）。書き終えたら `status=承認済み` にする。テンプレートとボタンは API で作れないので prd でも UI で作る。
  `slug` が空なら comment-refresh が `親コメント` を 5 段までたどって決め、row に書き戻す。full build も
  親から補う。`本文形式` と `投稿日` が空なら `プレーンテキスト` と作成時刻に倒し、本文が空の承認済み row は描画しない
- digest は 09:00 JST の Cron が `from=公開フォーム AND 通知日 is empty` を集めて SES で
  `COMMENT_DIGEST_RECIPIENT` に送る。0 件なら送らない。送信後に `通知日` を書く
- Notion の property 名は `shared/src/notion-comments.ts` の `COMMENT_PROPERTIES`、select の option 名は
  同ファイルの `*_LABELS` が正。Notion 側で名前を変えたらここを合わせる（property ID は変わらない）
- `親コメント` は自分自身への relation だが、Notion の片方向（single property）の self relation は対称に
  なって親子の向きが消えるため、`子コメント` を逆側に持つ双方向（dual property）にする。コードは `親コメント` しか読まない
- Notion の date property は秒を切り捨てる。`投稿日` が同じ分のコメントは public ID の順で並び、
  移行の hash 照合も分の精度で行う
- `投稿者名` の property ID は `title` で posts / pages とも共通のため、記事タイトルの編集でも Webhook が
  comments の row かどうかを 1 回 `pages.retrieve` で確かめてから無視する（許容している）
- Notion の page / query 応答は rich_text を 25 object までしか返さない。公開フォームは最大 3 object だが、
  Notion UI で装飾やリンクを多用した owner reply は 25 を超えると本文が途中で切れる
- 既存コメントの移行は `tools/migrate-to-notion` の `fetch-comments` → `import-comments`（`--dry-run` で計画だけ）
  → `verify-comments`。state は `comments-import-state.json`、export はメールを含むので git に入れない。
  再実行は同じ row を作らず、hash が変わった row を更新し、承認済みから外れた row を `trash` にする

## Cloudflare Access

- `mirumi-me-preview` は dev / prd の `/preview` と `/preview/*`、`mirumi-me-admin` は `/admin` と `/admin/*` を保護する
- どちらも Cloudflare account member だけを許可し、session duration は 24 時間
- application cookie は SameSite=Lax、HttpOnly、Binding Cookie、Path Cookie を有効にする。
  Strict にすると Access のログイン（team domain → callback → app）がクロスサイトのリダイレクト連鎖になり、
  最後のリクエストに cookie が送られずリダイレクトループになる
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

初回だけ、上の `mode` を `bootstrap` にする。**これは省略できない。**
`full` は Notion へ結果を書き戻さない（全件 writeback を避けるための仕様）ため、
`full` だけで初回を通すとサイトは正しく配信されるのに Notion の `last-deploy` が空のままになり、
`status` が全件 `⚪ 未公開` に見える。`last-deploy` を初期化するのは `bootstrap` だけ。
**`bootstrap` は publish index が存在すると実行できない**（`validateBootstrapIndex`）。
`full` を先に流すと index ができてしまい、以後 `bootstrap` は永久に拒否される。
順序を間違えると `last-deploy` を初期化する手段がなくなるので、初回は必ず `bootstrap` から始める。
例外は同じ `requestedAt` で投げ直したときだけで、これは中断した bootstrap を再開するための経路。

dev CloudFront distribution は常時有効で、CloudFront Function が閲覧を絞る。

`deploy.yml` の trigger は `mode` を `full` で決め打ちしているため、CI から `bootstrap` は流れない。
初回は CI を有効化する前に手元から 1 回 `bootstrap` を流し、それを見届けてから CI へ切り替える。

### partial publish と Nuxt の app manifest

Nuxt の client は `_nuxt/builds/meta/<buildId>.json` の `prerendered` に載っている route だけを
prerender 済みとみなし、サイト内遷移で `_payload.json` を読む。載っていない route へ遷移すると
API を直叩きして、静的サイトにはないため本文が空のまま描画される（直接開くと正常なので気づきにくい）。
partial の generate はその回の route しか載せないため、Container が deploy 前に配信中の manifest と
和集合を取っている（`app-manifest.ts`）。この仕組みは配信中の manifest を起点にするので、
**Container のこの機能を初めて deploy したあとと、manifest が欠けた疑いがあるときは full build を 1 回通す。**

`routeRules` の `prerender: true` で回避しようとしてはいけない。Nuxt の `prerender.server` plugin が
静的ページを全部生成対象に足すため、partial の generate が manifest にないページで落ちる。

### full / bootstrap build の見かた

- 470 記事で **40 分から 1 時間**かかる。大半は thumbnail を持たない記事の自動生成 Lambda で、
  publish index に載れば次回以降は省略される。**止まって見えても落とさない**
- 進捗は site bucket の `_internal/jobs/<workflowId>.json` に出る。`phase` は
  prepare / load-articles / build-pages / generate / deploy / done
- `full` と `bootstrap` は `retries: 0`。数時間をやり直さないための判断なので、
  失敗したら原因を直して手動で投げ直す
- Container の標準出力はどこからも読めない。generate が落ちた原因は例外へ載せて
  Workflow まで持ち上げている
- job が終わったのに Container instance が `running` のままなら、`sleepAfter` は SIGTERM を
  送るだけで PID 1 は既定ではシグナルを無視することを疑う。`wrangler containers instances <id>`
  で確認できる。気づく手がかりが課金しかないので、build のあとは一度見ておく

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
- トップと内部ブログカード: 412。トップと一覧のカードは thumbnail がない記事でも自動生成 OGP の 412 variant を使う（記事ヘッダーと内部ブログカードには出さない）
- key: `{assetHash}-{cleanStem}-{size}.webp`
- thumbnail の `cleanStem` は Notion Files property のファイル名を使う。名前を変えると URL も変わるが、旧 object は残す
- 同じ画像セットは同じ `assetHash`、入力 bytes または変換契約が変われば hash も変わる
- 本文 animation は変換せず byte-for-byte で S3 へコピーし、`srcset` を付けない
- animated thumbnail は現在 validation error
- thumbnail が canonical でなければ publish 時にホストを問わず取り込んで正規化する。Notion upload も WordPress 時代の `mirumi.media` 直下の画像も同じ経路を通る

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
- コメント: `TURNSTILE_SECRET`、`SES_ACCESS_KEY_ID`、`SES_SECRET_ACCESS_KEY`
  （`ses:SendEmail` だけを許した専用 credential。SES は sandbox のまま使うので、送信元 `mirumi.me` の
  domain identity がある `us-east-1` で宛先アドレスも verified identity にする。production access の申請は不要）
- Turnstile の widget は `mirumi-me-comments-prd`（site key は `nuxt.config.ts` に直書き、dev / prd 共通）。
  hostname は `mirumi.me`、dev の CloudFront domain、`localhost` の 3 つで、widget の描画はどこでも同じになる。
  siteverify の hostname は `FRONTEND_ORIGIN` と照合するので、token を使えるのは dev / prd のサイトからだけ
- コメント vars: `NOTION_COMMENTS_DATA_SOURCE_ID`、comments の `status` / `本文` / `投稿者名` / `親コメント` の
  property ID（`NOTION_COMMENT_*_PROPERTY_ID`。空だと comments の Webhook を無視する）、`SES_REGION`、
  `COMMENT_DIGEST_SENDER`。宛先の `COMMENT_DIGEST_RECIPIENT` は個人アドレスなので secret
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `THUMBNAIL_FUNCTION_URL`
- X: `XAI_API_KEY`
- KV: dev / prd の `CONTENT_CACHE` namespace ID

AWS credential は site / media bucket と対象 CloudFront distribution だけへ絞る。
Creators API の日本向け credential version `3.3` と media bucket 名は vars で管理する。

- site bucket: object の `GetObject` / `PutObject` / `DeleteObject`（Worker も `POST /api/comments` の slug 検証で
  publish index を `GetObject` する）
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
- rollback は Notion の内容を戻して再公開するか、full build を回す。site bucket に S3 versioning は入れていない

## production bootstrap 前

- dev で新規公開、更新、非公開、重複 Webhook、途中失敗を実動確認する
- dev / prd の bucket、CloudFront、KV、Secrets と Access policy を確認する
- Creators API を実 ASIN で確認する
- production の site bucket に `_internal/*` の Deny を入れる。dev には入っているが production にはまだない
- media normalization の unresolved static image を 0 件にする
- dev Notion data source へ external WebP canary を投入する
- 470 page の route uniqueness と full generate を通す
- production bootstrap、Webhook subscription 有効化、GitHub release 切り替えは別の明示 GO 後に行う
- けいが記述：本当は Notion の dev 系データソースでカラム幅みたいに見た目レベルで調整したものをそのまま本番でも使いたいから、すべての作業が終わって WP データ移行する直前に dev のデータソース丸ごと複製するようにしたいけど、いろんな id とか変わっちゃったりしないかという点で悩ましい

## WordPress 廃止前

- 既存コメントの記事との対応、本文、承認状態、親子関係、日時、投稿者名、非公開のメールアドレスを保ったまま新しい保存先へ移行する
- コメント投稿、Turnstile、承認・返信、通知、コメント feed を新基盤へ切り替える
- 検索画面、PV 送信、`site-admin-extension` を Workers / Analytics Engine / Notion へ切り替える
- 廃止するいいね UI と WordPress endpoint 呼び出しを削除する
- Cron による R2 / S3 バックアップを稼働させる
- `app/src/app.config.ts` の `mirumi.in` / WordPress `baseURL` と、旧 GitHub release 処理を削除する
- repository、生成 HTML、browser の実通信に WordPress endpoint が残っていないことを確認する
