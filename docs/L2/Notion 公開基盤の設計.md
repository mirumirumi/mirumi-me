---
owner: ai
sources:
  - docs/L1/Notion 移行 やること.md
  - docs/reference/Notion 公開基盤運用手順.md
---

# Notion 公開基盤の設計

Notion → Workers → Workflows → Containers の公開基盤について、設計の中身とその理由を書く。
手順や契約として確定しているものは `docs/reference/Notion 公開基盤運用手順.md` を正とする。

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

運用手順の「複数記事の公開が重なったとき」と「full / bootstrap は受け付けと待機を分けている」から移した。

- publish はすべて `BUILD_CONTAINER.getByName("publisher")` という単一の Durable Object に集まり、`SerialJobQueue` で直列化される。publish index を 1 本の書き手で守るための設計で、これ自体は正しい
- **publish index の書き手を 1 本に保つ責務は Container 側へ移っている。** `server/src/containers/http.ts` の `SerialJobQueue` が、partial の同期実行・full の background 実行・comment refresh をすべて同じ queue に通す。DO 側の queue は step retry の相乗り用に残してある
- 同時実行を安全にするために入れた対策が 2 つある
    - `destroyOutdatedInstance()`：Container の作り直しは `CF_VERSION_METADATA.id` が前回と変わったときだけ。以前はジョブごとに `destroy()` していて、連続実行時の cold start churn が詰まりの主因と見ている。version が取れない環境では、従来どおり毎回作り直すフォールバックが残っている
    - `SerialJobQueue` の `workflowId` dedupe：step が timeout して retry が来たとき、実行中の同じジョブに相乗りする。以前は retry がキューを積み増して詰まりを悪化させていた
- 2026-09-24 に dev で 3 記事を同時に `公開待ち` にしたときは、2 本が 45 分で Errored、1 本が 1 時間走り続けた。上記 2 つを入れてから同じ手順（2 記事同時）を再実行したところ、1 本目 1 分 55 秒・2 本目 3 分 35 秒で両方 Completed した。2 つ同時に入れたので、どちらが効いたかは切り分けていない

## full / bootstrap の受け付けと待機

運用手順の「full / bootstrap は受け付けと待機を分けている」から移した。

- partial は `publish-site` step の中で Container の結果をそのまま待つ。1〜4 分で終わるのでこれでよい
- full / bootstrap は 1 時間を超えるため、同じ形にすると「結果を待っているだけの invocation」が Workers の hang 判定で打ち切られる（2026-09-24 に 20 分で踏んだ）。そこで step を分けてある

```
start-publish-site        Container に受け付けさせるだけ。数秒で返る
wait-publish-site-N       step.sleep で 1 分眠る
poll-publish-site-N       Container に状態を聞く。done なら summary を受け取って抜ける
```

- polling は最大 720 回＝12 時間で打ち切る。publish index が空の初回ビルドは全記事の thumbnail 生成が走るため極端に遅く、dev では 1 回の試行が 4.7 時間走ってまだ終わっていなかった。本番 bootstrap も同じ条件なので、余裕を取ってある（`step.sleep` は step 上限に数えられない）
- Container 側は `POST /publish` が 202 を返して background で走り、`GET /publish-state` が `running` / `done` / `failed` / `unknown` を返す。`unknown` は Container が作り直されて受け付けた記録を失った状態なので、待たずに失敗させる

### full build 中のガード

full build のあいだ、Container は「HTTP を開いたまま待っていない」状態で走り続ける。そのため、走っているジョブを壊さないための仕掛けを 3 つと、それを外す逃げ道を 1 つ入れてある。消すと 1 時間以上のビルドが無言で死ぬ。

