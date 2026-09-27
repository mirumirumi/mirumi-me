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
`docs/L1/Notion 移行 やること.md` の必須項目を完了し、runtime の WordPress 依存をすべて撤去したあとに WordPress を完全廃止する。

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

**posts / pages に page を作ると Workers Logs に warn が出るが、想定どおりで対応不要。**
subscription はデータソース単位ではないので、posts / pages の page 作成でも `page.created` が届く。
Worker は comments の `status` の property ID を `filter_properties` に付けて page を取得してから comments の row かを判定するため、
その property が無い posts / pages では Notion が `validation_error`（`filter_properties contains an invalid attribute`）を返す。
これを `@notionhq/client warn: request fail` として SDK が出し、ハンドラは comments ではないとみなして `ignored` で返す。
publish や comment refresh の失敗ではない

Notion が送った `verification_token` は通常ログへ出さず、`CONTENT_CACHE` に 10 分だけ保存する。
subscription 作成直後に Access 配下の `GET /admin/notion-webhook-verification` で 1 回だけ取得し、
Notion の確認画面へ貼り付けたあと、同じ値を `NOTION_WEBHOOK_SECRET` へ登録する。
endpoint は取得時に一時保存値を削除する。期限切れの場合は Notion 側から token を再送する。

## コメント

設計の経緯は `docs/L2/コメント基盤の移行設計.md`。保存先は private な Notion `comments` データソースで、
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
    - SES は us-east-1。送信元は `mail@mirumi.me`、宛先は verify 済みの outlook.com アドレス。アカウントはまだサンドボックス
    - **サンドボックスでは送信元の identity だけでなく宛先の identity にも `ses:SendEmail` の許可が要る。**
      IAM user `mirumime-comment-digest` の policy が `identity/mirumi.me` だけだった 2026-09-23〜25 は毎朝
      `SES SendEmail が失敗しました: 403` で落ちていた。宛先の identity ARN を足した（2026-09-25）翌朝から送れている。
      送信に失敗した row は `通知日` が空のまま翌日に持ち越されるので、コメントは失われない
    - 届いたかどうかは `通知日` と CloudWatch の `AWS/SES` の `Send` / `Delivery` / `Bounce` で確認できる。
      Worker の `comment_digest_finished` のログは Observability に残らないことがある（2026-09-26 に実測）
    - 2026-09-26 に 1 通目が Outlook の迷惑メールに入った。当時の `mirumi.me` は DMARC レコードがなく、SPF は Microsoft 365 だけを許可しており、
      SES の送信は DKIM でしか `mirumi.me` として認証されていなかった
    - 対策として `terraform/modules/virginia/route53.tf` に `_dmarc.mirumi.me`（`v=DMARC1; p=none`）と、SES の MAIL FROM 用の
      `bounce.mirumi.me`（MX と SPF）を追加した（plan は 3 件追加のみ）。apex の MX / SPF は手動管理のままで触らない。
      SES identity `mirumi.me` の Custom MAIL FROM は `bounce.mirumi.me`（MX 失敗時は既定値へ fallback）で、これは Terraform 外の設定。
      2026-09-26 に圭くんが apply と SES の設定を行い、DNS の公開、`MailFromDomainStatus: SUCCESS`、apex の MX / SPF が不変なことを確認した
      （AI の実行環境では DNS 変更が止められるので、DNS まわりの変更は圭くんが手元で行う）
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

## 定期バックアップ

Cron（19:00 UTC = 04:00 JST）が `BackupWorkflow` を起動する。Worker だけで完結し、Container は使わない。
手動は `bunx wrangler workflows trigger mirumi-me-backup-dev '{"source":"admin","requestedAt":"ISO_DATETIME"}' --env dev --id backup-manual-…`。

- 保存先は R2 `mirumi-me-backup-{env}`（binding `BACKUP`）と S3 `mirumime-{env}-backup`（`BACKUP_BUCKET_NAME`）。
  key は両方とも `v1/<requestedAt を YYYY-MM-DDTHH-mm-ssZ にした値>/` 配下で同じ
- 3 段のうちの 2 段をここで取る。残りの 1 段は Notion 側の自動保存
    - Notion の raw: `notion-data-sources.json`（posts / pages / categories / comments の schema）と
      `notion-{posts,pages,categories,comments}.ndjson.gz`（1 行 = `{ page, blocks }`。`blocks` は Block API の応答の木で、
      ゴミ箱内は含めない）。下書きも入る。comments はメールアドレスを含むので両バケットとも公開経路を持たない
    - render 直前: `publish-index.json` と `published-pages.ndjson.gz`（index が指す `_internal/published-pages-v1` の
      `BuildPage` をそのまま。再レンダリングはしない）。index が無い環境では書かない
    - `manifest.json`: 各 file の bytes / sha256 / 件数と Notion の API version
