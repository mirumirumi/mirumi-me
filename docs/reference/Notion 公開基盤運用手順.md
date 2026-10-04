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

検索と PV は 2026-10-04 に Workers の API へ移した（いいねは廃止して UI も削除済み）。切り替えまでは、本番の mirumi.me は WordPress 版のフロントのまま。
コメントは dev では新基盤で動いていて、prd の comments の用意と既存コメントの import が残る（`本番リリース手順.md` の 2 と 3）。
コメント feed は移行せず廃止する。

## 記事の公開と非公開

通常操作は Notion のボタンから行う。

- 新しい記事や固定ページは、posts / pages の `新規` から作る。既定のテンプレート `template` が使われ、`internal-state` が `下書き` になる（テンプレートの一覧から `template` を選んでも同じ）
    - 貼り付けなどでテンプレートを通らずにできた row は、`internal-state` が空になる。generate / bootstrap は `下書き` と同じく何もしない（2026-10-03 から。それまでは 🔴 と Slack 通知になっていた）
    - 公開したことのある記事（`last-deploy` がある）で `internal-state` が空なのは壊れているので、generate / bootstrap でも「internal-state が空です」で失敗にする
- `公開待ち` → Webhook → 公開成功後に `公開中`
- `非公開待ち` → Webhook → 非公開成功後に `非公開`
- すでに `非公開` の記事でもう一度 `非公開` を押しても、失敗にせず `非公開` のままにする（2026-10-03 から）。一度も公開していない記事だけは「未公開の page は非公開にできません」になる
- Webhook は同じ event ID の重複配送を正常系として扱う
- build 中に page が再編集された場合は S3 更新前に中止する。`last_edited_time` は分単位で、ボタンを押した同じ分のうちの編集は
  見分けられないので、本文も取り直して比べる（変わっていたら「build 中に Notion page が変更されました」で 🔴。押し直せば通る）
- S3 に置いたあと、Notion へ 🟢 を書き戻す直前にも、本文が直されていないかを確かめる。直されていたら、直す前の本文で公開したうえで
  🔴（「公開の途中で本文が直されたので、直す前の本文で公開しました。もう一度「公開」を押してください」）にする
- 一度公開した slug は publish index が所有し続ける。slug 変更や別 page での再利用は自動では行わない
- `公開日` は初回公開で 1 回だけ Worker が決める。`更新日` は再公開で本文・title・画像などの内容が
  前回の配信から変わったときだけ Worker が決める（判定は publish index の `sourceHash`）。
  誤字修正でも動く。generate が Notion に書くのは `公開エラー` だけなので、`更新日` は動かない
- production の render warning は 1 件でも公開を止める
    - Notion にアップロードしたファイルを持つ embed（`/html` の HTML ブロック、PDF の埋め込みなど）は render warning になる。dev とプレビューでは、その場所に 🚨 の箱が出る

手動の部分公開は Access 配下の `POST /admin/publish`、状態確認は `GET /admin/workflows/:instanceId` を使う。action は request ではなく Notion の最新 state から決まる。

### 非公開にしたはずの記事が一覧に残っているとき

publish index の保存は S3 配信のあとに行うため、最後の index 保存だけが失敗すると配信内容と index がずれる。
公開なら次の公開でそのまま揃うが、非公開では記事の実体が消えたまま index が公開中の記録を保つため、
次の部分公開で一覧、sitemap、feed にその記事が復活してリンク切れになる。復旧は generate を回すだけでよい。

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
- 失敗は row の `公開エラー` に残り、`status` は desired state として残る。次の承認操作か generate で収束する
- **この Container を初めて deploy したあとは generate を 1 回通す。** snapshot が無い記事は
  comment-refresh が「公開済み snapshot がありません」で失敗する
- 非表示にするときは `status` を `承認待ち` か `スパム` に変える。返信が付いた親だけを非表示にしても
  子は消えず、最も近い表示中の先祖（無ければ root）につなぎ直して描画する。row を削除した場合も
  子は root へ繰り上がるが、slug を追えず refresh は動かないので、削除ではなく `ゴミ箱` にする
- owner reply は親 row のボタン `返信` で作る（「ページを追加」がテンプレート「みるみ」（comments の既定のテンプレート）で `投稿者名` /
  `管理者コメント=true` / `from=管理者` / `本文形式=プレーンテキスト` / `status=承認待ち` を埋め、`親コメント=このページ`
  を足して開く）。書き終えたら `status=承認済み` にする。テンプレートとボタンは API で作れない。prd は dev の comments を複製して作るので、そのとき一緒に入る（`本番リリース手順.md` の「2. prd の準備」）。
  `slug` が空なら comment-refresh が `親コメント` を 5 段までたどって決め、row に書き戻す。generate も
  親から補う。`本文形式` と `投稿日` が空なら `プレーンテキスト` と作成時刻に倒し、本文が空の承認済み row は描画しない
