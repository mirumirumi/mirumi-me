import { describe, expect, test, vi } from "vitest"

import type { ArticleContent } from "shared/content"

import { createInternalBookmarkLookup, resolveArticleEnrichment } from "./enrichment"

describe("article enrichment", () => {
  const article: ArticleContent = {
    id: "00000000-0000-0000-0000-000000000001",
    title: "記事",
    slug: "article",
    thumbnailUrl: null,
    thumbnailName: null,
    publishedAt: "2026-08-24T00:00:00.000Z",
    updatedAt: null,
    category: { name: "技術", slug: "tech" },
    customCss: "",
    toc: { hidden: false, closed: false },
    blocks: [
      {
        id: "internal",
        type: "bookmark",
        url: "https://mirumi.me/linked/#heading",
        caption: [],
        children: [],
      },
      {
        id: "external",
        type: "bookmark",
        url: "https://example.com/article",
        caption: [],
        children: [],
      },
      {
        id: "x-post",
        type: "embed",
        url: "https://x.com/__mirumi__/status/1234567890",
        caption: [],
        children: [],
      },
    ],
  }

  test("内部 snapshot と Worker bridge を block ID ごとに対応づける", async () => {
    const internal = createInternalBookmarkLookup([
      {
        route: "/linked/",
        title: "リンク先",
        description: "概要",
        label: "くらし",
      },
    ])
    const fetcher = vi.fn(async (request: RequestInfo | URL) => {
      const url = String(request)
      if (url.includes("/bookmark")) {
        return Response.json({
          kind: "external",
          url: "https://example.com/article",
          title: "外部記事",
          description: null,
          imageUrl: null,
          faviconUrl: null,
          label: "example.com",
        })
      }

      return Response.json({
        postId: "1234567890",
        url: "https://x.com/__mirumi__/status/1234567890",
        text: "投稿",
        authorName: "みるみ",
        authorHandle: "__mirumi__",
        avatarUrl: null,
        mediaUrls: [],
        replyCount: null,
        repostCount: null,
        likeCount: null,
        linkCard: null,
        createdAt: null,
      })
    })
    const result = await resolveArticleEnrichment(article, internal, fetcher)

    expect(result.bookmarks).toEqual({
      internal: {
        kind: "internal",
        url: "https://mirumi.me/linked/",
        title: "リンク先",
        description: "概要",
        imageUrl: null,
        faviconUrl: null,
        label: "くらし",
      },
      external: expect.objectContaining({ kind: "external", title: "外部記事" }),
    })
    expect(result.xPosts).toEqual({
      "x-post": expect.objectContaining({ postId: "1234567890" }),
    })
  })

  test("外部 bookmark の失敗でも記事全体を落とさない", async () => {
    const bookmarkOnlyArticle: ArticleContent = {
      ...article,
      blocks: [article.blocks[1]!],
    }
    const fetcher = vi.fn(async () => {
      return new Response("Gateway Timeout", { status: 504 })
    })

    expect(await resolveArticleEnrichment(bookmarkOnlyArticle, new Map(), fetcher)).toEqual({
      bookmarks: {},
      xPosts: {},
      apps: {},
    })
  })

  test("bridge への fetch には timeout 用の signal を渡す", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response("Unavailable", { status: 503 })
    })
    await resolveArticleEnrichment(article, new Map(), fetcher)
    expect(0 < fetcher.mock.calls.length).toEqual(true)
    for (const call of fetcher.mock.calls) {
      expect(call[1]?.signal).toBeInstanceOf(AbortSignal)
    }
  })

  test("属性の足りない [app ios] だけを bridge で App Store から引き、ios の値ごとに対応づける", async () => {
    const ios = "https://apps.apple.com/jp/app/some-app/id42"
    const paragraph = (id: string, content: string): ArticleContent["blocks"][number] => ({
      id,
      type: "paragraph",
      richText: [
        {
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
        },
      ],
      children: [],
    })
    const app = {
      id: "42",
      name: "アプリ",
      developer: "開発元",
      price: "無料",
      artworkUrl: "https://is1-ssl.mzstatic.com/image/thumb/icon/512x512bb.jpg",
    }
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(app),
    )
    const appArticle: ArticleContent = {
      ...article,
      blocks: [
        paragraph("new", `[app ios="${ios}"]`),
        paragraph("same", `[app ios="${ios}" price="120 円"]`),
        paragraph(
          "migrated",
          '[app name="移行したアプリ" icon="app.webp" ios="https://apps.apple.com/jp/app/old/id1"]',
        ),
      ],
    }

    expect((await resolveArticleEnrichment(appArticle, new Map(), fetcher)).apps).toEqual({
      [ios]: app,
    })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(String(fetcher.mock.calls[0]?.[0])).toEqual(
      `http://bindings.internal/app-store?url=${encodeURIComponent(ios)}`,
    )
  })

  test("xAI failure は未解決のまま renderer へ渡す", async () => {
    const xOnlyArticle: ArticleContent = {
      ...article,
      blocks: [article.blocks[2]!],
    }
    const fetcher = vi.fn(async () => {
      return new Response("Unavailable", { status: 503 })
    })

    expect(await resolveArticleEnrichment(xOnlyArticle, new Map(), fetcher)).toEqual({
      bookmarks: {},
      xPosts: {},
      apps: {},
    })
  })
})
