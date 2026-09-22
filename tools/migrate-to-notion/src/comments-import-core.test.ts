import { describe, expect, test } from "vitest"

import {
  type CommentImportState,
  createCommentPageParameters,
  createCommentSourceHash,
  createCommentTrashParameters,
  createCommentUpdateParameters,
  planCommentImport,
  sortCommentsTopologically,
  type WordPressCommentRecord,
} from "./comments-import-core"

describe("comments import core", () => {
  const record = (overrides: Partial<WordPressCommentRecord> = {}): WordPressCommentRecord => ({
    id: 100,
    postId: 10,
    postSlug: "article",
    parentId: null,
    isOwner: false,
    author: "読者",
    email: "mail@example.com",
    createdAt: "2026-09-01T00:00:00.000Z",
    content: "本文\r\n2 行目",
    ...overrides,
  })

  describe("createCommentSourceHash", () => {
    test("空メールと null、CRLF と LF を同値として扱い、保つ項目の変更だけで変わる", () => {
      const base = createCommentSourceHash(record())

      expect(createCommentSourceHash(record({ content: "本文\n2 行目" }))).toEqual(base)
      // Notion が落とす zero-width space は照合に含めない
      expect(createCommentSourceHash(record({ content: "本文\u200B\n2 行目" }))).toEqual(base)
      // Notion は秒を落とすので、秒だけ違う日時は同じ hash になる
      expect(createCommentSourceHash(record({ createdAt: "2026-09-01T00:00:45.000Z" }))).toEqual(
        base,
      )
      expect(
        createCommentSourceHash(record({ createdAt: "2026-09-01T00:01:00.000Z" })),
      ).not.toEqual(base)
      expect(createCommentSourceHash(record({ email: "" }))).toEqual(
        createCommentSourceHash(record({ email: "" })),
      )
      expect(createCommentSourceHash(record({ email: "" }))).not.toEqual(base)
      expect(createCommentSourceHash(record({ author: "別名" }))).not.toEqual(base)
      expect(createCommentSourceHash(record({ parentId: 5 }))).not.toEqual(base)
      expect(createCommentSourceHash(record({ isOwner: true }))).not.toEqual(base)
    })
  })

  describe("sortCommentsTopologically", () => {
    test("親を子より前に並べ、欠損・循環・別記事の親は失敗にする", () => {
      const parent = record({ id: 1 })
      const child = record({ id: 2, parentId: 1 })
      const grandchild = record({ id: 3, parentId: 2 })

      expect(sortCommentsTopologically([grandchild, child, parent]).map(({ id }) => id)).toEqual([
        1, 2, 3,
      ])
      expect(() => sortCommentsTopologically([record({ id: 2, parentId: 1 })])).toThrowError(
        "承認済み一覧にありません",
      )
      expect(() =>
        sortCommentsTopologically([record({ id: 1, parentId: 2 }), record({ id: 2, parentId: 1 })]),
      ).toThrowError("循環")
      expect(() =>
        sortCommentsTopologically([
          record({ id: 1, postId: 10 }),
          record({ id: 2, parentId: 1, postId: 11 }),
        ]),
      ).toThrowError("別の記事")
    })
  })

  describe("planCommentImport", () => {
    test("未投入は create、hash 一致は skip、hash 違いと pending は update、消えた row は trash", () => {
      const unchanged = record({ id: 1 })
      const changed = record({ id: 2, content: "修正後" })
      const pending = record({ id: 3 })
      const fresh = record({ id: 4, parentId: 1 })
      const orphan = record({ id: 6 })
      const state: CommentImportState = {
        "1": { pageId: "page-1", sourceHash: createCommentSourceHash(unchanged), status: "done" },
        "2": { pageId: "page-2", sourceHash: "old-hash", status: "done" },
        "3": { pageId: "page-3", sourceHash: createCommentSourceHash(pending), status: "pending" },
        "6": { pageId: null, sourceHash: createCommentSourceHash(orphan), status: "pending" },
        "9": { pageId: "page-9", sourceHash: "gone", status: "done" },
        "8": { pageId: "page-8", sourceHash: "gone", status: "trashed" },
        "7": { pageId: null, sourceHash: "gone", status: "pending" },
      }

      const plan = planCommentImport([fresh, pending, changed, unchanged, orphan], state)

      expect(plan.counts).toEqual({ create: 2, update: 2, skip: 1, trash: 1 })
      expect(
        plan.operations.map((operation) => [
          operation.kind,
          "record" in operation ? operation.record.id : operation.legacyCommentId,
          operation.kind === "create" ? operation.resume : null,
        ]),
      ).toEqual([
        ["skip", 1, null],
        ["update", 2, null],
        ["update", 3, null],
        ["create", 4, false],
        ["create", 6, true],
        ["trash", 9, null],
      ])
    })

    test("trash 済みの row が承認済みに戻れば update で復活させる", () => {
      const restored = record({ id: 5 })
      const plan = planCommentImport([restored], {
        "5": { pageId: "page-5", sourceHash: createCommentSourceHash(restored), status: "trashed" },
      })

      expect(plan.operations).toEqual([
        {
          kind: "update",
          record: restored,
          sourceHash: createCommentSourceHash(restored),
          pageId: "page-5",
        },
      ])
    })
  })

  describe("createCommentPageParameters", () => {
    test("approved / wordpress / wordpress-html の row を作り、通知済みにする", () => {
      const parameters = createCommentPageParameters(
        "ds",
        record({ parentId: 50, isOwner: true, email: "" }),
        "parent-page",
        "2026-09-21T00:00:00.000Z",
      )

      expect(parameters.parent).toEqual({ type: "data_source_id", data_source_id: "ds" })
      expect(parameters.properties).toEqual({
        投稿者名: { type: "title", title: [{ type: "text", text: { content: "読者" } }] },
        slug: {
          type: "rich_text",
          rich_text: [{ type: "text", text: { content: "article" } }],
        },
        "legacy-post-id": { type: "number", number: 10 },
        親コメント: { type: "relation", relation: [{ id: "parent-page" }] },
        本文: {
          type: "rich_text",
          rich_text: [{ type: "text", text: { content: "本文\n2 行目" } }],
        },
        本文形式: { type: "select", select: { name: "WordPress HTML" } },
        投稿日: { type: "date", date: { start: "2026-09-01T00:00:00.000Z" } },
        email: { type: "email", email: null },
        status: { type: "select", select: { name: "承認済み" } },
        管理者コメント: { type: "checkbox", checkbox: true },
        from: { type: "select", select: { name: "WordPress" } },
        "legacy-comment-id": { type: "number", number: 100 },
        通知日: { type: "date", date: { start: "2026-09-21T00:00:00.000Z" } },
      })
    })

    test("親があるのに page ID が無ければ失敗し、空の名前は空 title にする", () => {
      expect(() =>
        createCommentPageParameters(
          "ds",
          record({ parentId: 50 }),
          null,
          "2026-09-21T00:00:00.000Z",
        ),
      ).toThrowError("親コメントの page ID がありません")
      expect(
        createCommentPageParameters("ds", record({ author: "" }), null, "2026-09-21T00:00:00.000Z")
          .properties?.投稿者名,
      ).toEqual({ type: "title", title: [] })
    })
  })

  describe("update / trash parameters", () => {
    test("update は同じ property を page ID に書き、trash は status だけを変える", () => {
      const update = createCommentUpdateParameters(
        "page-1",
        record(),
        null,
        "2026-09-21T00:00:00.000Z",
      )

      expect(update.page_id).toEqual("page-1")
      expect(update.properties).toEqual(
        createCommentPageParameters("ds", record(), null, "2026-09-21T00:00:00.000Z").properties,
      )
      expect(createCommentTrashParameters("page-1")).toEqual({
        page_id: "page-1",
        properties: { status: { type: "select", select: { name: "ゴミ箱" } } },
      })
    })
  })
})