- R2 に置いてから file ごとに S3 へ複製する。S3 は `DEEP_ARCHIVE`（即時には読めない）で、manifest だけ `STANDARD`。
  manifest を最後に書くので、manifest があればその回は完了している
- 保持期間は決めていない。消すなら R2 / S3 の lifecycle で行い、コードでは消さない
- 全体で 18 分ほどかかる。ほぼ全部が posts の step（467 記事 / 53,016 block で 17 分）で、他の step は
  すべて 15 秒以内に終わる。Workflow instance の subrequest 上限（10,000）と Worker のメモリ
  （gzip 済み bytes しか抱えない）の範囲に収まっている
- 壊れたときの手順は `docs/reference/バックアップからの復旧手順.md`

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

### 手元から full build を投げる

コードを変えずにサイト全体を作り直したいときは、npm script を使う。

```bash
bun run full-build:dev
bun run full-build:prd   # yes の入力を求められる
```

`--dry-run` を付けると、投げずに instance ID と payload を表示する。
初回だけ必要な `bootstrap` は `--mode bootstrap` で流す（`--` の後に渡す）。

```bash
bun run full-build:dev -- --mode bootstrap --dry-run
```

スクリプトがやっていること。

- 走っている instance（`running` / `queued` / `waiting` / `paused`）があれば投げずに中止する。
  重ねるとキューで待つだけになり、そのあいだ partial publish が 409 で断られる
- `source` を `release` で固定する。`full` と `bootstrap` はこれ以外だと入力検証で弾かれる
- instance ID を時刻から作る。同じ ID は二度投げられない
- wrangler の設定をスクリプト自身の位置から解決する。どのディレクトリから実行しても動く

**prd を手元から投げるのは例外的な操作。**通常は `main` への push で `deploy.yml` が
deploy のあとに投げる。手動が必要なのは、CI のビルドだけが失敗した場合や、
コードを変えずに全記事を作り直したい場合。次の 2 点に注意する。

- **初回は `full` ではなく `bootstrap`**。詳細は上の「application release と full build」を参照。
  順序を間違えると `last-deploy` を初期化する手段がなくなる
- CI が deploy している最中には投げない。スクリプトは走っている Workflow は見るが、
  進行中の deploy は検知できない

### deploy 直後に build を投げない

`wrangler deploy` が Container image を差し替えると、Container application の rollout が始まる。
rollout が走っている間に起動した instance は **`Runtime signalled the container to exit due to a
new version rollout` で途中で殺される**。Worker 側には `Container error:` とだけ出て、
Workflow には `Container の publish job が失敗しました: 500` しか残らないので原因が見えにくい。
`full` は retries 0 なのでそのまま Errored になる。

deploy のあとは rollout の完了を待ってから trigger する。

```bash
bunx wrangler containers list --env dev
```

`LAST MODIFIED` が deploy 時刻より後になり、それ以上動かなくなったら rollout は終わっている
（image を変えない deploy なら rollout は起きないので待つ必要はない）。

2026-09-24 に dev で踏んだ。deploy の約 1 分後に full build を投げて 2 分で Errored、
rollout の完了は trigger の 2 分半後だった。`deploy.yml` にも同じ問題があったため、
deploy と trigger の間に `Wait for container rollout` を挟んである（固定 5 分 + `state` の確認）。

### 複数記事の公開が重なったとき

publish はすべて `BUILD_CONTAINER.getByName("publisher")` という単一の Durable Object に集まり、
`SerialJobQueue` で直列化される。publish index を 1 本の書き手で守るための設計で、これ自体は正しい。
ただし **後から来たジョブの待ち時間も Workflow step の timeout に数えられる**ので、
同時に投げられる本数には上限がある。partial の step は 30 分 timeout・retries 2。

1 本あたりの partial publish は 1.5〜4 分なので、数記事が重なる程度（コメント承認が続く、
数本の記事を続けて更新する）は普通に流れる。10 本以上を一気に投げるときだけ
`POST /admin/publish` に pageIds をまとめて渡し、Workflow と Container ジョブを 1 本にする。

- 通常の執筆・コメント承認は気にせず操作してよい。
  **ただし full build 中だけは 409 で断られる**（後述の「full build 中に触ってはいけないこと」）
