---
owner: ai
sources:
  - docs/L1/Notion 移行 やること.md
  - docs/reference/Notion 公開基盤運用手順.md
---

# Notion 公開基盤の設計

Notion → Workers → Workflows → Containers の公開基盤について、設計の中身とその理由を書く。
手順や契約として確定しているものは `docs/reference/Notion 公開基盤運用手順.md` を正とする。

## 用語

定義は `docs/reference/用語集.md`。ここには名前を決めた理由を残す（2026-09-29 に圭くんと決めた）。

- サイト全体の作り直しは、以前は「full build」と呼んでいた。次の 2 つの理由で「generate」に改めた
    - 「full build」は deploy まで含めて全部やるように聞こえるが、実際はサイトの生成と配信だけで、コードの配備はしない
    - deploy も Container image を build するので、「build」がどちらの話なのか紛らわしい
- 「generate」は Nuxt のコマンド名と同じで、WordPress 時代の CI でも同じ呼び方をしていた。CI の流れを「deploy して、必要なら generate する」と言える
- 弱点は、公開とコメント反映も中で `nuxt generate` を動かすこと。そちらを指すときは「Nuxt generate」と書いて区別する
- 公開と generate の線引きは「Notion の公開状態を変えるかどうか」。partial（公開）と full（generate）で名前がそろっていないのは、この違いを表している
- Workflow の入力の `mode: "full" | "partial" | "bootstrap"` は変えなかった。全体・一部・初回という範囲を表す値として読めるうえ、CI・スクリプト・Worker と Container の入力検証にまたがる約束なので、変える手間のわりに得が少ない。コードで mode の値そのものを指すところは `full` のまま書く

## slug の所有

- 公開のたびに slug が変わっていないかを確かめるため、S3 の `_internal/publish-index-v1.json` に最後に公開できた pageId、slug、route の所有者を持ち、現在値と照合する
- 非公開にしたあとも記録は残し、同じ slug が別の記事で誤って再利用されるのを防ぐ

## 公開処理の Workflow

- Webhook は Workflow インスタンスを作ったらすぐに成功を返す
- Notion の webhook event ID を Workflow の instance ID に使い、重複起動を防ぐ
- 取得、バリデーション、ビルド、デプロイ、Notion への書き戻しを永続ステップに分け、途中で失敗したときの再試行と再開を Workflow に任せる
- 外部への副作用は再試行されても安全なつくりにし、古い内容による上書きは公開前の競合チェックで防ぐ

## サムネイルの自動生成

- サムネイル生成 Lambda は画像を返すところまでとし、webp への変換と S3 への配置は Container が行う

## 目次のアンカー

- 見出しの id は Notion の block ID から作る。block ID を base64url にした末尾 7 文字に `h-` を付ける
- 先頭側を使わないのは、Notion の ID が UUID v7 で先頭のバイトが作成時刻になっており、近い時期に作った見出しどうしで衝突するため

## Notion の status と公開結果の書き戻し

- `last-notion-edit` は公開処理中の競合検出にだけ使い、`last-deploy` との大小比較には使わない
- 公開開始時のページの revision を保持し、build のあと 2 回確かめる。違えば成功扱いにしない（詳しくは下の「公開ボタンの同じ分のうちの編集」）
    - Container の最後（S3 に置く前）：変わっていたら job ごと止めて 🔴
    - Notion へ書き戻す直前（S3 に置いて CloudFront を更新したあと）：変わっていたら 🟢 にせず 🔴（配信は直す前の本文）
    - 2026-10-03 までは、ここに「最終書き込みの直前に取り直す」と書いてあったが、コードは Container の 1 回しか確かめていなかった（圭くんと相談して、コードを記述に合わせた）
- 成功時は `internal-state = 公開中`、`last-deploy` の更新、`公開エラー` のクリアを最後の 1 回の書き込みにまとめる。失敗時は短い理由と trace ID だけを残す
    - 失敗時は、`last-deploy` がなければ `internal-state = 下書き`、あれば `internal-state = 公開中` に戻す
- 公開処理から記事に書き戻す経路は `workers-api` だけにする（取り直してから書き込むまでの短い競合の窓は許容する）

## publish の直列化と同時実行

運用手順の「複数記事の公開が重なったとき」と「generate / bootstrap は受け付けと待機を分けている」から移した。

- publish はすべて `BUILD_CONTAINER.getByName("publisher")` という単一の Durable Object に集まり、`SerialJobQueue` で直列化される。publish index を 1 本の書き手で守るための設計で、これ自体は正しい
- **publish index の書き手を 1 本に保つ責務は Container 側へ移っている。** `server/src/containers/http.ts` の `SerialJobQueue` が、partial の同期実行・full の background 実行・comment refresh をすべて同じ queue に通す。DO 側の queue は step retry の相乗り用に残してある
- 同時実行を安全にするために入れた対策が 2 つある
    - `destroyOutdatedInstance()`：Container の作り直しは `CF_VERSION_METADATA.id` が前回と変わったときだけ。以前はジョブごとに `destroy()` していて、連続実行時の cold start churn が詰まりの主因と見ている。version が取れない環境では、従来どおり毎回作り直すフォールバックが残っている
    - `SerialJobQueue` の `workflowId` dedupe：step が timeout して retry が来たとき、実行中の同じジョブに相乗りする。以前は retry がキューを積み増して詰まりを悪化させていた
- 2026-09-24 に dev で 3 記事を同時に `公開待ち` にしたときは、2 本が 45 分で Errored、1 本が 1 時間走り続けた。上記 2 つを入れてから同じ手順（2 記事同時）を再実行したところ、1 本目 1 分 55 秒・2 本目 3 分 35 秒で両方 Completed した。2 つ同時に入れたので、どちらが効いたかは切り分けていない

## generate / bootstrap の受け付けと待機

運用手順の「generate / bootstrap は受け付けと待機を分けている」から移した。

- partial は `publish-site` step の中で Container の結果をそのまま待つ。1〜4 分で終わるのでこれでよい
- generate / bootstrap は 1 時間を超えるため、同じ形にすると「結果を待っているだけの invocation」が Workers の hang 判定で打ち切られる（2026-09-24 に 20 分で踏んだ）。そこで step を分けてある

```
start-publish-site        Container に受け付けさせるだけ。数秒で返る
wait-publish-site-N       step.sleep で 1 分眠る
poll-publish-site-N       Container に状態を聞く。done なら summary を受け取って抜ける
```

- polling は最大 720 回＝12 時間で打ち切る。publish index が空の初回ビルドは全記事の thumbnail 生成が走るため極端に遅く、dev では 1 回の試行が 4.7 時間走ってまだ終わっていなかった。本番 bootstrap も同じ条件なので、余裕を取ってある（`step.sleep` は step 上限に数えられない）
- Container 側は `POST /publish` が 202 を返して background で走り、`GET /publish-state` が `running` / `done` / `failed` / `unknown` を返す。`unknown` は Container が作り直されて受け付けた記録を失った状態なので、待たずに失敗させる

### generate 中のガード

generate のあいだ、Container は「HTTP を開いたまま待っていない」状態で走り続ける。そのため、走っているジョブを壊さないための仕掛けを 3 つと、それを外す逃げ道を 1 つ入れてある。消すと 1 時間以上の generate が無言で死ぬ。

