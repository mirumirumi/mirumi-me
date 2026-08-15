import { describe, expect, test } from "vitest"

import type { ArticleContent, RenderedContent } from "shared/content"

import { renderPreviewArticle, resolvePreviewStylesheetUrl } from "./preview"

const article: ArticleContent = {
  id: "article-id",
  title: "<下書き>",
  slug: "draft",
  thumbnailUrl: "https://example.com/thumbnail.jpg?a=1&b=2",
  publishedAt: "2026-08-14T12:00:00.000Z",
  updatedAt: "2026-08-15T12:00:00.000Z",
  category: { name: "PC & ガジェット", slug: "pc" },
  customCss: "",
  toc: { hidden: false, closed: false },
  blocks: [],
}

const renderedContent: RenderedContent = {
  html: "<p>本文</p>",
  warnings: [],
}

describe("renderPreviewArticle", () => {
  test("本体と同じクラスでタイトル・サムネイル・メタ・本文だけを生成する", () => {
    const html = renderPreviewArticle(article, renderedContent)

    expect(html).toContain('class="post_view article_layout"')
    expect(html).toContain("&lt;下書き&gt;")
    expect(html).toContain("thumbnail.jpg?a=1&amp;b=2")
    expect(html).toContain("PC &amp; ガジェット")
    expect(html).toContain(">2026/08/14</time>")
    expect(html).toContain(">2026/08/15</time>")
    expect(html).toContain('<div id="content" itemprop="mainEntityOfPage"><p>本文</p></div>')
    expect(html).not.toContain("<footer")
    expect(html).not.toContain("comment")
  })
})

describe("resolvePreviewStylesheetUrl", () => {
  test("本番サイトの相対 stylesheet URL を絶対 URL にする", () => {
    expect(resolvePreviewStylesheetUrl("/_nuxt/entry.css")).toBe(
      "https://mirumi.me/_nuxt/entry.css",
    )
  })

  test("外部サイトの stylesheet URL は変換対象にしない", () => {
    expect(resolvePreviewStylesheetUrl("https://fonts.googleapis.com/css2")).toBeNull()
    expect(resolvePreviewStylesheetUrl("http://[")).toBeNull()
  })
})