- 大量にまとめて公開したいときは `POST /admin/publish` に pageIds を複数渡す
- 全記事へ反映したいときは full build を回す。publish index が埋まっていれば 35 分ほどで終わる
  （2026-09-25 実測。x-post と bookmark の KV キャッシュが冷えていると 1 時間 30 分かかった）
- 詰まったときは `wrangler workflows instances list` で走っている instance を確認し、
  1 本ずつ終わらせる。`--status` は `running queued waiting paused` を順に見る。
  terminate しても Container 内のジョブは走り続ける点に注意

同時実行を安全にするために入れた対策が 2 つある。壊さないよう注意すること。

- `destroyOutdatedInstance()`：Container の作り直しは `CF_VERSION_METADATA.id` が
  前回と変わったときだけ。以前はジョブごとに `destroy()` していて、連続実行時の cold start churn が
  詰まりの主因と見ている。version が取れない環境では従来どおり毎回作り直すフォールバックが残っている
- `SerialJobQueue` の `workflowId` dedupe：step が timeout して retry が来たとき、
  実行中の同じジョブに相乗りする。以前は retry がキューを積み増して詰まりを悪化させていた

2026-09-24 に dev で 3 記事を同時に `公開待ち` にしたときは、2 本が 45 分で Errored、
1 本が 1 時間走り続けた。上記 2 つを入れてから同じ手順（2 記事同時）を再実行したところ、
1 本目 1 分 55 秒・2 本目 3 分 35 秒で両方 Completed した。2 つ同時に入れたので
どちらが効いたかは切り分けていない。

### partial publish と Nuxt の app manifest

Nuxt の client は `_nuxt/builds/meta/<buildId>.json` の `prerendered` に載っている route だけを
prerender 済みとみなし、サイト内遷移で `_payload.json` を読む。載っていない route へ遷移すると
API を直叩きして、静的サイトにはないため本文が空のまま描画される（直接開くと正常なので気づきにくい）。
partial の generate はその回の route しか載せないため、Container が deploy 前に配信中の manifest と
和集合を取っている（`app-manifest.ts`）。この仕組みは配信中の manifest を起点にするので、
**Container のこの機能を初めて deploy したあとと、manifest が欠けた疑いがあるときは full build を 1 回通す。**

`routeRules` の `prerender: true` で回避しようとしてはいけない。Nuxt の `prerender.server` plugin が
静的ページを全部生成対象に足すため、partial の generate が manifest にないページで落ちる。

### full / bootstrap は受け付けと待機を分けている

partial は `publish-site` step の中で Container の結果をそのまま待つ。1〜4 分で終わるのでこれでよい。

full / bootstrap は 1 時間を超えるため、同じ形にすると「結果を待っているだけの invocation」が
Workers の hang 判定で打ち切られる（2026-09-24 に 20 分で踏んだ）。そこで step を分けてある。

```
start-publish-site        Container に受け付けさせるだけ。数秒で返る
wait-publish-site-N       step.sleep で 1 分眠る
poll-publish-site-N       Container に状態を聞く。done なら summary を受け取って抜ける
```

polling は最大 720 回＝12 時間で打ち切る。publish index が空の初回ビルドは全記事の thumbnail
生成が走るため極端に遅く、dev では 1 回の試行が 4.7 時間走ってまだ終わっていなかった。
本番 bootstrap も同じ条件なので、余裕を取ってある（`step.sleep` は step 上限に数えられない）。Container 側は `POST /publish` が 202 を返して
background で走り、`GET /publish-state` が `running` / `done` / `failed` / `unknown` を返す。
`unknown` は Container が作り直されて受け付けた記録を失った状態なので、待たずに失敗させる。

**publish index の書き手を 1 本に保つ責務は Container 側へ移っている。**
`server/src/containers/http.ts` の `SerialJobQueue` が partial の同期実行・full の background 実行・
comment refresh をすべて同じ queue に通す。DO 側の queue は step retry の相乗り用に残してある。

#### full build 中に触ってはいけないこと

full build のあいだ、Container は「HTTP を開いたまま待っていない」状態で走り続ける。
そのため次の 3 つを、走っているジョブを壊さないための仕掛けとして入れてある。
**消すと 1 時間以上のビルドが無言で死ぬので注意。**

- **`BuildContainer.onActivityExpired()` の override**（`containers/container.ts`）。
  ライブラリは inflight request が無いと 15 分（`sleepAfter`）で SIGTERM を送るが、
  background の build は inflight を持たない。Container 本人に `GET /jobs` で聞いて、
  走っていれば見送る。ライブラリがこのあと必ず `renewActivityTimeout()` を呼ぶので猶予が伸びる