- **`BuildContainer.onActivityExpired()` の override**（`containers/container.ts`）。ライブラリは inflight request が無いと 15 分（`sleepAfter`）で SIGTERM を送るが、background の build は inflight を持たない。Container 本人に `GET /jobs` で聞いて、走っていれば見送る。ライブラリがこのあと必ず `renewActivityTimeout()` を呼ぶので猶予が伸びる
- **`destroyOutdatedInstance()` の busy ガード**。`destroy()` は SIGKILL なので、走っているジョブがあるときは version を記録せずに見送り、空いている次のジョブで作り直す
- **partial publish と comment refresh は generate 中だと 409 で断る**（`containers/request-handler.ts`）。待たせると Workflow 側が hang 判定で殺され、Notion へ失敗も書けないままジョブだけ 1 時間後に実行されて、「サイトには出ているのに Notion は 公開待ち」になるため。**partial 同士は今まで通りキューに積む**（コメント承認や記事更新を続けて行う通常運用）
- **14 時間を超えて走り続けているジョブは「ハングした」とみなす**（`background-publish.ts`、値は `job-limits.ts`）。ジョブの promise が永久に settle しないと、409 で publish が止まり Container も止められないため、その時点で上の 3 つのガードをすべて解除して自力で回復させる。Workflow の polling 予算（12 時間）より長く取ってあるので、待っている人がいるビルドは切らない

### 固まった Container を止める仕組み

2026-09-29 に足した。Cloudflare 側には Container の最大実行時間の制限がなく、固まった Container が寝ずに動き続けると、`standard-3` は memory と disk だけで月 $55 ほどかかる。気づく手がかりは、1 日遅れで届く budget alert のメールしかない。

- 上の 14 時間の判定だけでは、次の 3 つの穴が残っていた
    - 14 時間の判定は generate / bootstrap にしか効かず、公開とコメント反映のジョブには上限がなかった
    - 公開のジョブが固まると、DO から Container へのリクエストが開きっぱなしになる。ライブラリ（`@cloudflare/containers`）は inflight があるあいだ `isActivityExpired()` が false を返すので、`onActivityExpired` そのものが呼ばれない
    - Container のプロセスが応答しなくなると `/jobs` に答えられず、以前の `isContainerBusy()` は busy とみなして止めるのを見送り続けた。14 時間の判定もそのプロセスの中にあるので動かない
- 上限は `containers/job-limits.ts` に 1 か所でまとめ、Container と DO の両方で使う
    - generate / bootstrap は既存の 14 時間のまま。余分は足していない（既に「もう誰も待っていない」線として余裕を取った値のため）
    - 公開とコメント反映は 30 分。普段は 1.5〜4 分で、Workflow の `publishSite` / `refreshComments` の step も 1 回の試行を 30 分で打ち切るため
- Container 側：`SyncJobs`（`containers/sync-jobs.ts`）が公開とコメント反映の走り始めた時刻を持ち、30 分を超えたら `/jobs` で busy と答えない。キューで待っている時間は数えない
- DO 側
    - Container へのリクエストはすべて `fetchContainer()` を通し、時間で打ち切る。公開とコメント反映は 30 分、generate の受け付けは 5 分、そのほかは 2 分（Workflow の step が諦めるのと同じ長さ）。打ち切ると inflight が戻り、寝る判定が動くようになる
    - ジョブを渡すときに開始時刻を DO の storage に残す（`backgroundJobStartedAt` / `syncJobStartedAt`）。答えが返ったら消し、打ち切ったときは残す。generate は `readPublishJobState()` が終わりを見届けたときに消す
    - `onActivityExpired` は `decideExpiredAction()` で決める。Container が空いていれば SIGTERM（`stop`）、期限内なら残す、期限を過ぎたら Container が busy と答えても応答しなくても `destroy()`（SIGKILL）。応答しないプロセスは SIGTERM を受けられないため
    - 開始時刻の記録がないのに Container が空いていないときは、この仕組みを入れる前の version が渡したジョブかもしれないので止めず、その時点から 14 時間の時計を始める（`adopt`）
    - 止めたときは `container_destroyed_after_deadline`、時計を始めたときは `container_job_adopted` を Worker のログに出す
- 公開が固まった場合、Workflow の retry が同じジョブに相乗りしてリクエストを開き直すので、実際に止まるのは retry を使い切って 15 分たったあと（おおむね 2 時間以内）

### Container から AWS への操作に時間の上限をつける

2026-10-10 に足した（`containers/aws.ts` の `runAwsOperation`）。

- 起きたこと：dev で keybord-recommend を非公開にしたら、Container の job が index と検索の索引を保存したあと、非公開にした記事を指す記事を探す処理（16 本ずつ並べて snapshot を読む）で止まった。Workflow の `publishSite` は 30 分ごとに打ち切ってやり直すが、やり直しは同じジョブに相乗りするので（上の「固まった Container を止める仕組み」）、後ろに並んだ dygma-defy の公開も始まらないまま待たされた
- 原因：Bun 1.3 の `node:https` が、並列のリクエストでときどき応答の body を流さなくなり、AWS SDK v3 の promise が永久に settle しない（oven-sh/bun#26066。重複として閉じられた #27557 が同じ症状。2026-10-10 時点で open）
    - 手元で、dev の snapshot 469 本を 16 本ずつ読む（SDK だけ、1 回 1,407 本）のを試した。Bun 1.3.3 は 3 回中 1 回、1 本が 155 秒以上返らなかった。同じことを 5-C のコードで試しても 3 回中 1 回止まった。Node 24 は 9 回とも 5 秒ほどで終わった
    - Bun 1.4.3 は 8 回とも止まらなかった。直っているかもしれないが、issue に修正の記録はない。2026-10-10 に、圭くんの判断で上げないことにした（1.3.3 のまま。`.tool-versions` と Container の Dockerfile の両方）。止まり方は下の時間の上限で守る
    - 手元の `normalize-media --apply` も同じ `S3MediaObjectStore` を使うので、手元の Bun 1.3.3 でもこの上限が効く
- AWS SDK には既定のタイムアウトがない。`requestTimeout` も、応答の header が届いた時点で外れるので（`@smithy/node-http-handler` の `handle` が response で clearTimeouts する）、body が流れてこない今回の止まり方は守れない
- そこで、body を読み終えるまでの 1 回の操作を、こちらで時間で打ち切る
    - 終わりは `Promise.race` で決め、打ち切るときに `abortSignal` も送る。abort が届かずに止まったままの試行もありうるので、abort が効くことには頼らない
    - 打ち切りは 60 秒。PUT は 1 MiB あたり 1 秒を足す（検索の索引は 7 MB ほど、audio / video は 1 GiB まで）
    - べき等な操作（GET / HEAD / DELETE / 条件なしの PUT / 同じ CallerReference の CloudFront invalidation）は 3 回まで試す。時間切れ以外のエラーは SDK が自分でやり直したあとなので、やり直さない
    - publish index の条件つき PUT（`IfMatch` / `IfNoneMatch`）はやり直さない。時間切れでも S3 には書けていることがあり、同じ条件でやり直すと 412 になって原因が見えなくなる。job ごと失敗させれば、Workflow のやり直しが index を読み直す