- **`BuildContainer.onActivityExpired()` の override**（`containers/container.ts`）。ライブラリは inflight request が無いと 15 分（`sleepAfter`）で SIGTERM を送るが、background の build は inflight を持たない。Container 本人に `GET /jobs` で聞いて、走っていれば見送る。ライブラリがこのあと必ず `renewActivityTimeout()` を呼ぶので猶予が伸びる
- **`destroyOutdatedInstance()` の busy ガード**。`destroy()` は SIGKILL なので、走っているジョブがあるときは version を記録せずに見送り、空いている次のジョブで作り直す
- **partial publish と comment refresh は full build 中だと 409 で断る**（`containers/request-handler.ts`）。待たせると Workflow 側が hang 判定で殺され、Notion へ失敗も書けないままジョブだけ 1 時間後に実行されて、「サイトには出ているのに Notion は 公開待ち」になるため。**partial 同士は今まで通りキューに積む**（コメント承認や記事更新を続けて行う通常運用）
- **14 時間を超えて走り続けているジョブは「ハングした」とみなす**（`background-publish.ts`）。ジョブの promise が永久に settle しないと、409 で publish が止まり Container も止められないため、その時点で上の 3 つのガードをすべて解除して自力で回復させる。Workflow の polling 予算（12 時間）より長く取ってあるので、待っている人がいるビルドは切らない

### CloudFront invalidation を 2 回流す理由

- full / bootstrap では、Container がジョブ末尾に自分で invalidation を流す。Workflow が hang 判定などで先に諦めても CDN が更新されるようにするため
- `invalidate-cloudfront` step はそのまま残してある（冪等な念押し）。step を分けてある理由は、CloudFront のレート制限（`TooManyInvalidationsInProgress`、wildcard 同時 15 件上限）が build とは別の障害ドメインで、ビルドをやり直さずに指数バックオフで 5 回まで retry したいから
- Container 側の失敗はログに残すだけで、build 結果を捨てない
- CallerReference の seed を `container:` 付きにして、2 つを別の invalidation として扱わせている

## partial publish と Nuxt の app manifest

運用手順の同名の節から移した。

- Nuxt の client は `_nuxt/builds/meta/<buildId>.json` の `prerendered` に載っている route だけを prerender 済みとみなし、サイト内遷移で `_payload.json` を読む。載っていない route へ遷移すると API を直叩きして、静的サイトにはないため本文が空のまま描画される（直接開くと正常なので気づきにくい）
- partial の generate はその回の route しか載せないため、Container が deploy 前に配信中の manifest と和集合を取っている（`app-manifest.ts`）
- `routeRules` の `prerender: true` で回避しようとしてはいけない。Nuxt の `prerender.server` plugin が静的ページを全部生成対象に足すため、partial の generate が manifest にないページで落ちる

## deploy 直後の Container rollout

運用手順の「deploy 直後に build を投げない」から、経緯の部分を移した。

- 2026-09-24 に dev で踏んだ。deploy の約 1 分後に full build を投げて 2 分で Errored、rollout の完了は trigger の 2 分半後だった
- `deploy.yml` にも同じ問題があったため、deploy と trigger の間に `Wait for container rollout`（固定 5 分 + `state` の確認）を挟んだ

## 既存記事の画像が dev で最終形にならない理由

運用手順の「既存 WordPress 画像の最終移行」から移した（2026-09-26 時点の状態）。

- dev の Notion は旧変換で取り込み済みで、本文画像も旧 URL（`<名前>-1999x1124.png` など）のまま入っている。そのため次の 2 つは dev では見えない
    - 本文画像の `width` / `height`。名前に寸法を持つ canonical URL にならないと付かない（`normalize-media --apply` と import が要る）
    - `convert.ts` が import 時に付けるトークン。WordPress のエディタで変えた表示幅 `[image width="316px"]`（約 1,400 箇所）、本文幅より狭い画像の `align="none"`、`[quoteImage]` の `width`（漫画 17 箇所）、`align="center"` を付けないこと
- render 側のコードはすべて dev に入っており、Notion に新しく upload した画像では `width` / `height` と新しい key まで end-to-end で確認済み
- dev で最終形を見るには `normalize-media --apply`（prd と共用の media バケットへ約 12,000 object を書く）と dev の取り込み直しが要るため、圭くんの判断で本番リリースまで持ち越した。本番の手順（`normalize-media --apply` → import → `fix-toc-anchors --apply` → bootstrap）は変わらない
