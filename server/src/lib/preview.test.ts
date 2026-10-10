import { describe, expect, test } from "vitest"

import type { ArticleContent, RenderedContent } from "shared/content"

import {
  createPreviewHeadContent,
  renderPreviewArticle,
  resolvePreviewStylesheetUrl,
} from "./preview"

const article: ArticleContent = {
  id: "article-id",
  title: "<下書き>",
  slug: "draft",
  thumbnailUrl: "https://example.com/thumbnail.jpg?a=1&b=2",
  thumbnailName: "thumbnail.jpg",
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
  test("変換時の警告を種類ごとにまとめて最上部に出す", () => {
    const html = renderPreviewArticle(article, {
      html: "<p>本文</p>",
      warnings: [
        "amazon ショートコードの HTML 変換は未確定です（block: a）",
        "amazon ショートコードの HTML 変換は未確定です（block: b）",
        "リンクを出力できませんでした。相対パスや http/https 以外の URL は使えません: /profile",
      ],
    })

    expect(html.indexOf("preview-warnings")).toBeLessThan(html.indexOf("post_view"))
    expect(html).toContain("🚨 変換時の警告 3 件")
    // ブロック ID を落として同種をまとめ、件数をバッジで出す
    expect(html).toContain(
      '<li>amazon ショートコードの HTML 変換は未確定です<span class="preview-warnings-count">2</span></li>',
    )
    expect(html).toContain("使えません: /profile</li>")
  })

  test("警告がなければ何も出さない", () => {
    expect(renderPreviewArticle(article, renderedContent)).not.toContain("preview-warnings")
  })

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

  test("公開日が空の下書きに現在日時を補わない", () => {
    const html = renderPreviewArticle(
      { ...article, publishedAt: null, updatedAt: null },
      renderedContent,
    )

    expect(html).not.toContain("datePublished")
    expect(html).not.toContain('class="dates"')
  })
})

describe("resolvePreviewStylesheetUrl", () => {
  test("本番サイトの相対 stylesheet URL を絶対 URL にする", () => {
    expect(resolvePreviewStylesheetUrl("/_nuxt/entry.css")).toEqual(
      "https://mirumi.me/_nuxt/entry.css",
    )
  })

  test("外部サイトの stylesheet URL は変換対象にしない", () => {
    expect(resolvePreviewStylesheetUrl("https://fonts.googleapis.com/css2")).toBeNull()
    expect(resolvePreviewStylesheetUrl("http://[")).toBeNull()
  })
})

describe("createPreviewHeadContent", () => {
  test("Amazon card があるときだけ共通 hydrator を残す", () => {
    expect(createPreviewHeadContent("", true)).toContain("data-preview-amazon")
    expect(createPreviewHeadContent("", false)).not.toContain("data-preview-amazon")
  })
})
