# ブログ本文ブロックタイプ調査 README

このディレクトリは、WordPress/MySQL の `post_content` をローカルに保存して、現在使われている本文ブロックタイプを洗い出した作業成果物置き場。

## まず見るファイル

| ファイル | 何を見るものか |
|---|---|
| `ブロックタイプ一覧.md` | 最終寄りの棚卸し表。ブロックタイプごとの件数、検出条件、代表例を一覧するメイン成果物。 |
| `上位外・少数系ブロックタイプ一覧.md` | チャットで確認した「ざっくり上位に入らないその他系」の静的リスト。低頻度タイプの見落とし確認用。 |
| `ブロックタイプ別代表スニペット.md` | 各ブロックタイプの実本文スニペット。分類が妥当か目視確認するとき用。 |
| `コンテンツ別ブロックタイプ一覧.tsv` | 記事/固定ページごとに、検出されたブロックタイプを並べた TSV。個別記事から逆引きする用。 |
| `関連記事カード一覧.tsv` | `[/slug]` 形式の関連記事カード独自記法を全件列挙した TSV。リンク先 slug の確認用。 |
| `ショートコード風除外トークン.md` | `[bps]`, `[V]`, `[Ctrl]` など、shortcode 風だがブロック扱いしないと判断したものの一覧。 |

## 必要になったら見るファイル

| ファイル | 何を見るものか |
|---|---|
| `対象コンテンツ一覧.tsv` | 今回の主対象 477 件（公開投稿 468 件 + 公開固定ページ 9 件）の ID、種別、slug、タイトル、本文文字数。 |
| `対象投稿一覧.tsv` | 固定ページを追加する前に作った、公開投稿 468 件だけの旧リスト。基本は参考用。 |
| `生構造パターン集計サマリ.md` | HTML タグ、class、shortcode、URL ドメインなどを意味分類前に機械集計したサマリ。 |
| `コンテンツ別生構造パターン.tsv` | 記事/固定ページごとの raw なタグ・class・shortcode・URL ドメイン検出結果。 |

## 補助ファイル・再解析用ファイル

| ファイル | 何を見るものか |
|---|---|
| `contents.ndjson` | DB から取得した対象 477 件の本文ローカルコピー。本文を含むので大きい。 |
| `raw-patterns.json` | raw な機械集計の詳細 JSON。 |
| `block-type-counts.json` | 意味分類後のブロックタイプ別件数・代表例の JSON。 |
| `analyze-content-patterns.mjs` | raw 集計を生成するスクリプト。 |
| `classify-content-blocks.mjs` | ブロックタイプ分類成果物を生成するスクリプト。 |

## リネーム対応表

| 旧ファイル名 | 新ファイル名 |
|---|---|
| `target-contents.tsv` | `対象コンテンツ一覧.tsv` |
| `target-posts.tsv` | `対象投稿一覧.tsv` |
| `raw-pattern-summary.md` | `生構造パターン集計サマリ.md` |
| `content-patterns.tsv` | `コンテンツ別生構造パターン.tsv` |
| `block-type-inventory.md` | `ブロックタイプ一覧.md` |
| `block-types-by-content.tsv` | `コンテンツ別ブロックタイプ一覧.tsv` |
| `representative-snippets.md` | `ブロックタイプ別代表スニペット.md` |
| `related-card-slugs.tsv` | `関連記事カード一覧.tsv` |
| `unknown-shortcode-like-tokens.md` | `ショートコード風除外トークン.md` |
| `少ないものリスト.md` | `上位外・少数系ブロックタイプ一覧.md` |

## リネームコマンド

手動でやる場合は、このディレクトリで以下を実行する。既存ファイルは上書きしない。

```bash
mv -n -- target-contents.tsv 対象コンテンツ一覧.tsv
mv -n -- target-posts.tsv 対象投稿一覧.tsv
mv -n -- raw-pattern-summary.md 生構造パターン集計サマリ.md
mv -n -- content-patterns.tsv コンテンツ別生構造パターン.tsv
mv -n -- block-type-inventory.md ブロックタイプ一覧.md
mv -n -- block-types-by-content.tsv コンテンツ別ブロックタイプ一覧.tsv
mv -n -- representative-snippets.md ブロックタイプ別代表スニペット.md
mv -n -- related-card-slugs.tsv 関連記事カード一覧.tsv
mv -n -- unknown-shortcode-like-tokens.md ショートコード風除外トークン.md
mv -n -- 少ないものリスト.md 上位外・少数系ブロックタイプ一覧.md
```

## 注意

- この調査は `futaribo` とは無関係。作業場所として一時的に使っていただけ。
- DB から取得した本文は `contents.ndjson` に含まれる。外部共有する場合は注意。
- Gutenberg は使っていない前提で、実データでも `<!-- wp:* -->` は 0 件。
- 実レンダリングは調べず、DB の `post_content` 内にある HTML / class / shortcode / 独自記法だけで分類している。