- digest は 09:00 JST の Cron が `from=公開フォーム AND 通知日 is empty` を集めて SES で
  `COMMENT_DIGEST_RECIPIENT` に送る。0 件なら送らない。送信後に `通知日` を書く
    - SES は us-east-1。送信元は `mail@mirumi.me`、宛先は verify 済みの outlook.com アドレス。アカウントはまだサンドボックス
    - **サンドボックスでは送信元の identity だけでなく宛先の identity にも `ses:SendEmail` の許可が要る。**
      IAM user `mirumime-comment-digest` の policy に宛先の identity ARN がないと、毎朝 `SES SendEmail が失敗しました: 403` で落ちる。
      送信に失敗した row は `通知日` が空のまま翌日に持ち越されるので、コメントは失われない
    - 届いたかどうかは `通知日` と CloudWatch の `AWS/SES` の `Send` / `Delivery` / `Bounce` で確認できる。
      Worker の `comment_digest_finished` のログは Observability に残らないことがある（2026-09-26 に実測）
    - 迷惑メールに入らないよう、`terraform/modules/virginia/route53.tf` で `_dmarc.mirumi.me`（`v=DMARC1; p=none`）と、
      SES の MAIL FROM 用の `bounce.mirumi.me`（MX と SPF）を管理している。apex の MX / SPF は手動管理のままで触らない。
      SES identity `mirumi.me` の Custom MAIL FROM は `bounce.mirumi.me`（MX 失敗時は既定値へ fallback）で、これは Terraform 外の設定
    - AI の実行環境では DNS 変更が止められるので、DNS まわりの変更は圭くんが手元で行う
    - 403 と迷惑メールを踏んだ経緯は `docs/L2/コメント基盤の移行設計.md` の「運用で踏んだこと」
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

## application release と generate

`wrangler deploy` は Worker、Workflow、Container のコード配備だけを行う。
今のコードでサイト全体を作り直すには、続けて generate が要る。用語は `docs/reference/用語集.md`。

### CI（`deploy.yml`）

| きっかけ | 出す先 |
| --- | --- |
| `main` への push | prd |
| `dev` への push | dev |
| `workflow_dispatch`（Actions の画面か `gh workflow run deploy.yml --ref <branch>`） | ref が `main` なら prd、それ以外は dev |

作業ブランチへの push では動かない。dev に出したいときは `git push origin HEAD:dev` する（force push してよい）。

1 回の run は 3 つの job に分かれる。

| job | やること |
| --- | --- |
| `plan` | generate が要るかを決める。結論と理由は run の Summary に出る |
| `deploy` | 走っている publish がないか確認し、`wrangler deploy` して、rollout が落ち着くまで待つ。毎回必ず行う |
| `generate` | `plan` が要ると決めたときだけ。Workflow を起動して完了まで待ち、失敗したら run が赤くなる |

generate が要るかは、次のように決める。

- 最後に完了した CI の generate（instance ID が `release-<SHA>-<run ID>-<attempt>`）のコミットと、今回のコミットの差分を見る
- 差分にサイトの生成物に効くファイルが 1 つでもあれば generate する
    - 効かないものとして扱うのは、docs、`.github`、terraform、tools、エージェントや editor の設定、テスト、Worker でしか動かないサーバーのコード
    - サーバーのコードが generate の経路に乗っているかは、Container と publish の Workflow の入口から import をたどって決める
    - それ以外（app、shared、依存、wrangler の設定、Dockerfile など）は効くものとして扱う
- 基準のコミットが見つからないときは generate する。手元から流した generate と bootstrap はコミットを持たないので基準にならない。
  完了した instance の記録が保持期間を過ぎたときや、dev の force push でコミットが消えたときも同じ
- `workflow_dispatch` の `generate` 入力（`auto` / `always` / `skip`、既定は `auto`）で上書きできる

同じ環境への run は 1 本ずつ流れる。generate を待っているあいだに push すると、次の run は待ちに入る。
待っている run がさらに新しい run に置き換えられても、判定は Cloudflare 側の記録との差分なので変更を取りこぼさない。
`generate` job を止めても、Cloudflare 側の generate は止まらない。

### 初回は bootstrap

初回だけ、generate ではなく `bootstrap` を流す。**これは省略できない。**
generate（`mode: "full"`）は Notion へ結果を書き戻さない（全件 writeback を避けるための仕様）ため、
generate だけで初回を通すとサイトは正しく配信されるのに Notion の `last-deploy` が空のままになり、
`status` が全件 `⚪ 未公開` に見える。`last-deploy` を初期化するのは `bootstrap` だけ。
**`bootstrap` は publish index が存在すると実行できない**（`validateBootstrapIndex`）。
generate を先に流すと index ができてしまい、以後 `bootstrap` は永久に拒否される。
順序を間違えると `last-deploy` を初期化する手段がなくなるので、初回は必ず `bootstrap` から始める。
例外は同じ `requestedAt` で投げ直したときだけで、これは中断した bootstrap を再開するための経路。

