import { beforeEach, describe, expect, test, vi } from "vitest"

import type { ArticleContent } from "shared/content"
import type { NotionPageIndexItem } from "shared/notion"

const notion = vi.hoisted(() => ({
  fetchArticle: vi.fn(),
  fetchIndex: vi.fn(),
}))

vi.mock("shared/notion", async (importOriginal) => {
  const original = await importOriginal<typeof import("shared/notion")>()

  return {
    ...original,
    createNotionClient: vi.fn(() => ({})),
    fetchNotionArticle: notion.fetchArticle,
    fetchNotionPageIndex: notion.fetchIndex,
  }
})

import { NotionDevelopmentContentReader } from "./notion-content"

describe("NotionDevelopmentContentReader", () => {
  class MemoryCache {
    readonly values = new Map<string, string>()

    async get(key: string): Promise<string | null> {
      return this.values.get(key) ?? null
    }

    async put(key: string, value: string): Promise<void> {
      this.values.set(key, value)
    }
  }

  const environment = {
    NOTION_TOKEN: "notion-token",
    NOTION_POSTS_DATA_SOURCE_ID: "posts",
    NOTION_PAGES_DATA_SOURCE_ID: "pages",
    WORKERS_API_ORIGIN: "https://mirumi-me-dev.example.com",
    CF_ACCESS_CLIENT_ID: "client-id",
    CF_ACCESS_CLIENT_SECRET: "client-secret",
    CF_ACCESS_SERVICE_TOKEN_EXPIRES_AT: "2099-01-01T00:00:00.000Z",
  }
  const index: Array<NotionPageIndexItem> = [
    {
      revision: {
        pageId: "00000000-0000-0000-0000-000000000001",
        kind: "post",
        title: "記事タイトル",
        slug: "article-slug",
        internalState: "公開中",
        lastEditedTime: "2026-08-28T00:00:00.000Z",
        lastDeploy: null,
        lastNotionEdit: null,
        publishedAt: "2026-08-24T00:00:00.000Z",
        updatedAt: null,
        category: { name: "技術", slug: "tech" },
      },
      thumbnailUrl: "https://prod-files-secure.s3.us-west-2.amazonaws.com/thumbnail.png",
      thumbnailName: "thumbnail.png",
    },
    {
      revision: {
        pageId: "00000000-0000-0000-0000-000000000002",
        kind: "page",
        title: "プロフィール",
        slug: "profile",
        internalState: "公開中",
        lastEditedTime: "2026-08-27T00:00:00.000Z",
        lastDeploy: null,
        lastNotionEdit: null,
        publishedAt: "2020-01-01T00:00:00.000Z",
        updatedAt: null,
        category: null,
      },
      thumbnailUrl: null,
      thumbnailName: null,
    },
  ]
  const article: ArticleContent = {
    id: "00000000-0000-0000-0000-000000000001",
    title: "記事タイトル",
    slug: "article-slug",
    thumbnailUrl: index[0]!.thumbnailUrl,
    thumbnailName: "thumbnail.png",
    publishedAt: "2026-08-24T00:00:00.000Z",
    updatedAt: null,
    category: { name: "技術", slug: "tech" },
    customCss: "",
    toc: { hidden: false, closed: false },
    blocks: [
      { id: "text", type: "paragraph", richText: [], children: [] },
      {
        id: "x-post",
        type: "embed",
        url: "https://x.com/__mirumi__/status/1234567890",
        caption: [],
        children: [],
      },
    ],
  }

  beforeEach(() => {
    notion.fetchIndex.mockReset()
    notion.fetchIndex.mockResolvedValue(index)
    notion.fetchArticle.mockReset()
    notion.fetchArticle.mockResolvedValue(article)
  })

  test("一覧 metadata を cache し raw thumbnail を既存 UI の URL 契約へ合わせる", async () => {
    const reader = new NotionDevelopmentContentReader(environment, new MemoryCache())

    expect(await reader.readPageSummaries()).toEqual({
      schemaVersion: 1,
      pages: [
        expect.objectContaining({
          slug: "article-slug",
          thumbnailUrls: {
            article: index[0]!.thumbnailUrl,
            mobile: index[0]!.thumbnailUrl,
            card: index[0]!.thumbnailUrl,
          },
          cardImageUrl: index[0]!.thumbnailUrl,
        }),
      ],
    })
    expect(await reader.readCategories()).toEqual({
      schemaVersion: 1,
      categories: [{ name: "技術", slug: "tech" }],
    })
    expect(notion.fetchIndex).toHaveBeenCalledTimes(1)
    expect(notion.fetchArticle).not.toHaveBeenCalled()
  })

  test("本文を開いたときだけ取得し X post を Access 配下の dev endpoint で解決する", async () => {
    const fetcher = vi.fn(async (_request: RequestInfo | URL, _init?: RequestInit) => {
      return Response.json({
        postId: "1234567890",
        url: "https://x.com/__mirumi__/status/1234567890",
        text: "投稿本文",
        authorName: "みるみ",
        authorHandle: "__mirumi__",
        createdAt: null,
      })
    })
    const reader = new NotionDevelopmentContentReader(environment, new MemoryCache(), fetcher)
    const page = await reader.readPageByRoute("/article-slug/")

    expect(page.contentHtml).toContain("投稿本文")
    expect(notion.fetchArticle).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      new URL("https://mirumi-me-dev.example.com/_dev/x-post"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "CF-Access-Client-Id": "client-id",
          "CF-Access-Client-Secret": "client-secret",
        }),
        body: JSON.stringify({ postId: "1234567890" }),
      }),
    )
    expect((await reader.readPageByRoute("/article-slug/")).contentHtml).toContain("投稿本文")
    expect(notion.fetchArticle).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
