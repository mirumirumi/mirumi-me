import type { Client } from "@notionhq/client"
import { describe, expect, test, vi } from "vitest"

import { COMMENT_PROPERTIES } from "shared/notion-comments"

import { NotionPublishCommentSource } from "./comments"

describe("NotionPublishCommentSource", () => {
  const dataSourceId = "3d365425-ad40-8100-9705-000ba2e7afec"
  const schemaResponse = {
    object: "data_source",
    id: dataSourceId,
    title: [],
    properties: Object.fromEntries(
      (
        [
          [COMMENT_PROPERTIES.authorName, "title"],
          [COMMENT_PROPERTIES.slug, "rich_text"],
          [COMMENT_PROPERTIES.legacyPostId, "number"],
          [COMMENT_PROPERTIES.parent, "relation"],
          [COMMENT_PROPERTIES.content, "rich_text"],
          [COMMENT_PROPERTIES.contentFormat, "select"],
          [COMMENT_PROPERTIES.createdAt, "date"],
          [COMMENT_PROPERTIES.email, "email"],
          [COMMENT_PROPERTIES.state, "select"],
          [COMMENT_PROPERTIES.isOwner, "checkbox"],
          [COMMENT_PROPERTIES.source, "select"],
          [COMMENT_PROPERTIES.legacyCommentId, "number"],
          [COMMENT_PROPERTIES.publicId, "unique_id"],
          [COMMENT_PROPERTIES.requestId, "rich_text"],
          [COMMENT_PROPERTIES.notifiedAt, "date"],
          [COMMENT_PROPERTIES.refreshError, "rich_text"],
        ] as const
      ).map(([name, type], index) => [name, { id: `p${index}`, name, type }]),
    ),
  }
  const commentPage = (
    id: string,
    slug: string,
    legacyCommentId: number,
    parentPageId: string | null = null,
  ) => ({
    object: "page",
    id,
    url: "https://www.notion.so/page",
    created_time: "2026-09-01T00:00:00.000Z",
    last_edited_time: "2026-09-01T00:00:00.000Z",
    in_trash: false,
    parent: { type: "data_source_id", data_source_id: dataSourceId, database_id: "db" },
    properties: {
      [COMMENT_PROPERTIES.authorName]: { type: "title", title: [{ plain_text: "読者" }] },
      [COMMENT_PROPERTIES.slug]: { type: "rich_text", rich_text: [{ plain_text: slug }] },
      [COMMENT_PROPERTIES.content]: { type: "rich_text", rich_text: [{ plain_text: "本文" }] },
      [COMMENT_PROPERTIES.contentFormat]: { type: "select", select: { name: "プレーンテキスト" } },
      [COMMENT_PROPERTIES.createdAt]: {
        type: "date",
        date: { start: "2026-09-01T00:00:00.000Z", end: null },
      },
      [COMMENT_PROPERTIES.state]: { type: "select", select: { name: "承認済み" } },
      [COMMENT_PROPERTIES.legacyCommentId]: { type: "number", number: legacyCommentId },
      [COMMENT_PROPERTIES.parent]: {
        type: "relation",
        relation: parentPageId ? [{ id: parentPageId }] : [],
      },
    },
  })
  const listResponse = (results: Array<unknown>) => ({
    object: "list",
    results,
    next_cursor: null,
    has_more: false,
    type: "page_or_data_source",
    page_or_data_source: {},
  })

  test("partial は slug ごとに query して公開用に整形する", async () => {
    const query = vi.fn(async () => listResponse([commentPage("p1", "article", 10)]))
    const client = {
      dataSources: { retrieve: vi.fn(async () => schemaResponse), query },
    } as unknown as Client
    const source = await NotionPublishCommentSource.create(client, dataSourceId)

    expect(await source.loadForSlug("article")).toEqual([
      {
        id: "10",
        parentId: null,
        authorName: "読者",
        createdAt: "2026-09-01T00:00:00.000Z",
        contentHtml: "<p>本文</p>",
        isOwner: false,
      },
    ])
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { property: "slug", rich_text: { equals: "article" } },
      }),
    )
  })

  test("preloadAll 後は全件を 1 回だけ読み、slug ごとに引く", async () => {
    const query = vi.fn(async (_parameters: unknown) =>
      listResponse([
        commentPage("p1", "article", 10),
        commentPage("p2", "other", 11),
        commentPage("p3", "jemtc", 12),
      ]),
    )
    const client = {
      dataSources: { retrieve: vi.fn(async () => schemaResponse), query },
    } as unknown as Client
    const source = await NotionPublishCommentSource.create(client, dataSourceId)
    await source.preloadAll()

    expect((await source.loadForSlug("article")).map(({ id }) => id)).toEqual(["10"])
    expect((await source.loadForSlug("other")).map(({ id }) => id)).toEqual(["11"])
    expect(await source.loadForSlug("no-comments")).toEqual([])
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]?.[0]).not.toHaveProperty("filter")
  })

  test("preloadAll では slug の無い返信を親の記事に含める", async () => {
    const query = vi.fn(async (_parameters: unknown) =>
      listResponse([
        commentPage("p1", "article", 10),
        commentPage("p2", "", 11, "p1"),
        commentPage("p3", "", 12, "p2"),
      ]),
    )
    const client = {
      dataSources: { retrieve: vi.fn(async () => schemaResponse), query },
    } as unknown as Client
    const source = await NotionPublishCommentSource.create(client, dataSourceId)
    await source.preloadAll()

    expect((await source.loadForSlug("article")).map(({ id, parentId }) => [id, parentId])).toEqual(
      [
        ["10", null],
        ["11", "10"],
        ["12", "11"],
      ],
    )
  })

  test("schema が設計と違えば作成時点で失敗する", async () => {
    const client = {
      dataSources: {
        retrieve: vi.fn(async () => ({ ...schemaResponse, properties: {} })),
        query: vi.fn(),
      },
    } as unknown as Client

    await expect(NotionPublishCommentSource.create(client, dataSourceId)).rejects.toThrowError(
      "comments の schema が不正です",
    )
  })
})