- **`destroyOutdatedInstance()` の busy ガード**。`destroy()` は SIGKILL なので、
  走っているジョブがあるときは version を記録せずに見送り、空いている次のジョブで作り直す
- **partial publish と comment refresh は full build 中だと 409 で断る**
  （`containers/request-handler.ts`）。待たせると Workflow 側が hang 判定で殺され、
  Notion へ失敗も書けないままジョブだけ 1 時間後に実行されて
  「サイトには出ているのに Notion は 公開待ち」になるため。
  **partial 同士は今まで通りキューに積む**（コメント承認や記事更新を続けて行う通常運用）
- **14 時間を超えて走り続けているジョブは「ハングした」とみなす**（`background-publish.ts`）。
  ジョブの promise が永久に settle しないと、409 で publish が止まり Container も止められない
  ため、その時点で上の 3 つのガードをすべて解除して自力で回復させる。
  Workflow の polling 予算（12 時間）より長く取ってあるので、待っている人がいるビルドは切らない

**手動で deploy するときは、full build が走っていないことを先に確認する。**
走っている最中に deploy しても上のガードでビルドは死なないが、
**新しい image はその build に反映されない**（古い image のまま完走する）。
CI には `Check running publish workflow` step を入れてあるので、CI 経由なら自動で落ちる。

```bash
for status in running queued waiting paused; do
  bunx wrangler workflows instances list mirumi-me-publish-dev --status "$status" --env dev
done
```

`step.sleep` 中の instance がどの status で報告されるかは環境依存なので、まとめて見る。

#### CloudFront invalidation は 2 回流れる

full / bootstrap では、Container がジョブ末尾に自分で invalidation を流す。
Workflow が hang 判定などで先に諦めても CDN が更新されるようにするためで、
`invalidate-cloudfront` step はそのまま残してある（冪等な念押し）。
step を分けてある理由は、CloudFront のレート制限（`TooManyInvalidationsInProgress`、
wildcard 同時 15 件上限）が build とは別の障害ドメインで、
ビルドをやり直さずに指数バックオフで 5 回まで retry したいから。
Container 側の失敗はログに残すだけで build 結果を捨てない。
CallerReference の seed を `container:` 付きにして、2 つを別の invalidation として扱わせている。

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

🚧 現行の `.github/workflows/deploy.yml` からこの方式への切り替えは、production bootstrap と同じ明示 GO のあとに行う。

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
- key: 本文は `{assetHash}-{cleanStem}-{setWidth}x{setHeight}-{actualWidth}w.webp`、thumbnail は `{assetHash}-{cleanStem}-{width}x{height}.webp`
- `{setWidth}x{setHeight}` は本文画像セットの最大 variant の実寸。フロントエンドはこれを `<img>` の `width` / `height` に出す（Notion の image block に寸法がないため URL で運ぶ）
- 画像変換契約は `v2`（2026-09-25 に本文 key へ寸法を追加して `v1` から上げた。`v1` の本文 object は S3 に 1 つも作られていない）
- thumbnail の `cleanStem` は Notion Files property のファイル名を使う。名前を変えると URL も変わるが、旧 object は残す
- 同じ画像セットは同じ `assetHash`、入力 bytes または変換契約が変われば hash も変わる
- 本文 animation は変換せず byte-for-byte で S3 へコピーし、`srcset` を付けない。key は `{assetHash}-{cleanStem}-{width}x{height}.{元の拡張子}` で、`width` / `height` だけ出す
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
- 既存 animation と ICO は旧 URL のまま。名前に寸法がないので `width` / `height` は付かない（20 件）
- 旧 object は削除しない
- final import 後の Notion 画像 URL に `-1999x...` などの WordPress 寸法サフィックスを残さない

**既存記事の画像まわりの最終形は dev には出ていない（2026-09-26 時点）。本番 import で初めて効く。**
dev の Notion は旧変換で取り込み済みで、本文画像も旧 URL（`<名前>-1999x1124.png` など）のまま入っている。そのため次の 2 つは dev では見えない。

- 本文画像の `width` / `height`。名前に寸法を持つ canonical URL にならないと付かない（`normalize-media --apply` と import が要る）
- `convert.ts` が import 時に付けるトークン。WordPress のエディタで変えた表示幅 `[image width="316px"]`（約 1,400 箇所）、
  本文幅より狭い画像の `align="none"`、`[quoteImage]` の `width`（漫画 17 箇所）、`align="center"` を付けないこと