- Worker（`services/published-slugs.ts` などの `SignedS3DeploymentIndexStore`）は Workers の fetch で S3 を読むので、この問題の外
- Container の標準出力は、Workers Observability の `containers` dataset（`$metadata.service` は Container application の ID）で読めた（2026-10-10。nuxt generate の出力を確かめた）。Container 自身の `console.warn` が載るかはまだ確かめていない

### CloudFront invalidation を 2 回流す理由

- generate / bootstrap では、Container がジョブ末尾に自分で invalidation を流す。Workflow が hang 判定などで先に諦めても CDN が更新されるようにするため
- `invalidate-cloudfront` step はそのまま残してある（冪等な念押し）。step を分けてある理由は、CloudFront のレート制限（`TooManyInvalidationsInProgress`、wildcard 同時 15 件上限）が build とは別の障害ドメインで、ビルドをやり直さずに指数バックオフで 5 回まで retry したいから
- Container 側の失敗はログに残すだけで、build 結果を捨てない
- CallerReference の seed を `container:` 付きにして、2 つを別の invalidation として扱わせている

## partial publish と Nuxt の app manifest

運用手順の同名の節から移した。

- Nuxt の client は `_nuxt/builds/meta/<buildId>.json` の `prerendered` に載っている route だけを prerender 済みとみなし、サイト内遷移で `_payload.json` を読む。載っていない route へ遷移すると API を直叩きして、静的サイトにはないため本文が空のまま描画される（直接開くと正常なので気づきにくい）
- partial の Nuxt generate はその回の route しか載せないため、Container が deploy 前に配信中の manifest と和集合を取っている（`app-manifest.ts`）
- `routeRules` の `prerender: true` で回避しようとしてはいけない。Nuxt の `prerender.server` plugin が静的ページを全部生成対象に足すため、partial の Nuxt generate が manifest にないページで落ちる

## deploy 直後の Container rollout

運用手順の「deploy 直後に generate を投げない」から、経緯の部分を移した。

- 2026-09-24 に dev で踏んだ。deploy の約 1 分後に generate を投げて 2 分で Errored、rollout の完了は trigger の 2 分半後だった
- `deploy.yml` にも同じ問題があったため、deploy と trigger の間に `Wait for container rollout`（固定 5 分 + `state` の確認）を挟んだ
- 2026-10-10 の docs だけの deploy（`22e9826`）では、Container application の `state` が 13:45 から 14:06（UTC）まで 21 分 `provisioning` のままで、CI の待ち（最初の 5 分 + 30 秒ごとに 20 回で、およそ 15 分）を超えて deploy job が赤になった。Worker の deploy は済んでいて、待っていれば `ready` になったので、やり直しはしていない
    - 中身に関係なく、Cloudflare 側の rollout が長引くことがある。CI が rollout の待ちで赤になったら、`bunx wrangler containers list --env <env>` で `ready` / `active` になるのを待てばよく、deploy をやり直す必要はない。そのあとに generate が要る run だったなら、`gh workflow run deploy.yml --ref <branch> -f generate=always` で流し直す
    - 待ちを延ばすかは決めていない（延ばすと、本当に固まったときに気づくのが遅れる）

## deploy と generate の CI

2026-09-29 に圭くんと決めた。動きと判定の中身は、運用手順の「application release と generate」。

- デプロイできる単位は実質 1 つ。`wrangler deploy` は Worker と Container image（app・server・shared が入っている）をまとめて出し、image だけを出す手段がない
    - そのため、対象ごとのリリースブランチ（`deploy/dev/app` など）は採らなかった。別々のコミットを指すと、あとから push したほうがもう片方の中身まで上書きする
    - 「deploy は毎回、generate だけ差分で判定」にした
- `--containers-rollout=none`（Worker だけの deploy）は使っていない。Container は `lib/` や `shared` も import しているので、どの変更が Container に効くかはディレクトリでは決まらず、誤ると Worker と Container のコードがずれる。節約できるのは rollout の数分だけ
- ワークフローはファイルを分けず、`deploy.yml` 1 本の中で job を分けた
    - ファイルを分けると、1 回の push で両方が動いたときに 2 本が同時に `wrangler deploy` する
    - `concurrency` で並べても、GitHub は同じグループの待ち run を 1 本しか残さず、新しい run が来ると待っていたほうをキャンセルする。generate するはずだった run が消えうる
    - `paths` フィルタは直前の push との差分しか見ないので、失敗やキャンセルで流れなかった変更を取りこぼす
    - ファイル名を `deploy.yml` のままにしたのは、`workflow_dispatch` が default branch に同じ名前のファイルがあるときしか使えないため
- generate の要否の基準点は、Cloudflare 側の「最後に完了した CI の generate」にした
    - GitHub の run 履歴は基準にならない。以前の CI は trigger するだけで完了を待たなかったので、run の成功が generate の完了を意味しなかった
    - instance ID に SHA を入れているので、そこから取れる。wrangler の instance 一覧は表形式しか出せないので、API を直接読む
    - 差分は `git diff <基準> <HEAD>` で木どうしを比べる。作業ブランチから dispatch した generate の基準は、そのブランチを squash で `dev` に入れると `dev` の祖先にならないので、祖先関係に頼らない
        - 以前は dev を force push していたのも理由だった。2026-10-10 に、`dev` は `main` へのリリースの元なので force push しないことにした（直接 push はよい）
    - 基準が取れないときは、どれも generate する側に倒す
- 判定は「効かないとわかっているもの」の許可リスト方式にした。新しいディレクトリが増えても generate する側に倒れる
    - サーバーのコードは、generate の経路の入口（`containers/http.ts`、`containers/container.ts`、`workflows/workflow.ts`）から import をたどって決める。静的なリストだと、あとで Container が Worker 側のファイルを import し始めたときに、generate を飛ばす側（危ない側）に間違える
    - 型だけの import はたどらない（実行時に消える）。`shared` は app も使うので丸ごと効くものとして扱い、たどらない
    - vitest は Node で動くので、import の読み取りには Bun の Transpiler ではなく TypeScript の parser を使っている
    - 弱点は 3 つ。どれも気づかないと generate を飛ばす側（危ない側）に間違えるので、触るときは注意する
        - たどるのは相対 import だけ。`tsconfig.json` の `paths` に `shared/*` 以外の alias を足して server で使うと、その先をたどれない
        - 入口は `release.ts` の `GENERATE_ENTRYPOINTS` に固定で書いてある。generate の経路に新しい入口（別の Workflow など）を足したら、ここにも足す
        - `import()` に文字列以外を渡したり、`.ts` を import ではなく別プロセスで実行したりすると、たどれない
    - TypeScript を 7（Go 製）に上げると、`typescript` パッケージの JS API が使えなくなるかもしれない。そのときは `plan` job が import の時点で落ちるので、静かに間違えることはない
    - `git diff` は `-z` で読む。付けないと日本語のパスが引用符付きでエスケープされ、`docs/` などの前方一致に掛からない
