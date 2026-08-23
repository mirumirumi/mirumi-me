import { describe, expect, test } from "vitest"

import type { ArticleContent, ContentBlock, RichText } from "./content"
import { renderArticleContent } from "./render"

const text = (content: string, overrides: Partial<RichText> = {}): RichText => ({
  type: "text",
  content,
  href: null,
  annotations: {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: "default",
  },
  ...overrides,
})

const article = (blocks: Array<ContentBlock>): ArticleContent => ({
  id: "00000000-0000-0000-0000-123456789abc",
  title: "テスト記事",
  slug: "test",
  thumbnailUrl: null,
  publishedAt: "2026-08-14",
  updatedAt: null,
  category: null,
  customCss: "",
  toc: { hidden: false, closed: false },
  blocks,
})

describe("renderArticleContent", () => {
  test("本文をエスケープしつつ装飾とリンクを既存 HTML に変換する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "paragraph",
          type: "paragraph",
          richText: [
            text("<script>"),
            text("link", {
              href: "https://example.com/?a=1&b=2",
              annotations: {
                bold: true,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: "red",
              },
            }),
          ],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain("&lt;script&gt;")
    expect(result.html).toContain(
      '<a href="https://example.com/?a=1&amp;b=2"><span class="color-red"><strong>link</strong></span></a>',
    )
    expect(result.html).not.toContain("<script>")
    expect(result.warnings).toEqual([])
  })

  test("インライン数式を文字サイズ・上付き・下付きに戻す", () => {
    const result = renderArticleContent(
      article([
        {
          id: "equation",
          type: "paragraph",
          richText: [
            text("{\\Large\\text{大}}", { type: "equation" }),
            text("^{2}", { type: "equation" }),
            text("_{i=1}", { type: "equation" }),
          ],
          children: [],
        },
      ]),
    )

    expect(result.html).toEqual(
      '<p><span style="font-size:1.5em">大</span><sup>2</sup><sub>i=1</sub></p>',
    )
    expect(result.warnings).toEqual([])
  })

  test("画像の alt をオプショントークンかファイル名から決める", () => {
    const result = renderArticleContent(
      article([
        {
          id: "plain",
          type: "image",
          url: "https://mirumi.media/my-cats-1999x1124.png",
          caption: [],
          children: [],
        },
        {
          id: "authored",
          type: "image",
          url: "https://mirumi.media/246310.png",
          caption: [text('[image alt="タグ編集の例"] 説明文')],
          children: [],
        },
      ]),
    )

    // トークンがなければファイル名から復元する
    expect(result.html).toContain('alt="my-cats"')
    // トークンの alt が優先され、トークン部分はキャプションから取り除かれる
    expect(result.html).toContain('alt="タグ編集の例"')
    expect(result.html).toContain('<p class="wp-caption-text">説明文</p>')
    expect(result.html).not.toContain("[image")
    expect(result.warnings).toEqual([])
  })

  test("段落の途中にあるインライン画像の shortcode を img に解決する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "inline",
          type: "paragraph",
          richText: [text('前[image name="vscode.png" align="none"]後')],
          children: [],
        },
        {
          id: "listed",
          type: "bulleted_list_item",
          richText: [text('[image name="246310.png" alt="タグ編集の例"] 説明')],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain(
      '前<img src="https://mirumi.media/vscode.png" alt="vscode" loading="lazy">後',
    )
    // 段落以外のブロックでも解決し、alt があればそれを使う
    expect(result.html).toContain(
      '<li><img src="https://mirumi.media/246310.png" alt="タグ編集の例" loading="lazy"> 説明</li>',
    )
    expect(result.html).not.toContain("[image")
    expect(result.warnings).toEqual([])
  })

  test("出力できないリンクは本文を残したうえで警告にする", () => {
    const result = renderArticleContent(
      article([
        {
          id: "relative",
          type: "paragraph",
          richText: [text("相対", { href: "/profile" }), text("メール", { href: "mailto:a@b.co" })],
          children: [],
        },
      ]),
    )

    // リンクは張れないがテキストは消さない
    expect(result.html).toContain("<p>相対メール</p>")
    expect(result.html).not.toContain("<a ")
    expect(result.warnings).toEqual([
      "リンクを出力できませんでした。相対パスや http/https 以外の URL は使えません: /profile",
      "リンクを出力できませんでした。相対パスや http/https 以外の URL は使えません: mailto:a@b.co",
    ])
  })

  test("ボタンを中央寄せの段落として既存のクラスで生成する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "button",
          type: "paragraph",
          richText: [text('[button text="購入する" url="https://example.com/buy" color="orange"]')],
          children: [],
        },
        {
          id: "unknown-color",
          type: "paragraph",
          richText: [text('[button text="go" url="https://example.com/" color="magenta"]')],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain(
      '<p style="text-align:center"><span class="btn-wrap btn-wrap-orange btn-wrap-m"><a href="https://example.com/buy">購入する</a></span></p>',
    )
    // 知らない色は無視して既定の見た目にするが、気づけるよう警告は残す
    expect(result.html).toContain('<span class="btn-wrap btn-wrap-m">')
    expect(result.warnings).toEqual(["未対応のボタン色です: magenta"])
  })

  test("遅延読み込み動画と引用画像のショートコードを HTML にする", () => {
    const result = renderArticleContent(
      article([
        {
          id: "video",
          type: "paragraph",
          richText: [
            text(
              '[video delay src="https://www.youtube.com/embed/abc?start=" thumbnail="https://mirumi.media/t.jpg" ts="23s"]',
            ),
          ],
          children: [],
        },
        {
          id: "quote",
          type: "paragraph",
          richText: [text('[quoteImage name="beji-ta.jpg" copyright="©集英社"]')],
          children: [],
        },
      ]),
    )

    // クリックで iframe に差し替えるため data-video を持たせ、ts は start に反映する
    expect(result.html).toContain(
      '<div class="youtube" data-video="https://www.youtube.com/embed/abc?start=23">',
    )
    expect(result.html).toContain('<img src="https://mirumi.media/t.jpg"')
    expect(result.html).toContain(
      '<blockquote class="img"><div class="wp-caption"><img src="https://mirumi.media/beji-ta.jpg" alt="©集英社" loading="lazy"><p class="wp-caption-text">©集英社</p></div></blockquote>',
    )
    expect(result.warnings).toEqual([])
  })

  test("画像のオプションから幅と配置を反映する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "sized",
          type: "image",
          url: "https://mirumi.media/a.png",
          caption: [text('[image width="91%" align="none"] 説明')],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain(
      '<img src="https://mirumi.media/a.png" alt="a" class="alignnone" style="width:91%" loading="lazy">',
    )
    expect(result.html).toContain('<p class="wp-caption-text">説明</p>')
    expect(result.warnings).toEqual([])
  })

  test("追記ブロックの日付の書き出しを rewrite-date として復元する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "rewrite",
          type: "callout",
          icon: "♻️",
          richText: [text("追記 (2020/5/21) ：衝撃的なこと言います。")],
          children: [
            {
              id: "second",
              type: "paragraph",
              richText: [text("追記 (2022/12/21) ：前回の追記から 2 年半。")],
              children: [],
            },
            {
              id: "body",
              type: "paragraph",
              richText: [text("追記ではない普通の段落。")],
              children: [],
            },
          ],
        },
        {
          id: "info",
          type: "callout",
          icon: "💡",
          richText: [text("追記 (2020/5/21) ：これは追記ブロックではない。")],
          children: [],
        },
      ]),
    )

    // ひとつの追記ブロックに複数の追記があっても、子の段落まで拾う
    expect(result.html).toContain(
      '<p><span class="rewrite-date">追記 (2020/5/21) ：</span>衝撃的なこと言います。</p>',
    )
    expect(result.html).toContain(
      '<p><span class="rewrite-date">追記 (2022/12/21) ：</span>前回の追記から 2 年半。</p>',
    )
    // 書き出しが合わない段落と、追記ブロック以外は触らない
    expect(result.html).toContain("<p>追記ではない普通の段落。</p>")
    expect(result.html).toContain("<p>追記 (2020/5/21) ：これは追記ブロックではない。</p>")
  })

  test("引用の先頭段落を p で包み、本文のないコールアウトに空の段落を出さない", () => {
    const result = renderArticleContent(
      article([
        {
          id: "quote",
          type: "quote",
          richText: [text("一段落目")],
          children: [
            { id: "quote-2", type: "paragraph", richText: [text("二段落目")], children: [] },
          ],
        },
        {
          id: "callout",
          type: "callout",
          icon: null,
          richText: [],
          children: [
            { id: "item", type: "numbered_list_item", richText: [text("項目")], children: [] },
          ],
        },
      ]),
    )

    expect(result.html).toContain("<blockquote><p>一段落目</p><p>二段落目</p></blockquote>")
    expect(result.html).toContain('<div class="waku-common"><ol><li>項目</li></ol></div>')
    expect(result.html).not.toContain("<p></p>")
  })

  test("見出し ID と開いた状態のもくじを最初の見出し直前に生成する", () => {
    const result = renderArticleContent(
      article([
        { id: "intro", type: "paragraph", richText: [text("導入")], children: [] },
        {
          id: "00000000-0000-0000-0000-aaaaaaaaaaaa",
          type: "heading",
          level: 1,
          richText: [text("章")],
          children: [],
        },
        {
          id: "00000000-0000-0000-0000-bbbbbbbbbbbb",
          type: "heading",
          level: 2,
          richText: [text("節")],
          children: [],
        },
      ]),
    )

    expect(result.html.indexOf("導入")).toBeLessThan(result.html.indexOf('class="toc"'))
    expect(result.html.indexOf('class="toc"')).toBeLessThan(result.html.indexOf("<h1"))
    // Block ID の末尾を base64url にした 7 文字。Notion の ID は先頭が作成時刻で衝突するため
    expect(result.html).toContain('<h1 id="h-qqqqqqg-heading">')
    expect(result.html).toContain('<h2 id="h-7u7u7uw-heading">')
    expect(result.html).toContain('href="#h-7u7u7uw"')
    expect(result.html).toContain('class="toc-checkbox" type="checkbox" checked')
  })

  test("連続するリストと子リストをひとつのリストとして生成する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "list-1",
          type: "bulleted_list_item",
          richText: [text("one")],
          children: [
            {
              id: "nested",
              type: "numbered_list_item",
              richText: [text("nested")],
              children: [],
            },
          ],
        },
        {
          id: "list-2",
          type: "bulleted_list_item",
          richText: [text("two")],
          children: [],
        },
      ]),
    )

    expect(result.html).toBe("<ul><li>one<ol><li>nested</li></ol></li><li>two</li></ul>")
  })

  test("未確定・未対応の表現を警告付きで可視化する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "amazon",
          type: "paragraph",
          richText: [text('[amazon asin="B000000000"]')],
          children: [],
        },
        {
          id: "unsupported",
          type: "unsupported",
          originalType: "button",
          richText: [],
          children: [],
        },
        {
          id: "bookmark",
          type: "bookmark",
          url: "https://example.com/",
          caption: [],
          children: [],
        },
      ]),
    )

    expect(result.html.match(/🔴/g)).toHaveLength(3)
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings).toContain(
      "amazon ショートコードの HTML 変換は未確定です（block: amazon）",
    )
  })

  test("YouTube は iframe にし、未実装の X ポストはリンクと警告を表示する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "youtube",
          type: "video",
          url: "https://www.youtube.com/watch?v=abcdefghijk",
          caption: [],
          children: [],
        },
        {
          id: "x-post",
          type: "embed",
          url: "https://x.com/__mirumi__/status/123",
          caption: [],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain("https://www.youtube-nocookie.com/embed/abcdefghijk")
    expect(result.html).not.toContain('<video controls preload="metadata"')
    expect(result.html).toContain("🔴 X ポストの Static Tweet 表示は未実装です")
    expect(result.warnings).toEqual(["X ポストの Static Tweet 表示は未実装です（block: x-post）"])
  })
})