render 側のコードはすべて dev に入っており、Notion に新しく upload した画像では `width` / `height` と新しい key まで end-to-end で確認済み。
dev で最終形を見るには `normalize-media --apply`（prd と共用の media バケットへ約 12,000 object を書く）と dev の取り込み直しが要るため、
圭くんの判断で本番リリースまで持ち越した。本番の手順（`normalize-media --apply` → import → `fix-toc-anchors --apply` → bootstrap）は変わらない

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
  domain identity がある `us-east-1` で宛先アドレスも verified identity にする。production access の申請は不要。
  sandbox では宛先 identity にも `ses:SendEmail` の認可がかかるので、IAM の `Resource` には送信元と宛先の
  両方の identity ARN を入れる。送信元だけだと 403 になる。IAM user `mirumime-comment-digest` は Terraform 管理外）
- Turnstile の widget は `mirumi-me-comments-prd`（site key は `nuxt.config.ts` に直書き、dev / prd 共通）。
  hostname は `mirumi.me`、dev の CloudFront domain、`localhost` の 3 つで、widget の描画はどこでも同じになる。
  siteverify の hostname は `FRONTEND_ORIGIN` と照合するので、token を使えるのは dev / prd のサイトからだけ
- コメント vars: `NOTION_COMMENTS_DATA_SOURCE_ID`、comments の `status` / `本文` / `投稿者名` / `親コメント` の
  property ID（`NOTION_COMMENT_*_PROPERTY_ID`。空だと comments の Webhook を無視する）、`SES_REGION`、
  `COMMENT_DIGEST_SENDER`。宛先の `COMMENT_DIGEST_RECIPIENT` は個人アドレスなので secret
- AWS: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `THUMBNAIL_FUNCTION_URL`
- バックアップ vars: `BACKUP_BUCKET_NAME`（S3）。R2 は `r2_buckets` の `BACKUP`
- X: `XAI_API_KEY`
- KV: dev / prd の `CONTENT_CACHE` namespace ID

AWS credential は site / media bucket と対象 CloudFront distribution だけへ絞る。
Creators API の日本向け credential version `3.3` と media bucket 名は vars で管理する。

- site bucket: object の `GetObject` / `PutObject` / `DeleteObject`（Worker も `POST /api/comments` の slug 検証で
  publish index を `GetObject` する）
- media bucket: object の `GetObject`（`HeadObject` を含む）/ `PutObject`
- backup bucket: object の `PutObject`（Worker の Cron backup だけが書く。読み戻しは R2 から行う）
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

## 🚧 production bootstrap 前

- dev で新規公開、更新、非公開、重複 Webhook、途中失敗を実動確認する
- dev / prd の bucket、CloudFront、KV、Secrets と Access policy を確認する
- Creators API を実 ASIN で確認する
- production の site bucket に `_internal/*` の Deny を入れる。dev には入っているが production にはまだない
- media normalization の unresolved static image を 0 件にする
- dev Notion data source へ external WebP canary を投入する
- 470 page の route uniqueness と full generate を通す
- 本番 import 後、bootstrap 前に prd の `/preview?pageId=` で画像表示を mirumi.me（旧 WordPress 配信）と見比べる。dev では確認できていないため。
  `android-app`（縮めたスクショ）、`comics`（漫画の引用画像 415px）、`pc-freesoft` / `firefox-plugin`（インラインのアイコン）、
  `albumartwork-puttogether`（縮めた画像 + alt）、小さい画像が本文幅まで引き伸ばされていないこと
- production bootstrap、Webhook subscription 有効化、GitHub release 切り替えは別の明示 GO 後に行う
- けいが記述：本当は Notion の dev 系データソースでカラム幅みたいに見た目レベルで調整したものをそのまま本番でも使いたいから、すべての作業が終わって WP データ移行する直前に dev のデータソース丸ごと複製するようにしたいけど、いろんな id とか変わっちゃったりしないかという点で悩ましい

## 🚧 WordPress 廃止前

- 既存コメントの記事との対応、本文、承認状態、親子関係、日時、投稿者名、非公開のメールアドレスを保ったまま新しい保存先へ移行する
- コメント投稿、Turnstile、承認・返信、通知、コメント feed を新基盤へ切り替える
- 検索画面、PV 送信、`site-admin-extension` を Workers / Analytics Engine / Notion へ切り替える
- 廃止するいいね UI と WordPress endpoint 呼び出しを削除する
- Cron による R2 / S3 バックアップを稼働させる
- `app/src/app.config.ts` の `mirumi.in` / WordPress `baseURL` と、旧 GitHub release 処理を削除する
- repository、生成 HTML、browser の実通信に WordPress endpoint が残っていないことを確認する