- CI は generate の完了まで待つ。generate は Notion に何も書き戻さないので、待たないと失敗に誰も気づけない。repo が public なので Actions の時間は課金されない。待っているあいだの push は、失敗せずに順番待ちになる
    - 待つときは instance の詳細の API（`GET …/workflows/<name>/instances/<id>`）を 1 分ごとに読む。2026-10-03 に、完了した generate の instance でこの API だけが失敗し続け、CI が 5 回続けて状態を取れずに赤くなった（Workflow 自体は ✅ Completed）。そこで、詳細の API が失敗したときは一覧の API を `status`（complete / errored / terminated）で絞って探し、見つかればその状態で判断する（`scripts/cloudflare-api.ts` の `findTerminalStatus`）
    - 詳細の API の失敗のしかた：HTTP は 200 で、本文は `success: false`、`errors` が `workflows.api.error.internal_server`（10001）。`result` には `status: complete` と Workflow の出力がそろっているが、`steps` は 63 個中、最初の `load-request` の 1 個しかなかった。その出力は Cloudflare 側で切り詰められていて、ほかの instance では 1,024 文字ちょうどで切られて `[truncated output]` が付くのに、これだけは 924 文字で、印なしに revision の `publishError` の日本語の途中で終わっていた
    - 推測：Cloudflare が step の出力を切り詰める処理が、切る位置と日本語（マルチバイトの文字）の並びによっては失敗し、steps の組み立てごと止まる。revision に `publishError` を足したことで、切る位置が日本語の上に移った。走っているあいだの読み取りが通っていた理由は説明できていない。Cloudflare 側の不具合と見ており、cf-ray は `a449ce26eaced429-KIX`
    - 同じことは、記事の題名などの日本語でも、切る位置しだいでいつでも起こりうる。一覧での確認はそのための保険
- generate しない run でも rollout の収束は待つ。CI が緑になった時点で公開を試せるようにするため
- 作業ブランチへの push では動かさない。圭くんは作業ブランチを不完全な状態で push するため。dev に出すのは `dev` への push と `workflow_dispatch` だけ
- 手元から generate / bootstrap を起動するには Cloudflare の API token が要る。wrangler の OAuth のログインは、Workflow の instance の一覧や詳細は読めるが、作成は認証エラー（10000）になる
    - 2026-09-07 の時点では「OAuth のまま deploy、workflows の list / describe が通るので専用の token は要らない」と見ていた（`.contexts/実装の進捗状況.md`）が、起動は試していなかった。2026-10-03 に起動で 10000 を踏み、2026-10-10 に存在しない Workflow 名で確かめた（一覧は not_found（10200）、起動は 10000。名前を確かめる前に権限で断られている）。`wrangler whoami` の OAuth の scope にも Workflows は出てこない
    - bootstrap はエージェントに流してもらう前提だが、token はファイルに置かない決まりのまま（運用手順の「generate / bootstrap の見かた」）。起動のコマンドは一瞬で終わるので、そこだけ圭くんが自分のターミナルで流し、dry-run と監視はエージェントが OAuth のまま行う形にした
- 手元から流す generate と bootstrap は SHA を持たないので基準点にならない。また prd の Workflow は 2026-09-10 以降に作るため、完了した instance の記録は既定で 7 日しか残らない（それより前に作った Workflow は 30 日）。どちらも generate が余分に走るだけで、安全側

## 既存記事の画像が dev で最終形にならない理由

運用手順の「既存 WordPress 画像の最終移行」から移した（2026-09-26 時点の状態）。

- dev の Notion は旧変換で取り込み済みで、本文画像も旧 URL（`<名前>-1999x1124.png` など）のまま入っている。そのため次の 2 つは dev では見えない
    - 本文画像の `width` / `height`。名前に寸法を持つ canonical URL にならないと付かない（`normalize-media --apply` と import が要る）
    - `convert.ts` が import 時に付けるトークン。WordPress のエディタで変えた表示幅 `[image width="316px"]`（約 1,400 箇所）、本文幅より狭い画像の `align="none"`、`[quoteImage]` の `width`（漫画 17 箇所）、`align="center"` を付けないこと
- render 側のコードはすべて dev に入っており、Notion に新しく upload した画像では `width` / `height` と新しい key まで end-to-end で確認済み
- dev で最終形を見るには `normalize-media --apply`（prd と共用の media バケットへ約 12,000 object を書く）と dev の取り込み直しが要るため、圭くんの判断で本番リリースまで持ち越した。本番の手順（`normalize-media --apply` → import → `fix-toc-anchors --apply` → bootstrap）は変わらない
- 2026-10-10 の dev の入れ直し（本番リリース手順の 1）で、この 2 つも dev に入った。`normalize-media --apply` は 12,159 object を書いて失敗 0、取り込み直した本文に WordPress の寸法サフィックスは残っていない（image ブロックと thumbnail の 4,958 個を走査。mirumi.media の正規化した形でないのは、変換しないアニメーション GIF と ICO、外部の画像 1 個だけ）。以降は dev で最終形を見られる

## 記事ごとの失敗の扱い

2026-10-01 に圭くんと決め、2026-10-02 の見直しで穴を塞いで実装した。動きは運用手順の「generate / bootstrap の見かた」と「generate が作り直す記事」。

- 前提として、prd では render warning（ブログカードや X ポストを解決できないなど）も、その記事の失敗に格上げしている
- generate / bootstrap は、1 記事が失敗しても全体を止めない。1 記事のブログカードのために、コードの release や数時間かかる bootstrap をまるごとやり直すのは割に合わないため
- そのかわり、失敗した記事はどの mode でも Notion の `公開エラー` に出す。以前は partial しか書いておらず、generate / bootstrap の失敗は Workflow の出力に `completed-with-errors` が残るだけだった。CI も Workflow の `complete` しか見ないので、誰も気づけなかった
    - 成功した記事に書かないのは、全件 writeback を避ける従来の方針のまま。例外は下の「generate が書いた 公開エラー を消す」だけ
- CI を赤くするのは generate そのものが失敗したときだけにする。記事ごとの失敗で赤くすると、generate は最後まで終わっているのに CI だけ失敗に見えてわかりにくい、という圭くんの意見。気づくための手段は、CI ではなく Slack への通知にする（2026-10-03 に実装。`services/notifications.ts` が文面を組み立て、`services/slack.ts` が送る）
    - 失敗した記事は Workflow の最後の `notify-failures` step でまとめて送る。Workflow が例外で止まったときは、入口（`workflows/workflow.ts`、`workflows/comment-refresh-workflow.ts`）で受けて `notify-error` step で送ってから投げ直す（`workflows/notify.ts`）
    - 通知の失敗では公開の結果を失敗にしない。Slack の不調で、配信まで済んだ公開が Errored に見えるのを避けるため
    - 止まった 🔵 / 🟠 の確認は、09:00 JST の Cron でコメントの digest と並べて流す（`scheduled.ts`）。片方が落ちてももう片方は流す
    - 2026-10-04 に、30 分ごとの確認も足した（圭くんと決めた）。きっかけは、公開が失敗した直後に押し直すと Webhook が飲み込まれて止まるとわかったこと（下の「公開の失敗の直後の押し直しが飲み込まれる」）。毎朝だけだと、翌朝まで気づけない
        - 間隔は 30 分。10 分も考えたが、費用（Notion への問い合わせが 1 回 2 件、Worker の起動）はどちらでもほぼない。気になったのは通知の重複と誤報で、重複は「止まってから 30〜60 分の記事」だけを見ることで防ぎ（Cron の予定時刻 `scheduledTime` から範囲を決めるので、起動が遅れても前後と重ならない）、誤報は判定の 30 分で防ぐ（大きい動画の公開や Container の起動待ちで数分かかっても、30 分は超えない）。圭くんも 30 分でよいとのこと
        - 知らせるだけで、自動では動かし直さない。公開が本当に長引いているときに二重に走らせないため
        - 範囲の確認が 1 回失敗すると、その 30 分に止まった記事は 30 分ごとの確認では出ない。翌朝のまとめ（2 時間以上）で拾う