`deploy.yml` の trigger は `mode` を `full` で決め打ちしているため、CI から `bootstrap` は流れない。
初回は CI を有効化する前に手元から 1 回 `bootstrap` を流し、それを見届けてから CI へ切り替える。
bootstrap はコミットを持たないので、切り替えたあとの最初の run では generate が 1 回余分に走る（害はない）。

dev CloudFront distribution は常時有効で、CloudFront Function が閲覧を絞る。

### 手元から generate を投げる

コードを変えずにサイト全体を作り直したいときは、npm script を使う。

```bash
bun run generate:dev
bun run generate:prd   # yes の入力を求められる
```

`--dry-run` を付けると、投げずに instance ID と payload を表示する。
初回だけ必要な `bootstrap` は `--mode bootstrap` で流す（`--` の後に渡す）。

```bash
bun run generate:dev -- --mode bootstrap --dry-run
```

スクリプトがやっていること。

- 走っている instance（`running` / `queued` / `waiting` / `waitingForPause` / `paused`）があれば投げずに中止する。
  重ねるとキューで待つだけになり、そのあいだ partial publish が 409 で断られる
- `source` を `release` で固定する。`full` と `bootstrap` はこれ以外だと入力検証で弾かれる
- instance ID を時刻から作る。同じ ID は二度投げられない
- wrangler の設定をスクリプト自身の位置から解決する。どのディレクトリから実行しても動く

**prd を手元から投げるのは例外的な操作。**通常は `main` への push で `deploy.yml` が
deploy のあとに、必要なときだけ投げる。手動が必要なのは、CI の generate だけが失敗した場合や、
コードを変えずに全記事を作り直したい場合。次の 2 点に注意する。

- **初回は generate ではなく `bootstrap`**。詳細は上の「application release と generate」を参照。
  順序を間違えると `last-deploy` を初期化する手段がなくなる
- CI が deploy している最中には投げない。スクリプトは走っている Workflow は見るが、
  進行中の deploy は検知できない

### deploy 直後に generate を投げない

`wrangler deploy` が Container image を差し替えると、Container application の rollout が始まる。
rollout が走っている間に起動した instance は **`Runtime signalled the container to exit due to a
new version rollout` で途中で殺される**。Worker 側には `Container error:` とだけ出て、
Workflow には `Container の publish job が失敗しました: 500` しか残らないので原因が見えにくい。
generate は retries 0 なのでそのまま Errored になる。

deploy のあとは rollout の完了を待ってから trigger する。

```bash
bunx wrangler containers list --env dev
```

`LAST MODIFIED` が deploy 時刻より後になり、それ以上動かなくなったら rollout は終わっている
（image を変えない deploy なら rollout は起きないので待つ必要はない）。

`deploy.yml` では、`deploy` job の最後に `Wait for container rollout`（固定 5 分 + `state` の確認）を挟んである。
generate しない run でも待つので、CI が緑になった時点で公開を試してよい。
踏んだときの経緯は `docs/L2/Notion 公開基盤の設計.md` の「deploy 直後の Container rollout」。

### 複数記事の公開が重なったとき

publish はすべて単一の Container に集まり、直列に処理される（仕組みは `docs/L2/Notion 公開基盤の設計.md` の「publish の直列化と同時実行」）。
**後から来たジョブの待ち時間も Workflow step の timeout に数えられる**ので、
同時に投げられる本数には上限がある。partial の step は 30 分 timeout・retries 2。

1 本あたりの partial publish は 1.5〜4 分なので、数記事が重なる程度（コメント承認が続く、
数本の記事を続けて更新する）は普通に流れる。10 本以上を一気に投げるときだけ
`POST /admin/publish` に pageIds をまとめて渡し、Workflow と Container ジョブを 1 本にする。

- 通常の執筆・コメント承認は気にせず操作してよい。
  **ただし generate 中だけは 409 で断られる**（後述の「generate 中に触ってはいけないこと」）
- 大量にまとめて公開したいときは `POST /admin/publish` に pageIds を複数渡す
- 全記事へ反映したいときは generate を回す。publish index が埋まっていれば 35 分ほどで終わる
  （2026-09-25 実測。x-post と bookmark の KV キャッシュが冷えていると 1 時間 30 分かかった）
- 詰まったときは `wrangler workflows instances list` で走っている instance を確認し、
  1 本ずつ終わらせる。`--status` は `running queued waiting paused` を順に見る。
  terminate しても Container 内のジョブは走り続ける点に注意

同時実行を安全にするための対策が 2 つ入っている（`destroyOutdatedInstance()` と、`SerialJobQueue` の `workflowId` dedupe）。
壊さないよう注意すること。中身と、入れる前後の実測は L2 の同じ節にある。

### partial publish と Nuxt の app manifest

