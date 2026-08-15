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
    expect(result.html).toContain('<h1 id="h-aaaaaaaa-heading">')
    expect(result.html).toContain('<h2 id="h-bbbbbbbb-heading">')
    expect(result.html).toContain('id="h-aaaaaaaa-heading"')
    expect(result.html).toContain('href="#h-bbbbbbbb"')
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
          id: "button",
          type: "paragraph",
          richText: [text('[button text="go" color="brown"]')],
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
      "button ショートコードの HTML 変換は未確定です（block: button）",
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