### 公開の失敗の直後の押し直しが飲み込まれる

2026-10-04 に dev の実験中に見つけた。前に `codex-dev-e2e-20260830` が `非公開待ち` のまま止まったのも同じ形だったとみられる。

- Notion の `page.properties_updated` は、短い時間の変更を 1 つにまとめて送る（Notion の Webhooks のドキュメントに aggregated event とある）
- 公開が失敗すると、Workflow が bot で `internal-state` を `公開待ち` → `公開中` に戻し、`公開エラー` を書く。その 1 分ほどのうちに人が `公開` を押す（`公開中` → `公開待ち`）と、1 つの Webhook にまとめられ、`updated_properties` には `公開エラー` だけが入って `internal-state` が入らなかった（authors には人が含まれていた）。行って戻った値は「変わっていない」ことになるとみられる
- Worker は `internal-state` が変わった Webhook だけを公開の合図にしているので、無視される（`notion_webhook_ignored`）
- Webhook 側で「人の操作が含まれていたら、今の `internal-state` を読み直して待ち状態なら公開を始める」案も考えた。公開の処理中（`公開待ち` のあいだ）にほかの項目を直すと、同じ記事の公開が二重に始まりうるので採らなかった。かわりに 30 分ごとの確認で気づけるようにした
    - Slack は、WordPress 時代の 1 記事だけ generate する CI（`generate-only-specified-post.yaml`）で通知に使っていたもの。メール（コメントの digest と同じ SES）も候補だったが、圭くんが Slack を選んだ

### 公開エラー はどこで書いたかを文面に残す

- generate が書く 公開エラー は「generate で失敗しました: 」、bootstrap は「bootstrap で失敗しました: 」で始める（`lib/publishing.ts` の `*_PUBLISH_ERROR_PREFIX`）。公開ボタン（partial）は今までの文面のまま
- generate は、自分が書いた 公開エラー だけを、その記事を作り直せたときに消す。外部サービスの一時的な障害やコードの不具合で多くの記事が失敗しても、次の generate が通れば 🔴 が自然に消えるようにするため。1 本ずつ `公開` を押させない
- 公開ボタンが書いた 公開エラー は消さないし、その記事は generate で Notion の本文から作り直さない（最後に公開した版から作り直す）。partial の失敗の書き戻しは `internal-state = 公開中` と 公開エラー を書くので、最後の書き手は integration になるが、本文には公開できなかった編集が残っている。これを generate が Notion の本文から作り直すと、失敗した編集が黙って公開され、`非公開` が失敗した記事は 🟢 に戻されて非公開にしたかったことが消える（2026-10-02 の見直しで見つけた穴）
- 文面で見分けるのは、別の property を足すと dev / prd の schema と複製の手順が増えるため。圭くんが 公開エラー を手で書き換えることは想定していない
- generate の失敗では `internal-state` や日付に触らない。generate は公開状態を変えないので
- bootstrap の失敗は partial の失敗と同じ規則で、publish index に無く `last-deploy` も無いので `下書き` に戻る。generate は `公開中` しか扱わないので触らない。直して `公開` を押せば、Notion の 公開日 のまま公開される

### generate が Notion に書くのは、誰も触っていない記事だけ

- generate は 1 時間近く走るので、そのあいだに圭くんが記事を編集したり、公開ボタンを押して 409 で失敗したりしうる。そこへ generate が 公開エラー を書く・消すと、最後の書き手が integration になり、人の編集（🟡）や公開ボタンの失敗（🔴）が上書きされて見えなくなる
- そこで、書く直前に page を取り直し、Workflow が読み込んだときの revision と比べて変わっていない page にだけ書く（`workflows/workflow.ts` の `writeNotionResultsIfUnchanged`）。取り直してから書くまでの短い競合の窓は、partial の書き戻しと同じく許容する
- 比べるのは `last_edited_time`、`last_edited_by`、`internal-state`、`公開エラー`（`lib/publishing.ts` の `isPageRevisionUnchanged`）。`last_edited_time` は分単位なので、同じ分のうちの人の編集は `last_edited_by` で、同じ分のうちの integration の書き込み（409 の失敗の書き戻し）は `公開エラー` で見分ける

### 非公開にした記事を指す記事の通知

2026-10-02 に圭くんが案 C を選び、2026-10-04 に実装した（`containers/unpublished-references.ts`）。

- 背景：prd では、解決できない内部ブログカードは render warning で、その記事の失敗になる。非公開にした記事を指すカードを持つ記事は、次に Notion の本文から作り直すとき（`公開` や generate）に 🔴 になる。WordPress は何も出さないだけだった。案 A（そのまま）、B（消えた記事を指すカードは warning にしない）、C（A のまま、非公開にした時点で Slack に知らせる）から C
- 公開ボタンの job で非公開にした page があれば、Container が index を保存したあとに、公開中の全記事の snapshot の `contentHtml` から内部ブログカード（`shared/src/render.ts` の `findInternalBlogcardRoutes`）を拾って、非公開にした route を指す記事を集める。同じ job で作った page はメモリの BuildPage を使う。結果は `PublishJobSummary.unpublishedReferences` で Worker に返し、Worker が Slack に送る
    - generate / bootstrap は非公開をしないので調べない
    - 公開中の記事が数百あるので、snapshot は 8 本ずつ並べて読む。非公開は頻度が低いので、そのたびに読む費用は気にしない
        - はじめは 16 本ずつだった。2026-10-10 に dev で最初の非公開を試したとき、この読み込みの途中で Container が止まった（下の「Container から AWS への操作に時間の上限をつける」）ので、8 本に下げた
    - 探すのに 3 分を超えたら打ち切り、知らせずに非公開を終える（`UNPUBLISHED_REFERENCE_SEARCH_TIMEOUT_MS`。ログは `unpublished_reference_search_failed`）。S3 の読み込みが 1 回止まって、やり直しても収まる長さ
- publish index の各 page に「指している route」を持たせる案は採らなかった
    - index の schema は `strictObject` なので、新しい項目を足すと、deploy の rollout 中に古い Worker / Container が新しい index を読めなくなる。足すなら「読む側を先に緩める → 書く」の 2 回の release が要る
    - index の上限は 800 KB で、2026-10-03 の dev はすでに 632 KB ある
    - 足す前に公開した記事の分は、作り直すまで空のままになる