Nuxt の app manifest（`_nuxt/builds/meta/<buildId>.json`）から route が欠けると、その記事へサイト内遷移したときだけ
本文が空のまま描画される（直接開くと正常なので気づきにくい）。Nuxt generate はその回の route しか manifest に載せないため、
Container が deploy 前に配信中の manifest と和集合を取っている（`app-manifest.ts`）。partial だけでなく generate も同じで、
generate で作り直せなかった記事（`stalePageIds`）の route を消さないため（bootstrap だけは取らない）。この仕組みは配信中の manifest を起点にするので、
**Container のこの機能を初めて deploy したあとと、manifest が欠けた疑いがあるときは generate を 1 回通す。**

`routeRules` の `prerender: true` で回避しようとしてはいけない。partial の Nuxt generate が落ちる。
なぜ本文が空になるのか、なぜ `prerender: true` だと落ちるのかは `docs/L2/Notion 公開基盤の設計.md` の同名の節。

### generate / bootstrap は受け付けと待機を分けている

generate / bootstrap は 1 時間を超えるので、Container に受け付けさせたあと、Workflow が 1 分おきに状態を聞きにいく形にしてある
（partial は 1〜4 分で終わるので、結果をそのまま待つ）。polling は最大 720 回＝12 時間で打ち切る。
仕組みと理由は `docs/L2/Notion 公開基盤の設計.md` の「generate / bootstrap の受け付けと待機」。

#### generate 中に触ってはいけないこと

走っている generate を壊さないためのガードが Container に入っている（中身は L2 の「generate 中のガード」）。
**消すと 1 時間以上の generate が無言で死ぬので注意。**

- **generate 中は、partial publish と comment refresh が 409 で断られる。**
  partial 同士は今まで通りキューに積まれる（コメント承認や記事更新を続けて行う通常運用）
- 14 時間を超えて走り続けているジョブは「ハングした」とみなされ、ガードがすべて外れる
- 公開とコメント反映のジョブは 30 分が上限。固まった Container は、応答しなくなっていても期限を過ぎたら Worker 側から SIGKILL で止まる（仕組みは L2 の「固まった Container を止める仕組み」）

**手動で deploy するときは、generate が走っていないことを先に確認する。**
走っている最中に deploy しても上のガードで generate は死なないが、
**新しい image はその generate に反映されない**（古い image のまま完走する）。
CI には `Check running publish workflow` step を入れてあるので、CI 経由なら自動で落ちる。

```bash
for status in running queued waiting paused; do
  bunx wrangler workflows instances list mirumi-me-publish-dev --status "$status" --env dev
done
```

`step.sleep` 中の instance がどの status で報告されるかは環境依存なので、まとめて見る。

#### CloudFront invalidation は 2 回流れる

generate / bootstrap では、Container のジョブの末尾と、Workflow の `invalidate-cloudfront` step の 2 か所で invalidation が流れる。
意図どおりの動きで、理由は `docs/L2/Notion 公開基盤の設計.md` の「CloudFront invalidation を 2 回流す理由」。

### generate / bootstrap の見かた

- 470 記事で **40 分から 1 時間**かかる。大半は thumbnail を持たない記事の自動生成 Lambda で、
  publish index に載れば次回以降は省略される。**止まって見えても落とさない**
- 進捗は site bucket の `_internal/jobs/<workflowId>.json` に出る。`phase` は
  prepare / load-articles / build-pages / generate / deploy / done
- generate と bootstrap は `retries: 0`。数時間をやり直さないための判断なので、
  失敗したら原因を直して手動で投げ直す
