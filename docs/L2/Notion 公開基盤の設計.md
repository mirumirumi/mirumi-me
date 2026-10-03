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
- 公開開始時のページの `last_edited_time` を保持し、デプロイ成功後の最終書き込みの直前に取り直した値と違えば成功扱いにしない
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
    - 差分は `git diff <基準> <HEAD>` で木どうしを比べる。dev は force push するので、祖先関係に頼らない
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
- generate しない run でも rollout の収束は待つ。CI が緑になった時点で公開を試せるようにするため
- 作業ブランチへの push では動かさない。圭くんは作業ブランチを不完全な状態で push するため。dev に出すのは `dev` への push と `workflow_dispatch` だけ
- 手元から流す generate と bootstrap は SHA を持たないので基準点にならない。また prd の Workflow は 2026-09-10 以降に作るため、完了した instance の記録は既定で 7 日しか残らない（それより前に作った Workflow は 30 日）。どちらも generate が余分に走るだけで、安全側

## 既存記事の画像が dev で最終形にならない理由

運用手順の「既存 WordPress 画像の最終移行」から移した（2026-09-26 時点の状態）。

- dev の Notion は旧変換で取り込み済みで、本文画像も旧 URL（`<名前>-1999x1124.png` など）のまま入っている。そのため次の 2 つは dev では見えない
    - 本文画像の `width` / `height`。名前に寸法を持つ canonical URL にならないと付かない（`normalize-media --apply` と import が要る）
    - `convert.ts` が import 時に付けるトークン。WordPress のエディタで変えた表示幅 `[image width="316px"]`（約 1,400 箇所）、本文幅より狭い画像の `align="none"`、`[quoteImage]` の `width`（漫画 17 箇所）、`align="center"` を付けないこと
- render 側のコードはすべて dev に入っており、Notion に新しく upload した画像では `width` / `height` と新しい key まで end-to-end で確認済み
- dev で最終形を見るには `normalize-media --apply`（prd と共用の media バケットへ約 12,000 object を書く）と dev の取り込み直しが要るため、圭くんの判断で本番リリースまで持ち越した。本番の手順（`normalize-media --apply` → import → `fix-toc-anchors --apply` → bootstrap）は変わらない

## 記事ごとの失敗の扱い

2026-10-01 に圭くんと決め、2026-10-02 の見直しで穴を塞いで実装した。動きは運用手順の「generate / bootstrap の見かた」と「generate が作り直す記事」。

- 前提として、prd では render warning（ブログカードや X ポストを解決できないなど）も、その記事の失敗に格上げしている
- generate / bootstrap は、1 記事が失敗しても全体を止めない。1 記事のブログカードのために、コードの release や数時間かかる bootstrap をまるごとやり直すのは割に合わないため
- そのかわり、失敗した記事はどの mode でも Notion の `公開エラー` に出す。以前は partial しか書いておらず、generate / bootstrap の失敗は Workflow の出力に `completed-with-errors` が残るだけだった。CI も Workflow の `complete` しか見ないので、誰も気づけなかった
    - 成功した記事に書かないのは、全件 writeback を避ける従来の方針のまま。例外は下の「generate が書いた 公開エラー を消す」だけ
- CI を赤くするのは generate そのものが失敗したときだけにする。記事ごとの失敗で赤くすると、generate は最後まで終わっているのに CI だけ失敗に見えてわかりにくい、という圭くんの意見。気づくための手段は、CI ではなく Slack への通知にする（未実装）
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
- partial では、最後に本文も取り直し、取ったときと同じかを比べる（`containers/publish-job.ts` の `createFetchedArticleHash`）。変わっていたら今までどおり「build 中に Notion page が変更されました」で job を止め、🔴 になる。押し直せば通る
    - 1 記事なので取り直しは数秒。bootstrap は全記事の取り直しになるうえ、記事を触らない前提なので行わない
    - `sourceHash` ではなく別の hash にしたのは、`sourceHash` が 公開日 と 更新日 を含まないため。ボタンを押した直後に 公開日 を直した場合も止めたい
    - Notion ホストのファイル URL は取得のたびに署名が変わるので、比べるときは path だけを使う（`sourceHash` と同じ）
- revision の比較には `last_edited_by` と 公開エラー も足した（上の「generate が Notion に書くのは、誰も触っていない記事だけ」と同じ `isPageRevisionUnchanged`）

## Notion にアップロードした audio / video

2026-10-01 に圭くんと決めた。

- Notion にファイルを直接上げた audio / video ブロックは、Notion がホストするファイルになり、API からは 1 時間ほどで切れる署名付き URL しか取れない。今の同期（`containers/media-sync.ts`）は image しか見ていないので、その URL が HTML に焼き込まれる
- 公開のときに、新しい本文 animation と同じく変換せずに S3 へコピーすることにした
- 採らなかった案は「Notion ホストの audio / video を validation error にして、mirumi.media に手で上げて external で貼る」。Notion のタブ 1 枚で書けるようにするという、移行の主目的に反するため
