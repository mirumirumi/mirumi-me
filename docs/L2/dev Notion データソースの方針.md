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

## 補足

- dev のデータソースは prd の複製から作った。Notion は複製してもプロパティ ID を維持するため、
  `internal-state` のプロパティ ID は dev / prd とも `o=BU` で変更不要
- `tools/migrate-to-notion` は `MIGRATION_TARGET=dev` で dev データソースを向く（既定は prd）
- `status` の式は 4 データソースとも `contains(format(prop("last-edited-by")), "workers-api")` にしてある。
  以前は `== "workers-api"` の完全一致だったが、integration の実際の名前が `mirumi-me` だったため
  🟢 公開中 は一度も表示されていなかった。integration の名前は `workers-api` / `workers-api (dev)` にそろえ、
  式は dev の `(dev)` 付きでも一致するよう部分一致にした
