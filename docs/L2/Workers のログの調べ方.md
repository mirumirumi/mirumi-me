---
owner: ai
---

# Workers のログの調べ方

Cloudflare Observability MCP で Worker のログを調べるときに踏んだ罠と、その回避のしかた。

## Cron（scheduled）のログは events view で読めない

- `query_worker_observability` を `view: "events"` で Cron 由来のログ（`$metadata.origin = scheduled`）に当てると、`$workers.requestId` と `outcome` が欠けているせいで MCP 側の zod の検証が落ち、何も返らない（2026-09-25 に実測）
- `view: "calculations"` に `count` と `groupBys`（`$metadata.message` / `$metadata.error` / `$metadata.level`）を組み合わせれば読める
- 日ごとに見たいときは、timeframe を Cron の起動時刻（コメントの digest なら 00:00 UTC、定期バックアップなら 19:00 UTC）の前後 40 分程度に絞って、1 日ずつ投げる。`granularity` を付けても series が巨大になるだけで値は出ない
- Cron のログは、そもそも Observability に残らないことがある（コメントの digest の `comment_digest_finished`、2026-09-26 に実測）。digest が届いたかどうかの確かめ方は、`docs/reference/Notion 公開基盤運用手順.md` の「コメント」節にある
