import type { Client, PageObjectResponse } from "@notionhq/client"
import { afterEach, describe, expect, test, vi } from "vitest"

import {
  createNotionClient,
  createNotionPublishUpdate,
  fetchNotionArticle,
  fetchNotionPageIndex,
  isNotionPublishResultApplied,
  parseNotionPageIndex,
  writeNotionPublishResult,
} from "./notion"

describe("createNotionClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("rate limit は Retry-After に従って最大 5 回再試行する", async () => {
    const rateLimited = (): Response => {
      return new Response(
        JSON.stringify({
          object: "error",
          status: 429,
          code: "rate_limited",
          message: "rate limited",
          request_id: "request-id",
        }),
        { status: 429, headers: { "Retry-After": "0" } },
      )
    }
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(new Response(JSON.stringify({ object: "user", id: "user-id" })))
    vi.stubGlobal("fetch", fetcher)
    const client = createNotionClient("notion-token")

    await expect(client.request({ path: "users/me", method: "get" })).resolves.toEqual({
      object: "user",
      id: "user-id",
    })
    expect(fetcher).toHaveBeenCalledTimes(6)
  })
})

describe("parseNotionPageIndex", () => {
  test("ローカル cache 用の revision と thumbnail を検証する", () => {
    const value = [
      {
        revision: {
          pageId: "page-id",
          kind: "post",
          title: "記事",
          slug: "article",
          internalState: "公開中",
          lastEditedTime: "2026-08-28T00:00:00.000Z",
          lastDeploy: null,
          lastNotionEdit: null,
          publishedAt: "2026-08-24T00:00:00.000Z",
          updatedAt: null,
          category: { name: "技術", slug: "tech" },
        },
        thumbnailUrl: "https://file.notion.so/signed-url",
        thumbnailName: "thumbnail.png",
      },
    ]

    expect(parseNotionPageIndex(value)).toEqual(value)
    expect(() => parseNotionPageIndex([{ ...value[0], extra: true }])).toThrowError()
  })
})

describe("fetchNotionArticle", () => {
  test("thumbnail の一時 URL と Files property の name を分けて保持する", async () => {
    const page = {
      object: "page",
      id: "page-id",
      url: "https://notion.so/page-id",
      properties: {
        thumbnail: {
          type: "files",
          files: [
            {
              name: "My Cover.png",
              type: "file",
              file: {
                url: "https://file.notion.so/signed-url?signature=x",
                expiry_time: "2026-08-24T04:00:00.000Z",
              },
            },
          ],
        },
      },
    } as unknown as PageObjectResponse
    const client = {
      pages: { retrieve: vi.fn(async () => page) },
      blocks: {
        children: {
          list: vi.fn(async () => ({
            object: "list",
            results: [],
            next_cursor: null,
            has_more: false,
            type: "block",
            block: {},
          })),
        },
      },
    } as unknown as Client

    expect(await fetchNotionArticle(client, page.id)).toEqual(
      expect.objectContaining({
        thumbnailUrl: "https://file.notion.so/signed-url?signature=x",
        thumbnailName: "My Cover.png",
      }),
    )
  })
})

describe("fetchNotionPageIndex", () => {
  test("data source query に response 専用の in_trash は送らない", async () => {
    const query = vi.fn(async (_parameters: unknown) => {
      return {
        object: "list",
        results: [],
        next_cursor: null,
        has_more: false,
        type: "page_or_data_source",
        page_or_data_source: {},
      }
    })
    const client = { dataSources: { query } } as unknown as Client

    await expect(
      fetchNotionPageIndex(client, { posts: "posts-source", pages: "pages-source" }),
    ).resolves.toEqual([])
    expect(query).toHaveBeenCalledTimes(2)
    for (const [parameters] of query.mock.calls) {
      expect(parameters).not.toHaveProperty("in_trash")
    }
  })
})