- カードの見つけ方は描いたあとの HTML の形（`<a class="blogcard" href="https://mirumi.me/...">`）に依存する。形を決める `renderBookmark` のすぐ下に置き、render.test.ts で「描いたカードを拾える」ことを確かめているので、片方だけ変えるとテストが落ちる
- snapshot を読めなかった記事は飛ばし、Container の `console.warn` にだけ残す。書いた時点では Container の標準出力は読めないと思っていたので、実際には気づけないとみていた（2026-10-10 に Workers Observability で nuxt generate の出力は読めたが、`console.warn` が載るかは未確認）。prd では bootstrap で全記事の snapshot ができ、comment-refresh も同じ snapshot に頼っているので、欠けていれば別の形で表に出る。ここで件数を Slack に出すのは見送った（`PublishJobSummary` の項目がもう 1 つ増えるわりに得が小さい）
- 知らせられなくても、非公開の結果は失敗にしない（失敗の通知と同じ）

### internal-state が空の row は generate / bootstrap で失敗にしない

2026-10-03 に圭くんと決めた（`lib/publishing.ts` の `validatePageRevisionMetadata`）。

- 経緯：圭くんが dev の posts に文字列を貼り付けて、中身が空の row ができた。posts / pages の既定のテンプレート `template` は `internal-state = 下書き` を入れるが、貼り付けでできた row はテンプレートを通らないので `internal-state` が空になる。これを generate が「internal-state が公開待ち状態ではありません」で失敗にして、🔴 と Slack 通知になった
- 以前は、partial 以外でも `internal-state` が空なら失敗にしていた。`下書き` なら何もしないのに、空だと失敗になるのは釣り合わない。文面も generate の場面では意味が通らなかった
- いまは、generate / bootstrap では空の row を `下書き` と同じく何もしない。ただし `last-deploy` がある（公開したことがある）のに空なのは壊れているので、「internal-state が空です」で失敗にする。partial は今までどおり、待ち状態以外はすべて「公開待ち状態ではありません」
- 公開したかを publish index でなく `last-deploy` で見るのは、この検証が Worker の preflight でも通り、そこには publish index がないため。preflight で noop になった page は Container へ渡らないので、Container 側の `preparePageRevision` で拾うこともできない
- 悪くなるのは、publish index に載っているのに `internal-state` と `last-deploy` の両方が手で消された page だけ。黙って noop になるが、generate は snapshot から作り直すので配信は崩れない

## generate で 🟡 の記事を Notion から作り直さない

2026-10-01 に見つけて、圭くんと L1 どおりに直すと決め、2026-10-02 に実装した。同じ日のうちに、飛ばすのではなく最後に公開した版から作り直す形（下の「最後に公開した版から作り直す」）に変え、L1 も直した。

- L1 の generate の節（変更前）は「編集したがまだ公開していない記事はフェッチから除外し、配信中のものを残す（次に公開するまで旧アプリケーションの状態で配信されるのは許容）」
- 実装は `公開待ち` / `非公開待ち` だけを除外し、`公開中` の記事は 🟡 も含めて Notion の今の本文で作り直していた（`lib/publishing.ts` の `resolvePublishAction`、`containers/publish-job.ts` の `loadPublishArticle`）。`main` への push で CI の generate が走ると、書きかけの編集が `更新日` も動かないまま公開されていた
- 判定は Workflow の `load-request` で行う（`lib/publishing.ts` の `selectGenerateRevisions`）。外した記事は Container に渡さない
    - 🟡：`last_edited_by` が、この環境の token の bot（`users.me`）でない。status の formula は integration の名前（`workers-api` を含むか）で見ているが、コードは名前の変更に影響されない ID で比べる。dev / prd の integration はそれぞれの環境のデータソースにしか接続していないので、ほかの bot が書くことはない
    - 公開ボタンの失敗で 公開エラー が残っている記事も外す（上の「公開エラー はどこで書いたかを文面に残す」）
- bootstrap では外さない。import した直後の本文をそのまま公開するのが bootstrap の役目のため。2026-10-02 に dev を数えたところ、import も復元も dev の integration で行っていたので、全 472 件の `last_edited_by` が `workers-api (dev)` だった（テストの名残で公開ボタンの 公開エラー が残っている 3 件は外される）

### 最後に公開した版から作り直す

- 最初は L1 どおり、外した記事を前のアプリの HTML のまま残していた。次の 3 つが理由で、圭くんと相談して作り直す形に変えた
    - 見た目の更新や機能の追加が、その記事には `公開` を押すまで届かない。🟡 は `めも` を書いただけでもつくので、気づかないうちに増えていく
    - 新しいアプリのページからサイト内遷移すると、Nuxt は HTML を読まずにその記事の `_payload.json` だけを取り、新しいアプリの部品で描画する。ページのデータの形を変えたリリースのあとは、古い payload で表示が壊れうる。直接開くと壊れないので気づきにくい
    - コメント反映の失敗の逃げ道だった「次の generate で収束する」が、🟡 の記事に効かなくなる
- generate では、publish index で公開中なのに Notion の今の本文から作り直さなかった記事を、すべて最後に公開した版（`_internal/published-pages-v1` の snapshot）から作り直す（`containers/publish-job.ts` の `selectSnapshotRebuildPages`）。🟡 や公開ボタンの失敗で外した記事のほか、`公開待ち` / `非公開待ち`、generate の途中で触られた記事、Notion の本文で失敗した記事も含む。サイト全体を「今のアプリ + publish index のとおりの内容」にそろえるのが generate の役目、と整理した
- やり方はコメント反映と同じで、本文は snapshot の `contentHtml` をそのまま使い、コメントだけを今の承認済みに差し替える（`containers/comment-refresh-job.ts` の `replaceSnapshotComments`）。publish index では `contentHash` と `deployedAt` だけを進め、`deployedNotionEdit` と `sourceHash` は動かさない。Notion には何も書かない
- 本文の HTML は snapshot を作ったときの `render.ts` のものなので、本文の描画の修正はこれらの記事には届かない（`公開` を押せば届く）。CSS やアプリの部品の変更は届く
- データの形を変えるときに古い形も読めるようにする場所は、snapshot を読む `parseBuildPage` の 1 か所になる。ブラウザの部品で古い payload を気にしなくてよい
- 作り直せない記事は前のアプリの HTML のまま残し、Container の結果の `stale`（Workflow の出力の `stalePageIds`）に出す
    - snapshot が無い、読めない（形が古いなど）
    - 今のアプリがその route を持たない。`resolvePublicRoute(kind, slug)` が publish index の route と一致しない記事で、固定ページの改名（2026-09-30 の `nice-to-meet-you-10` → `featured-posts`）が実例。作ろうとすると Nuxt generate ごと落ちうるので外す
- 作り直せない記事のことは Notion に書かない。外した記事（🟡 など）に generate が 公開エラー を書くと、最後の書き手が integration になり、次の generate がその記事を「きれい」とみなして未公開の編集を公開してしまうため。**generate が Notion に書くのは、読み込んだ時点できれいだった記事だけ**、を崩さない

### generate の途中で触られた記事