- 記事ごとの失敗（render warning を含む）では全体を止めない。失敗した記事だけを飛ばして最後まで走り、
  Workflow は ✅ Completed、出力の `status` が `completed-with-errors` になる
    - CI が赤くなるのは generate そのものが失敗したときだけで、記事ごとの失敗では赤くならない
    - generate で失敗した記事は、前の版のまま配信が続き、`公開エラー` に「generate で失敗しました: 〜」とだけ書く（`internal-state` や日付には触らない）。次の generate で作り直せたら、generate が自分で消す
    - bootstrap で失敗した記事は、publish index に載らないので一覧、sitemap、feed から外れ、S3 には旧 WordPress 版の HTML が残る。`internal-state` を `下書き` に戻し、`公開エラー` に「bootstrap で失敗しました: 〜」と書く。直して `公開` を押せば、Notion の `公開日` のまま公開される
    - 公開ボタン（partial）で書いた `公開エラー` は、generate では消さない（下の「generate が作り直す記事」）
    - generate が Notion に書くのは、読み込んだときから誰も触っていない記事だけ。途中で編集された記事は、その編集を 🟢 / 🔴 で上書きしないよう書かずに飛ばす（Worker のログに `notion_result_skipped`）
    - 失敗した記事があったら、Workflow の最後に Slack（`SLACK_WEBHOOK_URL`）へ通知する（公開ボタン、generate、bootstrap のどれでも）。記事の題名、slug、理由、Notion の URL を並べる。公開ボタンで、書き戻しの直前に本文が直されていた記事も含む
    - Workflow そのものが例外で止まったときも、`notify-error` の step で Slack に通知する（公開の Workflow と、コメント反映の Workflow）
    - 通知が届かなくても、公開の結果は失敗にしない（Worker のログに `publish_failure_notification_failed` / `workflow_error_notification_failed`）
    - `公開待ち` / `非公開待ち` のまま 2 時間以上たった記事を、毎朝（09:00 JST の Cron。コメントの digest と同じ）Slack に通知する。Webhook の取りこぼしや Notion の障害で止まった公開に気づくため。Notion のボタンを押し直しても値が変わらず Webhook が飛ばないので、`POST /admin/publish` で流し直す
    - 記事を `非公開` にしたとき、その記事を内部ブログカードで指している公開中の記事を Slack に知らせる（公開ボタンの Workflow の `notify-unpublished-references` step）。それらは、次に `公開` を押したときや generate で Notion の本文から作り直すときにカードを解決できず、prd では公開エラーになるため
        - 調べるのは公開中の記事の snapshot（`_internal/published-pages-v1`）の HTML。普通のリンクは対象外
        - snapshot を読めなかった記事は飛ばす（Container のログにだけ `unpublished_reference_check_skipped` が残る）
- Container の標準出力はどこからも読めない。Nuxt generate が落ちた原因は例外へ載せて
  Workflow まで持ち上げている
- job が終わったのに Container instance が `running` のままなら、`sleepAfter` は SIGTERM を
  送るだけで PID 1 は既定ではシグナルを無視することを疑う。`wrangler containers instances <id>`
  で確認できる。気づく手がかりが課金しかないので、generate のあとは一度見ておく
- 固まった Container を期限で止めたときは、Worker のログに `container_destroyed_after_deadline` が出る