describe("createNotionPublishUpdate", () => {
  test("公開成功を 1 回の page update にまとめる", () => {
    expect(
      createNotionPublishUpdate({
        status: "published",
        pageId: "page-id",
        deployedAt: "2026-08-24T02:00:00.000Z",
        publishedAt: "2026-08-24T01:00:00.000Z",
        updatedAt: null,
      }),
    ).toEqual({
      page_id: "page-id",
      properties: {
        "internal-state": { type: "select", select: { name: "公開中" } },
        "last-deploy": {
          type: "date",
          date: { start: "2026-08-24T02:00:00.000Z" },
        },
        公開日: {
          type: "date",
          date: { start: "2026-08-24T01:00:00.000Z" },
        },
        公開エラー: { type: "rich_text", rich_text: [] },
      },
    })
  })

  test("内容が変わった再公開では更新日も書く", () => {
    const update = createNotionPublishUpdate({
      status: "published",
      pageId: "page-id",
      deployedAt: "2026-08-24T02:00:00.000Z",
      publishedAt: "2026-08-24T01:00:00.000Z",
      updatedAt: "2026-08-24T02:00:00.000Z",
    })
    expect(update.properties).toHaveProperty("更新日", {
      type: "date",
      date: { start: "2026-08-24T02:00:00.000Z" },
    })
  })

  test("last-notion-edit は自動更新 property なので書き込まない", () => {
    const update = createNotionPublishUpdate({
      status: "unpublished",
      pageId: "page-id",
    })

    expect(update).toEqual({
      page_id: "page-id",
      properties: {
        "internal-state": { type: "select", select: { name: "非公開" } },
        公開エラー: { type: "rich_text", rich_text: [] },
      },
    })
    expect(update.properties).not.toHaveProperty("last-notion-edit")
    expect(update.properties).not.toHaveProperty("last-deploy")
  })

  test("失敗時は配信状態に基づく state と短い公開エラーだけを書く", () => {
    expect(
      createNotionPublishUpdate({
        status: "failed",
        pageId: "page-id",
        internalState: "公開中",
        deployedAt: "2026-08-24T02:00:00.000Z",
        publishedAt: "2026-08-24T01:00:00.000Z",
        error: "slug が変更されています (workflow-id)",
      }),
    ).toEqual({
      page_id: "page-id",
      properties: {
        "internal-state": { type: "select", select: { name: "公開中" } },
        "last-deploy": {
          type: "date",
          date: { start: "2026-08-24T02:00:00.000Z" },
        },
        公開日: {
          type: "date",
          date: { start: "2026-08-24T01:00:00.000Z" },
        },
        公開エラー: {
          type: "rich_text",
          rich_text: [
            {
              type: "text",
              text: { content: "slug が変更されています (workflow-id)" },
            },
          ],
        },
      },
    })
  })

  test("配信状態が不明な失敗は state と日付を変えない", () => {
    expect(
      createNotionPublishUpdate({
        status: "failed",
        pageId: "page-id",
        internalState: null,
        deployedAt: null,
        publishedAt: null,
        error: "publish index を確認できません (workflow-id)",
      }),
    ).toEqual({
      page_id: "page-id",
      properties: {
        公開エラー: {
          type: "rich_text",
          rich_text: [
            {
              type: "text",
              text: { content: "publish index を確認できません (workflow-id)" },
            },
          ],
        },
      },
    })
  })
})

describe("writeNotionPublishResult", () => {
  const makePage = (state: "下書き" | "公開中" | "非公開", error: string): PageObjectResponse => {
    return {
      object: "page",
      id: "page-id",
      created_time: "2026-08-24T00:00:00.000Z",
      last_edited_time: "2026-08-24T02:00:00.000Z",
      created_by: { object: "user", id: "user-id" },
      last_edited_by: { object: "user", id: "user-id" },
      cover: null,
      icon: null,
      parent: { type: "data_source_id", data_source_id: "data-source-id" },
      archived: false,
      in_trash: false,
      url: "https://notion.so/page-id",
      public_url: null,
      properties: {
        "internal-state": {
          type: "select",
          select: { name: state },
        },
        "last-deploy": {
          type: "date",
          date: { start: "2026-08-24T02:00:00.000Z" },
        },
        公開日: {
          type: "date",
          date: { start: "2026-08-24T01:00:00.000Z" },
        },
        公開エラー: {
          type: "rich_text",
          rich_text: [
            {
              type: "text",
              plain_text: error,
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
        },
      },
    } as unknown as PageObjectResponse
  }

  test("書き込み応答を失っても再取得値が一致すれば成功とみなす", async () => {
    const page = makePage("公開中", "")
    const update = vi.fn(async () => {
      throw Error("response lost")
    })
    const retrieve = vi.fn(async () => page)
    const client = { pages: { update, retrieve } } as unknown as Client
    const result = {
      status: "published",
      pageId: "page-id",
      deployedAt: "2026-08-24T02:00:00.000Z",
      publishedAt: "2026-08-24T01:00:00.000Z",
      updatedAt: null,
    } as const

    expect(isNotionPublishResultApplied(page, result)).toEqual(true)
    expect(await writeNotionPublishResult(client, result)).toEqual(page)
    expect(retrieve).toHaveBeenCalledWith({ page_id: "page-id" })
  })

  test("再取得値が期待値と違うときは元の更新エラーを保つ", async () => {
    const page = makePage("下書き", "")
    const updateError = Error("response lost")
    const update = vi.fn(async () => {
      throw updateError
    })
    const retrieve = vi.fn(async () => page)
    const client = { pages: { update, retrieve } } as unknown as Client

    await expect(
      writeNotionPublishResult(client, {
        status: "unpublished",
        pageId: "page-id",
      }),
    ).rejects.toEqual(updateError)
  })
})
