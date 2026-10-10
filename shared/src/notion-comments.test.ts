import {
  APIErrorCode,
  APIResponseError,
  type Client,
  type PageObjectResponse,
} from "@notionhq/client"
import { describe, expect, test, vi } from "vitest"

import {
  COMMENT_PROPERTIES,
  type CommentDataSourceSchema,
  createApprovedCommentByPublicIdFilter,
  createArticleCommentsFilter,
  createCommentNotifiedUpdate,
  createCommentRefreshErrorUpdate,
  createCommentSlugUpdate,
  createPublicCommentParameters,
  createUnnotifiedPublicFormCommentsFilter,
  fetchCommentPage,
  fetchCommentRecords,
  MAX_COMMENT_SLUG_INHERITANCE_DEPTH,
  parseCommentPage,
  readCommentPropertyIds,
  resolveCommentDataSourceSchema,
  resolveInheritedCommentSlug,
} from "./notion-comments"

describe("notion comments", () => {
  const dataSourceId = "3d365425-ad40-8100-9705-000ba2e7afec"
  const schema: CommentDataSourceSchema = {
    dataSourceId,
    propertyIds: {
      authorName: "title",
      slug: "slug",
      legacyPostId: "lpid",
      parent: "parent",
      content: "content",
      contentFormat: "format",
      createdAt: "created",
      email: "email",
      state: "state",
      isOwner: "owner",
      source: "source",
      legacyCommentId: "lcid",
      publicId: "uid",
      requestId: "rid",
      notifiedAt: "notified",
      refreshError: "error",
    },
  }
  const page = (
    properties: Record<string, unknown>,
    overrides: Partial<PageObjectResponse> = {},
  ): PageObjectResponse => {
    return {
      object: "page",
      id: "00000000-0000-0000-0000-000000000001",
      url: "https://www.notion.so/page",
      created_time: "2026-09-01T00:00:00.000Z",
      last_edited_time: "2026-09-02T00:00:00.000Z",
      in_trash: false,
      parent: { type: "data_source_id", data_source_id: dataSourceId, database_id: "db" },
      properties,
      ...overrides,
    } as unknown as PageObjectResponse
  }
  const fullProperties = {
    [COMMENT_PROPERTIES.authorName]: { type: "title", title: [{ plain_text: "読者" }] },
    [COMMENT_PROPERTIES.slug]: { type: "rich_text", rich_text: [{ plain_text: " article " }] },
    [COMMENT_PROPERTIES.legacyPostId]: { type: "number", number: 10 },
    [COMMENT_PROPERTIES.parent]: {
      type: "relation",
      relation: [{ id: "00000000-0000-0000-0000-000000000002" }],
    },
    [COMMENT_PROPERTIES.content]: {
      type: "rich_text",
      rich_text: [{ plain_text: "前半" }, { plain_text: "後半" }],
    },
    [COMMENT_PROPERTIES.contentFormat]: { type: "select", select: { name: "WordPress HTML" } },
    [COMMENT_PROPERTIES.createdAt]: {
      type: "date",
      date: { start: "2026-08-01T12:00:00.000+09:00", end: null },
    },
    [COMMENT_PROPERTIES.state]: { type: "select", select: { name: "承認済み" } },
    [COMMENT_PROPERTIES.isOwner]: { type: "checkbox", checkbox: true },
    [COMMENT_PROPERTIES.source]: { type: "select", select: { name: "WordPress" } },
    [COMMENT_PROPERTIES.legacyCommentId]: { type: "number", number: 123 },
    [COMMENT_PROPERTIES.publicId]: { type: "unique_id", unique_id: { prefix: "c", number: 5 } },
    [COMMENT_PROPERTIES.requestId]: { type: "rich_text", rich_text: [{ plain_text: "req-1" }] },
    [COMMENT_PROPERTIES.notifiedAt]: {
      type: "date",
      date: { start: "2026-09-01T00:00:00.000Z", end: null },
    },
  }

  describe("resolveCommentDataSourceSchema", () => {
    const dataSource = (properties: Record<string, { id: string; type: string }>) => {
      return {
        object: "data_source",
        id: dataSourceId,
        title: [],
        properties: Object.fromEntries(
          Object.entries(properties).map(([name, property]) => [name, { name, ...property }]),
        ),
      }
    }
    const validProperties = {
      [COMMENT_PROPERTIES.authorName]: { id: "title", type: "title" },
      [COMMENT_PROPERTIES.slug]: { id: "slug", type: "rich_text" },
      [COMMENT_PROPERTIES.legacyPostId]: { id: "lpid", type: "number" },
      [COMMENT_PROPERTIES.parent]: { id: "parent", type: "relation" },
      [COMMENT_PROPERTIES.content]: { id: "content", type: "rich_text" },
      [COMMENT_PROPERTIES.contentFormat]: { id: "format", type: "select" },
      [COMMENT_PROPERTIES.createdAt]: { id: "created", type: "date" },
      [COMMENT_PROPERTIES.email]: { id: "email", type: "email" },
      [COMMENT_PROPERTIES.state]: { id: "state", type: "select" },
      [COMMENT_PROPERTIES.isOwner]: { id: "owner", type: "checkbox" },
      [COMMENT_PROPERTIES.source]: { id: "source", type: "select" },
      [COMMENT_PROPERTIES.legacyCommentId]: { id: "lcid", type: "number" },
      [COMMENT_PROPERTIES.publicId]: { id: "uid", type: "unique_id" },
      [COMMENT_PROPERTIES.requestId]: { id: "rid", type: "rich_text" },
      [COMMENT_PROPERTIES.notifiedAt]: { id: "notified", type: "date" },
      [COMMENT_PROPERTIES.refreshError]: { id: "error", type: "rich_text" },
    }

    test("設計どおりの property から ID を集める", async () => {
      const client = {
        dataSources: { retrieve: vi.fn(async () => dataSource(validProperties)) },
      } as unknown as Client

      expect(await resolveCommentDataSourceSchema(client, dataSourceId)).toEqual(schema)
    })

    test("property の欠落と型違いをまとめて報告する", async () => {
      const { [COMMENT_PROPERTIES.publicId]: _publicId, ...missing } = validProperties
      const client = {
        dataSources: {
          retrieve: vi.fn(async () =>
            dataSource({
              ...missing,
              [COMMENT_PROPERTIES.state]: { id: "state", type: "status" },
            }),
          ),
        },
      } as unknown as Client

      await expect(resolveCommentDataSourceSchema(client, dataSourceId)).rejects.toThrowError(
        "status の型が select ではありません / id がありません",
      )
    })
  })

  describe("readCommentPropertyIds", () => {
    test("メールアドレスは取得対象に含めない", () => {
      const ids = readCommentPropertyIds(schema)

      expect(ids).not.toContain("email")
      expect(ids).toHaveLength(15)
    })
  })

  describe("parseCommentPage", () => {
    test("property を正規化し、メールアドレスは持たない", () => {
      const record = parseCommentPage(page(fullProperties))

      expect(record).toEqual({
        pageId: "00000000-0000-0000-0000-000000000001",
        slug: "article",
        parentPageId: "00000000-0000-0000-0000-000000000002",
        authorName: "読者",
        content: "前半後半",
        contentFormat: "wordpress-html",
        createdAt: "2026-08-01T12:00:00.000+09:00",
        state: "approved",
        isOwner: true,
        source: "wordpress",
        legacyCommentId: 123,
        uniqueId: 5,
        requestId: "req-1",
        notifiedAt: "2026-09-01T00:00:00.000Z",
        refreshError: null,
        lastEditedTime: "2026-09-02T00:00:00.000Z",
      })
      expect(Object.keys(record)).not.toContain("email")
    })

    test("空の row は plain-text と created_time に倒し、不明な select は null にする", () => {
      expect(
        parseCommentPage(
          page({
            [COMMENT_PROPERTIES.state]: { type: "select", select: { name: "approved" } },
            [COMMENT_PROPERTIES.contentFormat]: { type: "select", select: null },
          }),
        ),
      ).toEqual({
        pageId: "00000000-0000-0000-0000-000000000001",
        slug: "",
        parentPageId: null,
        authorName: "",
        content: "",
        contentFormat: "plain-text",
        createdAt: "2026-09-01T00:00:00.000Z",
        state: null,
        isOwner: false,
        source: null,
        legacyCommentId: null,
        uniqueId: null,
        requestId: null,
        notifiedAt: null,
        refreshError: null,
        lastEditedTime: "2026-09-02T00:00:00.000Z",
      })
    })
  })

  describe("fetchCommentPage", () => {
    test("comments 以外の row は null にし、取得 property からメールを外す", async () => {
      const retrieve = vi
        .fn()
        .mockResolvedValueOnce(page(fullProperties))
        .mockResolvedValueOnce(
          page(fullProperties, {
            parent: { type: "data_source_id", data_source_id: "posts", database_id: "db" },
          }),
        )
      const client = { pages: { retrieve } } as unknown as Client

      expect(await fetchCommentPage(client, schema, "page-id")).toEqual(
        expect.objectContaining({ slug: "article" }),
      )
      expect(await fetchCommentPage(client, schema, "page-id")).toEqual(null)
      expect(retrieve).toHaveBeenCalledWith({
        page_id: "page-id",
        filter_properties: readCommentPropertyIds(schema),
      })
    })
  })

  describe("resolveInheritedCommentSlug", () => {
    const parentId = "00000000-0000-0000-0000-000000000002"
    const grandParentId = "00000000-0000-0000-0000-000000000003"
    const rowWith = (id: string, slug: string, parent: string | null) => {
      return page(
        {
          ...fullProperties,
          [COMMENT_PROPERTIES.slug]: { type: "rich_text", rich_text: [{ plain_text: slug }] },
          [COMMENT_PROPERTIES.parent]: {
            type: "relation",
            relation: parent ? [{ id: parent }] : [],
          },
        },
        { id },
      )
    }

    test("slug が空なら親を順に取得し、最初に見つかった slug を返す", async () => {
      const retrieve = vi
        .fn()
        .mockResolvedValueOnce(rowWith(parentId, "", grandParentId))
        .mockResolvedValueOnce(rowWith(grandParentId, "article", null))
      const client = { pages: { retrieve } } as unknown as Client
      const record = parseCommentPage(rowWith("self", "", parentId))

      expect(await resolveInheritedCommentSlug(client, schema, record)).toEqual("article")
      expect(retrieve).toHaveBeenCalledTimes(2)
      expect(retrieve.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ page_id: parentId }))
    })

    test("slug がある row は取得せずそのまま、親が無い・comments 以外・深すぎる場合は空", async () => {
      const retrieve = vi.fn()
      const client = { pages: { retrieve } } as unknown as Client

      expect(
        await resolveInheritedCommentSlug(
          client,
          schema,
          parseCommentPage(rowWith("self", "a", parentId)),
        ),
      ).toEqual("a")
      expect(
        await resolveInheritedCommentSlug(
          client,
          schema,
          parseCommentPage(rowWith("self", "", null)),
        ),
      ).toEqual("")
      expect(retrieve).not.toHaveBeenCalled()
      retrieve.mockResolvedValueOnce(
        page(fullProperties, {
          parent: { type: "data_source_id", data_source_id: "posts", database_id: "db" },
        }),
      )
      expect(
        await resolveInheritedCommentSlug(
          client,
          schema,
          parseCommentPage(rowWith("self", "", parentId)),
        ),
      ).toEqual("")
      // 常に slug の無い親を返し続ける
      retrieve.mockImplementation(async ({ page_id }: { page_id: string }) =>
        rowWith(page_id, "", `${page_id}-parent`),
      )
      expect(
        await resolveInheritedCommentSlug(
          client,
          schema,
          parseCommentPage(rowWith("self", "", parentId)),
        ),
      ).toEqual("")
      expect(retrieve).toHaveBeenCalledTimes(1 + MAX_COMMENT_SLUG_INHERITANCE_DEPTH)
    })
  })

  describe("filters", () => {
    test("承認済み、request-id、public ID、未通知の filter を組み立てる", () => {
      expect(createArticleCommentsFilter(null)).toEqual(null)
      expect(createArticleCommentsFilter("article")).toEqual({
        property: "slug",
        rich_text: { equals: "article" },
      })
      expect(
        createApprovedCommentByPublicIdFilter("article", { kind: "legacy", number: 123 }),
      ).toEqual({
        and: [
          { property: "status", select: { equals: "承認済み" } },
          { property: "slug", rich_text: { equals: "article" } },
          { property: "legacy-comment-id", number: { equals: 123 } },
        ],
      })
      expect(
        createApprovedCommentByPublicIdFilter("article", { kind: "unique", number: 7 }),
      ).toEqual({
        and: [
          { property: "status", select: { equals: "承認済み" } },
          { property: "slug", rich_text: { equals: "article" } },
          { property: "id", unique_id: { equals: 7 } },
        ],
      })
      expect(createUnnotifiedPublicFormCommentsFilter()).toEqual({
        and: [
          { property: "from", select: { equals: "公開フォーム" } },
          { property: "通知日", date: { is_empty: true } },
        ],
      })
    })
  })

  describe("fetchCommentRecords", () => {
    const listResponse = (
      results: Array<unknown>,
      nextCursor: string | null,
      requestStatus?: { type: "complete" | "incomplete" },
    ) => ({
      object: "list",
      results,
      next_cursor: nextCursor,
      has_more: nextCursor !== null,
      type: "page_or_data_source",
      page_or_data_source: {},
      request_status: requestStatus,
    })

    test("cursor を辿って全 page を集め、ゴミ箱の row は除く", async () => {
      const query = vi
        .fn()
        .mockResolvedValueOnce(listResponse([page(fullProperties)], "cursor-1"))
        .mockResolvedValueOnce(
          listResponse(
            [
              page(fullProperties, { id: "trashed", in_trash: true }),
              page(fullProperties, { id: "second" }),
            ],
            null,
          ),
        )
      const client = { dataSources: { query } } as unknown as Client

      const records = await fetchCommentRecords(
        client,
        schema,
        createArticleCommentsFilter("article"),
      )

      expect(records.map(({ pageId }) => pageId)).toEqual([
        "00000000-0000-0000-0000-000000000001",
        "second",
      ])
      expect(query).toHaveBeenNthCalledWith(1, {
        data_source_id: dataSourceId,
        filter_properties: readCommentPropertyIds(schema),
        filter: createArticleCommentsFilter("article"),
        sorts: [{ property: "投稿日", direction: "ascending" }],
        page_size: 100,
        result_type: "page",
      })
      expect(query).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ start_cursor: "cursor-1" }),
      )
    })

    test("一時的な 5xx は backoff して再試行し、内容が悪い error はそのまま投げる", async () => {
      const apiError = (code: APIErrorCode, status: number) =>
        new APIResponseError({
          code,
          message: code,
          status,
          headers: {},
          rawBodyText: "",
          additional_data: undefined,
          request_id: undefined,
        })
      const query = vi
        .fn()
        .mockRejectedValueOnce(apiError(APIErrorCode.ServiceUnavailable, 503))
        .mockRejectedValueOnce(apiError(APIErrorCode.GatewayTimeout, 504))
        .mockResolvedValueOnce(listResponse([page(fullProperties)], null))
        .mockRejectedValueOnce(apiError(APIErrorCode.ValidationError, 400))
      const client = { dataSources: { query } } as unknown as Client
      const sleep = vi.fn(async () => undefined)

      expect((await fetchCommentRecords(client, schema, null, sleep)).length).toEqual(1)
      expect(sleep.mock.calls).toEqual([[1_000], [2_000]])
      await expect(fetchCommentRecords(client, schema, null, sleep)).rejects.toThrowError(
        "validation_error",
      )
      expect(query).toHaveBeenCalledTimes(4)
    })

    test("query が incomplete なら 0 件へ縮退せず失敗する", async () => {
      const client = {
        dataSources: {
          query: vi.fn(async () => listResponse([], null, { type: "incomplete" })),
        },
      } as unknown as Client

      await expect(
        fetchCommentRecords(client, schema, createArticleCommentsFilter(null)),
      ).rejects.toThrowError("途中で打ち切られました")
    })
  })

  describe("createPublicCommentParameters", () => {
    test("pending / public-form / plain-text の row を作り、空の名前は 匿名 にする", () => {
      expect(
        createPublicCommentParameters(dataSourceId, {
          slug: "article",
          parentPageId: "00000000-0000-0000-0000-000000000002",
          authorName: " ",
          authorEmail: null,
          content: "本文",
          requestId: "req-1",
          createdAt: "2026-09-21T00:00:00.000Z",
        }),
      ).toEqual({
        parent: { type: "data_source_id", data_source_id: dataSourceId },
        properties: {
          投稿者名: { type: "title", title: [{ type: "text", text: { content: "匿名" } }] },
          slug: {
            type: "rich_text",
            rich_text: [{ type: "text", text: { content: "article" } }],
          },
          親コメント: {
            type: "relation",
            relation: [{ id: "00000000-0000-0000-0000-000000000002" }],
          },
          本文: { type: "rich_text", rich_text: [{ type: "text", text: { content: "本文" } }] },
          本文形式: { type: "select", select: { name: "プレーンテキスト" } },
          投稿日: { type: "date", date: { start: "2026-09-21T00:00:00.000Z" } },
          email: { type: "email", email: null },
          status: { type: "select", select: { name: "承認待ち" } },
          管理者コメント: { type: "checkbox", checkbox: false },
          from: { type: "select", select: { name: "公開フォーム" } },
          "request-id": {
            type: "rich_text",
            rich_text: [{ type: "text", text: { content: "req-1" } }],
          },
        },
      })
    })

    test("長い本文は 2,000 文字ごとに分ける", () => {
      const parameters = createPublicCommentParameters(dataSourceId, {
        slug: "article",
        parentPageId: null,
        authorName: "読者",
        authorEmail: "mail@example.com",
        content: "あ".repeat(4_481),
        requestId: "req-1",
        createdAt: "2026-09-21T00:00:00.000Z",
      })
      const properties = parameters.properties!
      const content = properties.本文

      expect(content?.type === "rich_text" ? content.rich_text.length : 0).toEqual(3)
      expect(properties.親コメント).toEqual({ type: "relation", relation: [] })
      expect(properties.email).toEqual({
        type: "email",
        email: "mail@example.com",
      })
    })
  })

  describe("updates", () => {
    test("公開エラーと通知日の更新は対象 property だけを書く", () => {
      expect(createCommentRefreshErrorUpdate("page-id", "失敗")).toEqual({
        page_id: "page-id",
        properties: {
          公開エラー: {
            type: "rich_text",
            rich_text: [{ type: "text", text: { content: "失敗" } }],
          },
        },
      })
      expect(createCommentRefreshErrorUpdate("page-id", null)).toEqual({
        page_id: "page-id",
        properties: { 公開エラー: { type: "rich_text", rich_text: [] } },
      })
      expect(createCommentNotifiedUpdate("page-id", "2026-09-21T00:00:00.000Z")).toEqual({
        page_id: "page-id",
        properties: { 通知日: { type: "date", date: { start: "2026-09-21T00:00:00.000Z" } } },
      })
      expect(createCommentSlugUpdate("page-id", "article")).toEqual({
        page_id: "page-id",
        properties: {
          slug: { type: "rich_text", rich_text: [{ type: "text", text: { content: "article" } }] },
        },
      })
    })
  })
})