- Workflow が revision を読むのは `load-request` で、Container が本文を取るのは、そのあと順に 1 本ずつ。あいだに人が編集すると、「読み込んだ時点ではきれい」だった記事の本文に、公開していない編集が混ざりうる
- 以前はこれを、deploy の直前に全ページを取り直す `confirmFreshness` で防いでいた。ただし 1 ページでも変わっていたら job ごと失敗させるので、1 時間近い generate が、そのあいだの執筆や公開ボタンひとつで丸ごとやり直しになっていた（retries は 0）
- そこで generate では、本文を取った直後に page ごとに取り直して比べ、変わっていたらその記事は Notion の本文を使わず、最後に公開した版から作り直す（`containers/publish-job.ts` の `PageChangedDuringGenerateError`、Container の結果の `skipped`）。取り終えたあとの編集は本文に入らないので、確かめるのは取った直後の 1 回で足りる。最後の `confirmFreshness` は generate では行わない
- partial と bootstrap は今までどおり、最後の `confirmFreshness` で job ごと止める。partial は公開しようとしている本文そのものが変わるため。bootstrap は切り替えの当日で記事を触らない前提のため
- この確認のぶん、Notion への request は 1 ページにつき増えるが、最後の `confirmFreshness` をやめたぶんで相殺される

### generate と app manifest

- Nuxt generate はその回に作った route しか app manifest に載せない。以前の generate は manifest の和集合を取っていなかったので、generate で失敗した記事や `公開待ち` で外した記事へサイト内遷移すると、本文が空になっていた（2026-10-02 に見つけた。それまでは失敗も外れる記事もほぼ無かったので表に出なかった）
- 今は外した記事も最後に公開した版から作り直すので、manifest に載らないのは作り直せなかった記事（`stale`）だけになった。それでも消さないよう、generate も partial と同じく配信中の manifest と和集合を取る。bootstrap の配信中の manifest は WordPress 時代の Nuxt が作ったものなので取らない

### Worker と Container の約束を変えたことによる rollout 中の失敗

- revision に `lastEditedBy` と `publishError` を足したので、deploy の直後の rollout が終わるまでは、古い image の Container が新しい Worker からの request を strict な schema で弾きうる。そのあいだに公開ボタンを押すと 🔴 になる（押し直せば通る）
- 逆向き（新しい DO が古い Container の結果を読む）は、`skipped` と `stale` を省略可能にして吸収してある（`containers/container.ts`）

## 公開ボタンの同じ分のうちの編集

2026-10-02 に見つけて、圭くんの OK で直した。

- partial の `confirmFreshness` は、Container が本文を取ったあとに page を取り直し、`last_edited_time` と `internal-state` が読み込んだときと同じかを見ていた。`last_edited_time` は分単位なので、公開ボタンを押した同じ分のうちに本文を直すと、時刻も編集者（圭くん）も同じままになる
- 本文を取ったあとの直しなら公開されず、書き戻しで 🟢 になって隠れていた。「公開を押してすぐ誤字に気づいて直す」で起きる
- partial では、最後に本文も取り直し、取ったときと同じかを比べる（`lib/article-hash.ts` の `createFetchedArticleHash`）。変わっていたら今までどおり「build 中に Notion page が変更されました」で job を止め、🔴 になる。押し直せば通る
- さらに、Notion へ 🟢 を書き戻す直前にも同じ比較をする（2026-10-03 に追加）。Container の確認のあと、S3 への配置と CloudFront の更新のあいだ（数秒〜十数秒）に直されると、配信は直す前の本文なのに 🟢 になって直しが隠れていたため
    - Workflow の `confirm-published-pages` step で、revision と本文の hash（Container が結果の `fetchedHash` で返す）を取り直して比べる（`workflows/workflow.ts` の `findPagesChangedAfterBuild`）
    - 直されていたら、配信の状態（`internal-state = 公開中`、`last-deploy`、`公開日`）は書きつつ、公開エラー に「公開の途中で本文が直されたので、直す前の本文で公開しました。もう一度「公開」を押してください」と書いて 🔴 にする。公開ボタンの 公開エラー なので、generate は Notion の本文から作り直さない
    - 書き込みとは別の step にしてある。同じ step だと、書き込んだあとに step が retry されたとき、自分の書き込みを編集とみなして 🟢 を 🔴 で上書きしてしまう
    - 確かめ終わってから書き込むまでの、step のあいだの一瞬の窓は残る（許容）
    - 2026-10-03 の UAT で、圭くんが公開ボタンを押した直後に直した `agentic-coding` は 🟢 になり、直した内容（段落の追加）が dev サイトに出ていた。ほかの記事の公開が Container で走っていて、本文を取り始めたのが直しのあとだったため（正しい 🟢）
    - 同じ日に、分の頭で押して 20〜30 秒後に同じ分のうちに直す手順を `my-home` で試したが、これも直した内容ごと公開されて 🟢 になった。Notion の Webhook が届いたのは、変更（`event.timestamp` 20:15:03 JST）の約 1 分後（Workflow の作成 20:16:06）で、本文を取ったのはそのあと。Webhook がこのくらい遅れるなら、「押した同じ分のうちに、本文を取ったあとで直す」はまず起きない。この 2 つの確認は、その万一のための保険で、🔴 になる経路はユニットテストで見ている
    - 1 記事なので取り直しは数秒。bootstrap は全記事の取り直しになるうえ、記事を触らない前提なので行わない
    - `sourceHash` ではなく別の hash にしたのは、`sourceHash` が 公開日 と 更新日 を含まないため。ボタンを押した直後に 公開日 を直した場合も止めたい
    - Notion ホストのファイル URL は取得のたびに署名が変わるので、比べるときは path だけを使う（`sourceHash` と同じ）
- revision の比較には `last_edited_by` と 公開エラー も足した（上の「generate が Notion に書くのは、誰も触っていない記事だけ」と同じ `isPageRevisionUnchanged`）

## Notion にアップロードした audio / video

2026-10-01 に圭くんと決めた。

- Notion にファイルを直接上げた audio / video ブロックは、Notion がホストするファイルになり、API からは 1 時間ほどで切れる署名付き URL しか取れない。今の同期（`containers/media-sync.ts`）は image しか見ていないので、その URL が HTML に焼き込まれる
- 公開のときに、新しい本文 animation と同じく変換せずに S3 へコピーすることにした
- 採らなかった案は「Notion ホストの audio / video を validation error にして、mirumi.media に手で上げて external で貼る」。Notion のタブ 1 枚で書けるようにするという、移行の主目的に反するため
- 2026-10-04 に実装した（`containers/media-sync.ts` の `syncBlocks`、`containers/images.ts` の `copyBodyFile`）。夜のあいだの作業で決めたこと（軽い仮決め。変えるのは定数だけで安い）
    - 1 ファイル 1 GiB まで（2026-10-04 の夜に 500 MiB で入れ、同じ日に圭くんの希望で 1 GiB に上げた。「もっと大きいのを上げる可能性はゼロじゃない」）。超えたらその記事の失敗として 公開エラー に出るので、黙って壊れることはない
        - 上限が要るのは今の作りの都合で、Notion や S3 の上限ではない。key に中身の hash を入れる（content-addressed）ため、いったんメモリに全部読んでから置いている。読みながら連結するあいだはファイルの約 2 倍を使うので、Container（standard-3、メモリ 8 GiB 程度）で Nuxt generate の分を残せる大きさにしている
        - 本当の上限は、Notion の 1 ファイル 5 GB（有料プラン。無料は 5 MB）と、S3 の 1 回の PUT の 5 GB
        - 5 GB まで上げたくなったら（2026-10-04 に圭くんと話した B 案）：メモリに載せず、Notion から読みながら S3 へ流す（stream）作りに変える。key は中身の hash ではなく Notion のファイルの path（`/<ワークスペースの ID>/<ファイルの ID>/<ファイル名>`。署名のクエリは毎回変わるが path は同じアップロードなら変わらない。`lib/article-hash.ts` もこれに頼っている）から作る。読む前に key が決まるので、一度置いたあとは存在の確認だけで済み、公開のたびに動画を丸ごと取り直すこともなくなる（今の作りは公開のたびに取り直して hash を取っている）
        - B 案で確かめること：Bun 上の `@aws-sdk/client-s3` で、Content-Length のわかっている stream を PutObject に渡せるか（`@aws-sdk/lib-storage` は入っていない。足すなら依存の追加）。media bucket の IAM には DeleteObject がないので、一時的な key に置いてから copy する作りは取れない
    - 取りに行くタイムアウトは 5 分（画像は 15 秒）
    - Content-Type は Notion の応答のものを使い、octet-stream のときだけ拡張子から決める。`<video>` / `<audio>` はブラウザによって Content-Type を見て再生するかを決めるため
    - S3 の metadata の usage は `audio` / `video` にした。画像の `body` と分けたのは、寸法を `0` にしている理由が metadata から読めるようにするため
    - stream のまま S3 へ流す（multipart upload）作りにはしなかった。key に bytes の hash を入れる content-addressed の決まりと両立させるには、一度別の key に置いてから copy する手間が要るため。上限を大きく上げたくなったら考える

