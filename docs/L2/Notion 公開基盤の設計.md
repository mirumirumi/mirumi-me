---
owner: ai
sources:
  - docs/L1/Notion 移行 やること.md
---

# Notion 公開基盤の設計

Notion → Workers → Workflows → Containers の公開基盤について、設計の中身とその理由を書く。
手順や契約として確定しているものは `docs/reference/Notion 公開基盤運用手順.md` を正とする。

## slug の所有

- 公開のたびに slug が変わっていないかを確かめるため、S3 の `_internal/publish-index-v1.json` に最後に公開できた pageId、slug、route の所有者を持ち、現在値と照合する
- 非公開にしたあとも記録は残し、同じ slug が別の記事で誤って再利用されるのを防ぐ