本番では workflow 名と env を `mirumi-me-publish-prd` / `prd` に変える。
GitHub Actions では commit SHA と run ID と run attempt を instance ID に含め、Cloudflare deploy token だけを持たせる。
Notion / AWS の secret は GitHub へ置かない。
deploy token は対象 account だけに絞り、`Workers Scripts Edit` と Container 配備用の `Containers Edit` を許可する。
ローカルで使う場合もファイルには保存せず、`CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を必要なプロセスだけへ一時的に渡し、作業後に token を revoke する。

### generate が作り直す記事

generate は、publish index で公開中の記事をすべて、今のアプリで作り直す。本文をどこから取るかは記事によって違う。

- Notion の今の本文：`公開中` で、最後に公開した本文から誰も触っていない記事
- 最後に公開したときの内容（`_internal/published-pages-v1` の snapshot。コメント反映と同じもの）：それ以外の公開中の記事。未公開の編集は出ない。コメントだけは今の承認済みに差し替える
    - `公開待ち` / `非公開待ち` の記事
    - 未公開の編集がある記事（status が 🟡。`last-edited-by` がこの環境の integration でない）。Workflow の出力の `skippedPageIds` に出る
    - 公開ボタン（partial）の失敗で `公開エラー` が残っている記事。書き戻しで最後の書き手は integration になるが、公開できなかった編集が本文に残っているため。これも `skippedPageIds` に出る
    - generate の途中で触られた記事。本文を取った直後に page ごとに確かめ、変わっていたら切り替える。generate 全体は止めない（partial と bootstrap は今までどおり、build 中に触られたら job ごと止める）。これも `skippedPageIds` に出る
    - Notion の本文では失敗した記事（失敗の扱いは上の「generate / bootstrap の見かた」）

一覧、sitemap、feed には publish index の最後の公開値を使う。最後に公開したときの内容から作り直しても、`公開日`、`更新日`、Notion の status は変わらない。

snapshot が無い、読めない、今のアプリがその route を持たない（固定ページの改名など）記事は作り直せないので、前のアプリの HTML のまま残し、Workflow の出力の `stalePageIds` に出す。サイト内遷移の一覧（app manifest）からは消さない。

bootstrap は import した直後の本文をそのまま公開するので、どれも切り替えない。**bootstrap のあいだは記事を触らない**（触ると job ごと止まる）。

内容を変えていない 🟡（`めも` だけ直した、など）は、`公開` を押せば `更新日` を動かさずに 🟢 に戻る。

🚧 現行の `.github/workflows/deploy.yml` からこの方式への切り替えは、production bootstrap と同じ明示 GO のあとに行う。

## ローカル frontend 開発

初回だけ `app/.env.example` を `app/.env` へコピーし、Notion integration token と Cloudflare Access service token を入れる。
`app/.env` は Git 管理しない。通常はそのまま `bun run dev` でよい。

```bash
bun run dev
```

Codex App から起動して Windows 側の一時ディレクトリが継承される場合だけ、
Nuxt の Unix socket 用に `TMPDIR=/tmp bun run dev` とする。

### 表示される内容

- `app/.env` が指す dev の posts / pages data source を、Nuxt の server route（`/api/_build/*`）が Notion API で直接読む。prd の Notion、WordPress、build manifest は読まない
- 出るのは `internal-state` が `公開中` で、タイトルと公開日があるページだけ
    - 🟡 未公開差分ありの記事は Notion の最新の本文がそのまま出る。generate は最後に公開したときの snapshot から作り直すので、ここだけ見え方が違う
- dev data source の中身は WordPress へ追従させていない（`docs/L2/dev Notion データソースの方針.md`）。cache をいくら新しくしても、dev data source より新しくはならない
- 内部 Bookmark は Notion metadata、外部 Bookmark はローカル取得、X post は Access 配下の dev Worker と KV / ローカル cache で解決する
- 本文と thumbnail の Notion 一時 URL はそのまま使うため、画像同期、変換、タイトルカード生成は行わない
    - `thumbnail` が空の記事は、トップページのカード画像が `no-image.jpg` になる（generate では自動生成 OGP の 412 variant が入るところ）
- Amazon は静的 fallback card を出したあと、dev Worker の Creators API endpoint で hydration する。失敗時は fallback を維持する
- コメントは常に 0 件

### cache の鮮度

cache は `app/.cache/notion-dev` に 1 件 1 ファイルで保存する。
期限切れはリクエストのたびに判定し、裏で定期的に取り直すことはしない。期限が切れたあとの最初のリクエストで取り直す。

| 対象 | 取り直す条件 | 取得に失敗したとき |
| --- | --- | --- |
| 一覧 metadata（タイトル、slug、カテゴリ、日付、thumbnail、`internal-state`、`last_edited_time`） | 前回の取得から 5 分経ったとき。posts / pages を毎回全件 query する | 古い cache を期限なしで使う |
| 本文 | 表示した記事だけ。一覧の `last_edited_time` が cache と変わったとき、または前回の取得から 30 分経ったとき | 古い cache を期限なしで使う |
| 外部 Bookmark | 前回の取得から 30 日経ったとき | 古い cache を使う。cache もなければ hostname だけの card を出し、失敗は cache しない |
| X post | 一度 cache したら取り直さない | 本文に「X ポストを解決できませんでした」の枠を出す |

- 本文は `last_edited_time` を見ているので、Notion での編集は実質 5 分（一覧の周期）以内に反映される
    - ただし `last_edited_time` は分単位なので、本文を取得したのと同じ分のうちに編集すると、30 分の期限まで反映されないことがある
- 外部 Bookmark と X post の解決に失敗した状態の本文も、そのまま本文の cache に入る。直るのは本文を取り直したとき
- cache の形式（version）が変わると、古い cache は読まずに取り直す
- 全部取り直したいときは `app/.cache/notion-dev` を消せばよい

### build manifest を読む

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

## 検索

検索画面（`app/src/pages/s.vue`）は Workers の `GET /api/search?q=<語>&page=<ページ>` を 1 回呼ぶ。13 件ずつ、`{ total, pages, posts }` を返す。

- 検索画面は、API が失敗したら読み込み中のまま止めず、結果の欄にメッセージを出す（429 は「ちょっと混み合っています。…」、それ以外は「ちょっとうまくいきませんでした。…」）。続けて検索したときは、最後に始めた検索の結果だけを出す
- 索引は Container が公開のたびに site bucket の `_internal/search-index-v1.json` に書く（`server/src/containers/search-index.ts`）。載るのは公開中の記事だけで、固定ページとコメントは載らない
    - generate / bootstrap：作り直した記事で丸ごと作る。作り直せなかった記事（失敗、snapshot が無いなど）は前の索引の値を引き継ぐ
    - 公開ボタン：今ある索引の、その記事だけを差し替える（非公開にした記事は消える）。索引がまだないか壊れているときは作らない（その記事だけの索引になるため）。generate を流せばできる
    - コメントの反映では触らない
    - 本文は描いたあとの HTML から作る。もくじと内部ブログカードは除き、NFKC と小文字にそろえる
    - 索引を書けなくても公開は失敗にしない（Container のログにだけ `search_index_refresh_failed` が残る）。次の公開か generate で追いつく
- Worker は索引を isolate のメモリに持つ。60 秒ごとに ETag つきの条件つき GET で確かめ、変わっていたら読み直す。公開のあと最大 60 秒ほど古い結果を返しうる
    - S3 を読めないときは、持っている索引で答え続ける。持っていなければ 503
    - 索引がまだない（新しいコードで最初の generate の前）ときは 0 件を返す（Worker のログに `search_index_missing`）
- 照合：空白（全角も）で語に分け、NFKC と小文字にそろえて部分一致。すべての語を含む記事だけを返す
- 並び：語の出現回数の多い順（本文 1 回 = 1 点、タイトル 1 回 = 3 点）、同じなら公開日の新しい順
- CORS は公開 API と同じ（`FRONTEND_ORIGIN`、`WORKERS_API_ORIGIN`、dev では loopback）。rate limit は `RATE_LIMITER_60_PER_MINUTE` で、送信元の IP ごとに 60 回 / 分
- Worker の AWS のキーで `_internal/search-index-v1.json` を読む。publish index（`_internal/publish-index-v1.json`）を読むのと同じ権限

## PV と site-admin-extension

- フロント（`app/src/app.vue`）は、初めの表示とルートが変わるたびに、そのページのパスを Workers の `POST /api/pv` へ `navigator.sendBeacon` で送る（使えなければ `fetch` の keepalive）。応答は待たない
    - パスは末尾スラッシュをそろえる（`shared/src/page-views.ts`）。数えるのはトップと 1 階層のページで、2 階層以上、`/entries/`、`/s/` は送らない（WordPress 時代と同じ）
    - ローカルの nuxt dev では送らない
- Worker は、トップ、`/entry-list/`、publish index で公開中の route（記事と固定ページ）だけを Analytics Engine（`MIRUMI_ME_PV`）に `indexes: [パス]`、`doubles: [1]` で書き、204 を返す。公開中でないパスは書かずに 204
    - 公開中の route は publish index から集め、`CONTENT_CACHE` に 5 分 cache する（key は `published-routes:v1`）。cache にないパスは 1 分に 1 回だけ index を読み直す
    - rate limit は `RATE_LIMITER_60_PER_MINUTE` で、送信元の IP ごとに 60 回 / 分
- site-admin-extension は、開いているページの PV（直近 31 日の合計）と、Notion のページを開く「編集」リンクを左下に出す
    - background の service worker が読む。PV は Analytics Engine の SQL API（`SUM(_sample_interval)`）、編集リンクは Notion の posts / pages を slug で引く
    - 読み先は開いているページのホストで分ける。`mirumi.me` と prd の CloudFront は prd（`mirumi_me_pv_prd`、prd の posts / pages）、dev の CloudFront は dev
    - トップと `/entry-list/` は Notion のページがないので、PV だけを出す
    - token は `.env.local`（`VITE_CLOUDFLARE_ACCOUNT_ID`、`VITE_CLOUDFLARE_API_TOKEN`、`VITE_NOTION_TOKEN`）。build すると `dist/` の JS に埋め込まれる
    - `bun run --cwd tools/site-admin-extension build` で `dist/` を作り、Chrome で読み込み直す
- Analytics Engine は書き込んだ時刻しか持てないので、WordPress の過去の PV は移せない。切り替えから 31 日間は「直近 31 日」が少なめに出る

## 画像

### 新規 Notion upload

- 本文静止画: 800 / 1200 / 1600 px、拡大なし、WebP quality 80
- thumbnail: 412x216 / 600x315 / 1200x630、cover、WebP quality 80
- 記事ヘッダー: mobile 600、desktop 1200
- トップと内部ブログカード: 412。トップのカードは thumbnail がない記事でも自動生成 OGP の 412 variant を使う（記事ヘッダーと内部ブログカードには出さない）
- key: 本文は `{assetHash}-{cleanStem}-{setWidth}x{setHeight}-{actualWidth}w.webp`、thumbnail は `{assetHash}-{cleanStem}-{width}x{height}.webp`
- `{setWidth}x{setHeight}` は本文画像セットの最大 variant の実寸。フロントエンドはこれを `<img>` の `width` / `height` に出す（Notion の image block に寸法がないため URL で運ぶ）
- 画像変換契約は `v2`（2026-09-25 に本文 key へ寸法を追加して `v1` から上げた。`v1` の本文 object は S3 に 1 つも作られていない）
- thumbnail の `cleanStem` は Notion Files property のファイル名を使う。名前を変えると URL も変わるが、旧 object は残す
- `assetHash` は変換契約 version、用途（本文 / thumbnail）、入力 bytes から作る sha256 の先頭 16 文字。同じ画像セットの各 variant で共有し、入力 bytes か変換契約が変われば hash も変わる
- `cleanStem` は元 URL のファイル名から作る。拡張子と末尾の `-{W}x{H}`（WordPress の寸法サフィックス）を落とし、NFKC 正規化と小文字化のうえで文字と数字以外を `-` にまとめ、80 文字までにする。本文画像でこれが空になるときは `image-{ハイフンを除いた block ID の末尾 12 文字}` を使う
- resize、quality、命名規則を変えるときは変換契約 version も上げる。生成済みの variant を単品で rename / delete しない
- S3 の object は immutable として扱う。publish のたびに記事内の画像を走査し、同じ key がすでにあれば PUT を省略する。既存 object の metadata（変換契約、用途、寸法、bytes の hash）が食い違えば失敗させる
- 本文 animation は変換せず byte-for-byte で S3 へコピーし、`srcset` を付けない。key は `{assetHash}-{cleanStem}-{width}x{height}.{元の拡張子}` で、`width` / `height` だけ出す
- animated thumbnail は現在 validation error
- Notion にアップロードした本文の audio / video も、変換せず byte-for-byte で S3 へコピーし、本文の URL を `mirumi.media` に差し替える（Notion の署名付き URL は 1 時間ほどで切れるため）。WordPress から移した audio / video と YouTube などの external URL は触らない
    - key は `{assetHash}-{cleanStem}.{拡張子}`。`assetHash` の用途は `audio` / `video`。S3 の metadata の寸法は持たないので `0`
    - 拡張子は元のファイル名から取る。ファイル名に拡張子がなければ Content-Type から決める
    - Content-Type は取ってきたときの応答のものを使う。`application/octet-stream` で返ったときは拡張子から決める（mp4 / m4v / mov / webm / mp3 / m4a / wav / ogg / aac / flac）
    - 1 ファイル 1 GiB まで。超えるとその記事の公開が失敗する（公開エラー に「1 GiB の上限を超えています」）
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

- `dry-run` は変換したあと公開と同じ render まで通し、prd で公開を止める render warning を `dry-run-report.json` の `renderWarningRecords` に出す。内部ブログカードは投入する記事と固定ページの route で照合し、外部のブログカードと X ポストは解決できたものとして扱う（外部を見ないため）
- `--apply` だけが media S3 へ書く
- `upload` だけが Notion へ書く
- static image の mapping 欠落は import error
- 既存 animation と ICO は旧 URL のまま。名前に寸法がないので `width` / `height` は付かない（20 件）
- 旧 object は削除しない
- final import 後の Notion 画像 URL に `-1999x...` などの WordPress 寸法サフィックスを残さない

**既存記事の画像まわりの最終形（本文画像の `width` / `height` と、`convert.ts` が import 時に付けるトークン）は dev には出ていない。本番 import で初めて効く。**
本番 import のあと、bootstrap の前に prd の preview で確認する（`本番リリース手順.md` の「4. 切り替え」）。
dev で見えない理由と、本番まで持ち越した経緯は `docs/L2/Notion 公開基盤の設計.md` の「既存記事の画像が dev で最終形にならない理由」。

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

## アプリ紹介カード

今後の新規記事は、App Store の URL だけを書く（2026-10-04 から）。

```text
[app ios="https://apps.apple.com/jp/app/<名前>/id<数字>"]
```

- 公開のときに、iTunes Search API の lookup で名前（trackName）、開発元（artistName）、価格（formattedPrice）、アイコン（artworkUrl512）を引く
    - Container が Worker の橋渡し（`bindings.internal/app-store`）で引き、Worker が `CONTENT_CACHE` に cache する（key は `app-store:v1:<国>:<ID>`）。7 日は引き直さず、1 年残す。引けないときは古い値を使う
    - 国は URL の `/jp/` などから決める。無ければ jp
    - アイコンは取ってきて、本文画像と同じく mirumi.media に置き直す（`app-icon-<ID>`）。CDN 直リンクは将来切れるため
- 書いた属性（`name`、`icon`、`developer`、`price`）は引いた値より優先する。`android="…"` もそのまま書ける
- 引けず、古い値も無いときは render warning（prd では公開が止まる）。プレビューは引かないので、`ios` だけのカードは 🚨 の箱になる
- 移行した 103 件は `[app name="…" icon="…" developer="…" price="…" ios="…" android="…"]` のように焼き込んであるので引かない（`icon` は mirumi.media のファイル名）

## コールアウト（ボックス）

コールアウトのアイコンで、ボックスの種類が決まる。

| アイコン | ボックス |
| --- | --- |
| 💡 | info ボックス（`/callout` で作ったときの既定のアイコン） |
| ♻️ | 追記ボックス。段落の先頭の「追記 (日付) ：」を強調する |
| 🚨 | 警告ボックス |
| Notion のアイコンの square-alternate（lightgray） | 枠ボックス（`shared/src/content.ts` の `WAKU_CALLOUT_ICON`） |
| 上の 3 つ以外の絵文字 | 枠ボックス。本文の先頭にその絵文字を出す |
| それ以外（ほかの Notion のアイコン、色違い、アイコンなし、カスタム絵文字や画像） | render warning。中身は枠ボックスで出す |

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
- Slack: `SLACK_WEBHOOK_URL`（公開の失敗などの通知先。dev / prd で同じ URL）
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
- rollback は Notion の内容を戻して再公開するか、generate を回す。site bucket に S3 versioning は入れていない

## 本番リリース

production bootstrap の前に揃えるものと、WordPress を廃止するまでに残っている作業は、`本番リリース手順.md` に手順としてまとめてある。
