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
          label: "example.com",
        })
      }

      return Response.json({
        postId: "1234567890",
        url: "https://x.com/__mirumi__/status/1234567890",
        text: "投稿",
        authorName: "みるみ",
        authorHandle: "__mirumi__",
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
    })
  })
})
