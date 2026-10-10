import { describe, expect, test, vi } from "vitest"

import type { CommentRecord } from "shared/comments"

import {
  type CommentDigestDependencies,
  createCommentDigestEmail,
  createNotionPageUrl,
  runCommentDigest,
} from "./comment-digest"

describe("comment digest", () => {
  const options = { from: "sender@example.com", to: "owner@example.com", siteName: "mirumi.me" }
  const record = (overrides: Partial<CommentRecord>): CommentRecord => ({
    pageId: "3d365425-ad40-8100-9705-000ba2e7afec",
    slug: "article",
    parentPageId: null,
    authorName: "読者",
    content: "本文\n2 行目",
    contentFormat: "plain-text",
    createdAt: "2026-09-21T00:30:00.000Z",
    state: "pending",
    isOwner: false,
    source: "public-form",
    legacyCommentId: null,
    uniqueId: 42,
    requestId: "req",
    notifiedAt: null,
    refreshError: null,
    lastEditedTime: "2026-09-21T00:30:00.000Z",
    ...overrides,
  })

  describe("createNotionPageUrl", () => {
    test("dash なしの page ID で notion.so の URL にする", () => {
      expect(createNotionPageUrl("3d365425-ad40-8100-9705-000ba2e7afec")).toEqual(
        "https://www.notion.so/3d365425ad4081009705000ba2e7afec",
      )
    })
  })

  describe("createCommentDigestEmail", () => {
    test("件数、slug、投稿者名、JST の日時、本文冒頭、row link を載せ、メールは載せない", () => {
      const email = createCommentDigestEmail(
        [
          record({}),
          record({
            pageId: "00000000-0000-0000-0000-000000000002",
            authorName: "",
            content: "あ".repeat(200),
            slug: "",
          }),
        ],
        options,
      )

      expect(email.from).toEqual("sender@example.com")
      expect(email.to).toEqual("owner@example.com")
      expect(email.subject).toEqual("[mirumi.me] 未確認のコメント 2 件")
      expect(email.text).toContain("1. [article] 読者（2026/09/21 09:30）")
      expect(email.text).toContain("   本文 2 行目")
      expect(email.text).toContain("   https://www.notion.so/3d365425ad4081009705000ba2e7afec")
      expect(email.text).toContain("2. [(slug なし)] 匿名（")
      expect(email.text).toContain(`${"あ".repeat(120)}…`)
      expect(email.text).not.toContain("@example.com\n")
    })
  })

  describe("runCommentDigest", () => {
    const createDependencies = (
      comments: Array<CommentRecord>,
      overrides: Partial<CommentDigestDependencies> = {},
    ): CommentDigestDependencies => ({
      loadUnnotifiedComments: vi.fn(async () => comments),
      sendEmail: vi.fn(async () => undefined),
      markNotified: vi.fn(async () => undefined),
      now: () => new Date("2026-09-21T00:00:00.000Z"),
      ...overrides,
    })

    test("0 件なら送らない", async () => {
      const dependencies = createDependencies([])

      expect(await runCommentDigest(dependencies, options)).toEqual({
        count: 0,
        sent: false,
        marked: 0,
      })
      expect(dependencies.sendEmail).not.toHaveBeenCalled()
    })

    test("送信成功後に対象 row の 通知日時 を書く", async () => {
      vi.useFakeTimers()
      try {
        const comments = [record({}), record({ pageId: "00000000-0000-0000-0000-000000000002" })]
        const dependencies = createDependencies(comments)
        const run = runCommentDigest(dependencies, options)
        await vi.runAllTimersAsync()

        expect(await run).toEqual({ count: 2, sent: true, marked: 2 })
        expect(dependencies.markNotified).toHaveBeenNthCalledWith(
          1,
          comments[0]!.pageId,
          "2026-09-21T00:00:00.000Z",
        )
        expect(dependencies.markNotified).toHaveBeenNthCalledWith(
          2,
          comments[1]!.pageId,
          "2026-09-21T00:00:00.000Z",
        )
      } finally {
        vi.useRealTimers()
      }
    })

    test("送信に失敗したら mark しない", async () => {
      const dependencies = createDependencies([record({})], {
        sendEmail: vi.fn(async () => Promise.reject(Error("SES SendEmail が失敗しました: 400"))),
      })

      await expect(runCommentDigest(dependencies, options)).rejects.toThrowError("SES")
      expect(dependencies.markNotified).not.toHaveBeenCalled()
    })

    test("mark の失敗は翌日の重複通知を許容してそのまま投げる", async () => {
      const dependencies = createDependencies([record({})], {
        markNotified: vi.fn(async () => Promise.reject(Error("notion down"))),
      })

      await expect(runCommentDigest(dependencies, options)).rejects.toThrowError("notion down")
      expect(dependencies.sendEmail).toHaveBeenCalledTimes(1)
    })
  })
})