## 検索

2026-10-01 に圭くんと計画を決め（並びは b、索引はオンメモリで間隔つきの確認）、2026-10-04 に実装した。動きは運用手順の「検索」。

- 索引は Container が書き、Worker が読む。公開 JSON をブラウザに配る案（本文込みで MB 単位をスマホで落とす）、D1 の FTS5（同期の仕組みが 1 つ増えるわりに 470 記事では得が小さい）、Worker が snapshot を毎回集める案（S3 の GET が 470 回）は採らなかった
- 本文は描いたあとの HTML から作る。generate で snapshot から作り直す記事は HTML しか持たないので、全記事を同じ作り方にそろえた。もくじ（見出しの重複）と内部ブログカード（ほかの記事の題名）は除く。X ポストやコードは残す（WordPress の検索も本文の文字列をそのまま見ていた）。除き方は描いた HTML の形に依存するので、`shared/src/render.ts` の描画のすぐ下に置き、テストで描いた本文から作って確かめている
- 公開ボタンでは、索引がなければ作らない。作ると、その job の記事だけの索引になり、generate までのあいだ検索がほぼ空になる。新しいコードの deploy では CI の generate が走るので、そこで全記事の索引ができる
- 並びの b は「語の出現回数の多い順、同じなら新しい順」。タイトルの重みは 3 にした（2026-10-04 の仮決め）。圭くんは「WordPress はタイトルばっかり優先しすぎ」と感じていたので、本文で詳しく書いた記事が上に来るようにしつつ、タイトルに含む記事を少しだけ持ち上げる。重みは `shared/src/search.ts` の `TITLE_WEIGHT` だけで変えられ、索引の作り直しは要らない
- Worker の確認の間隔は 60 秒のまま（圭くんの依頼で実装のときに精査した）
    - isolate がどれだけ生き残るかは決まっておらず、アクセスが続けば長く残る。間隔は「公開のあと古い結果を返しうる時間」の上限で、短いほど古さは減る
    - 確かめるのは ETag つきの条件つき GET で、変わっていなければ 304 の小さい応答 1 回。S3 の GET の費用は 1,000 回で 0.0004 ドル程度で、毎分 1 回でも月 4 万回強
    - それでも 60 秒より短くしないのは、公開した直後にすぐ検索することがまれで得るものが少ないため。長くしないのは、長生きした isolate で古い結果が長引くため
- rate limit の key は送信元の IP ごと（2026-10-04 の仮決め）。計画では「既存の `RATE_LIMITER_60_PER_MINUTE`」とだけ決めていた。Amazon の商品情報 API は全体で 1 つの key だが、検索を全体で 1 つにすると bot 1 つで全員が検索できなくなる
- 索引を書けなくても公開は失敗にしない。配信はもう済んでいて、失敗にすると公開ボタンの押し直しを求めることになるため。Container のログは読めないので、気づくのは検索の結果が古いことからになる

## PV と site-admin-extension

2026-10-01 に圭くんと計画を決め（L1 のアクセスカウンターの節どおり、拡張の編集リンクは読み取り専用の Notion integration で引く案 A）、2026-10-04 に実装した。動きは運用手順の「PV と site-admin-extension」。

- 公開中の route かどうかは、コメントの受付で記事の slug を確かめるのと同じ仕組み（publish index → KV に 5 分 cache、知らない値は 1 分に 1 回だけ読み直し）で確かめる。`services/published-slugs.ts` を、集める値（記事の slug か、公開中の route か）と KV の key だけを差し替えられる形に広げた。そのとき KV の中身の項目名を `values` にそろえ、記事の slug の key を `published-post-slugs:v2` に上げた（古い v1 は 5 分で消える）
- PV の rate limit は送信元の IP ごと（検索と同じ理由。2026-10-04 の仮決め）
- 公開中でないパスや数えないパスでも、書かずに 204 を返す。フロントは応答を読まないので、断っても伝わる先がない。形の崩れたパスだけ 400 にした（自前のフロント以外が送ってきたものの見分けに使える）
- 送り方は、はじめ `navigator.sendBeacon`（だめなら keepalive つきの `fetch`）にしていた。dev で圭くんのブラウザ（Vivaldi。標準でトラッカーをブロックする）から PV が 1 件も届かず、調べると `sendBeacon` だけが `net::ERR_BLOCKED_BY_CLIENT` で止められていた。同じ URL・同じ本文でも keepalive つきの `fetch` は 204 で届いた（2026-10-05）。`sendBeacon` は止められても `true` を返すので、だめなら `fetch` に切り替える作りでは救えない。そこで最初から keepalive つきの `fetch` だけにした
    - EasyPrivacy を見ても `/api/pv` に当たるルールはなく、ping という種類で止めているとみられる。ブロッカーによっては URL やドメイン（`workers.dev`）で止めるものもあるので、ブロッカーを入れた人の PV は多少取りこぼす。WordPress 版のカウンターも普通の fetch で送っていたので、それより減ることはないはず
- 拡張は開いているページのホストで dev / prd を分ける（2026-10-04 の仮決め）。dev の CloudFront で新しい版を試せるようにするため。prd の data source ID は、本番リリースの準備で複製して作り直すときに `src/admin-data.ts` を直す（本番リリース手順の 6）
- 拡張は shared に依存していない（依存を足すと lockfile も変わる）ので、パスのそろえ方（`shared/src/page-views.ts`）と Notion の API version は写している。どちらもコメントで元を書いた
- 拡張にテストを足し（`src/admin-data.test.ts`）、root の `bun run test` からも流れるようにした
- トップと `/entry-list/` には編集リンクを出さない。WordPress 版はトップに固定ページの編集リンクを出していたが、Notion にはトップに当たるページがない
