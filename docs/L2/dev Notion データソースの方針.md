---
owner: ai
---

# dev Notion データソースの方針

2026-09-06 決定。dev 用に別ワークスペースは作らず、`mirumi.me` ワークスペース内に
dev 用データソースを置く。各データソースの ID と dev / prd の分け方は
`docs/reference/dev 環境と prd 環境の対照表.md` を参照。

## 判断理由

- MCP も `ntn` も**同時に 1 ワークスペースしか見られない**。別ワークスペースにすると、
  prd の内容確認と dev の開発のたびに接続を張り替えることになり、AI と一緒に運用・保守する前提だと割に合わない
- prd を壊すリスクは、**integration を分けて接続先データソースを絞る**ことで確実に防げる
    - Notion の integration 権限はデータソース単位。接続していないデータソースは API から存在ごと見えない
    - 壊れたリレーション（接続外のデータソースを指す）は参照も更新も削除もできないことを実測済み
- dev のデータソースは prd と同期している必要がない。テストコンテンツが少しあればよい
    - 現在 470 件入っているのは変換スクリプトの動作確認によるもので、移行開発が終わったら更地にしてよい
    - 2026-10-03 決定：本番リリースの前に dev を一度空にして入れ直し、prd の投入から bootstrap までのリハーサルにする（圭くんの案）。手順は `docs/reference/本番リリース手順.md` の「dev の入れ直し（通しのリハーサル）」。upload / import の state は既定のファイル名が prd 用なので、dev では `--state` で分ける。site bucket は `_internal/` だけを消す（`assets/components/` のように generate では作られない object があるため、bucket ごと空にはしない）

## 補足

- dev のデータソースは prd の複製から作った。Notion は複製してもプロパティ ID を維持するため、
  `internal-state` のプロパティ ID は dev / prd とも `o=BU` で変更不要
- `tools/migrate-to-notion` は `MIGRATION_TARGET=dev` で dev データソースを向く（既定は prd）
- `status` の式は 4 データソースとも `contains(format(prop("last-edited-by")), "workers-api")` にしてある。
  以前は `== "workers-api"` の完全一致だったが、integration の実際の名前が `mirumi-me` だったため
  🟢 公開中 は一度も表示されていなかった。integration の名前は `workers-api` / `workers-api (dev)` にそろえ、
  式は dev の `(dev)` 付きでも一致するよう部分一致にした

## WordPress 側の変更を Notion の既存データへ追従させない

2026-09-30 決定。移行が終わるまでに WordPress 側で slug の改名や本文の修正をしても、Notion に取り込み済みのデータ（dev / prd とも）は直さない。

- prd：本番リリースの準備で dev のデータソースを複製して作り直し、中身は一度全部消す（手順は `docs/reference/本番リリース手順.md` の「2. prd の準備」）。そのうえで同じ手順書のとおり `fetch` から取り直して投入するので、その時点の WordPress がそのまま反映される
    - prd に取り込んだことはあるが、かなり前の一度きり
    - 複製で作り直すのは 2026-09-30 に決定。Notion の設定（formula、ボタン、テンプレート、カラム幅などの見た目の調整）が dev と prd でずれないようにするため。ユーザーが心配していた ID の変化は、data source ID が変わるだけで property ID は維持される（`dev 環境と prd 環境の対照表.md` の `internal-state` の行）。変わる ID の直し先は手順書にまとめた
    - ユーザーの最初の案は「WP データを移行する直前に複製する」だった。3 のコメントの事前投入より前に倒したのは、あとで作り直すと事前投入したコメントも消えるため
- dev：前述のとおり prd と同期している必要がない

例：2026-09-30 に固定ページ `nice-to-meet-you-10` を `featured-posts` に改名し、表示名を「はじめましてのおすすめ記事」にした。コードは `shared/src/site-routes.ts` の `FIXED_PAGE_ROUTES` を含めて追従済み。

- dev の pages には旧 slug のページが残っているはず
- `FIXED_PAGE_ROUTES` にない slug の固定ページは preflight で `unknown-page-route` になる。full generate でもその 1 件が飛ばされるだけで、全体は止まらない
- そのあいだ dev サイトの `/featured-posts/` は 404 になり、フッターとトップからのリンクも dev では切れる
- dev の generate を失敗なしで通したい（`本番リリース手順.md` の「1. 事前の確認」など）ときは、dev の pages でそのページの `slug` を `featured-posts` に変えれば足りる
