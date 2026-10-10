import { Hono } from "hono"
import { describe, expect, test, vi } from "vitest"

import type { HonoEnv } from "../lib/types"
import { createTurnstileIdempotencyKey } from "../services/turnstile"
import {
  type CommentSubmissionDependencies,
  type CommentsRateLimiter,
  handleCommentSubmission,
  handleCommentsOptions,
} from "./comments"

describe("comments route", () => {
  const env = {
    FRONTEND_ORIGIN: "https://mirumi.me",
    APP_ENV: "prd",
  } as unknown as CloudflareBindings
  const requestId = "0f5a2c1e-3b4d-4e6f-8a9b-0c1d2e3f4a5b"
  const body = {
    slug: "article",
    parentId: null,
    authorName: " 読者 ",
    authorEmail: "mail@example.com",
    content: "本文\r\n2 行目",
    requestId,
    turnstileToken: "token",
  }
  const createDependencies = (
    overrides: Partial<CommentSubmissionDependencies> = {},
  ): CommentSubmissionDependencies => {
    return {
      isPublishedPostSlug: vi.fn(async () => true),
      findCommentPageIdByRequestId: vi.fn(async () => null),
      findApprovedParentPageId: vi.fn(async () => "parent-page-id"),
      verifyTurnstile: vi.fn(async () => ({
        success: true,
        errorCodes: [],
        hostname: "mirumi.me",
        action: "comment",
      })),
      createComment: vi.fn(async () => undefined),
      now: () => new Date("2026-09-21T00:00:00.000Z"),
      ...overrides,
    }
  }
  const createRateLimiter = (success: boolean): CommentsRateLimiter => {
    return { limit: vi.fn(async () => ({ success })) }
  }
  const createApp = (
    dependencies: CommentSubmissionDependencies | null,
    rateLimiter: CommentsRateLimiter | null = createRateLimiter(true),
  ): Hono<HonoEnv> => {
    return new Hono<HonoEnv>()
      .post("/api/comments", (c) => handleCommentSubmission(c, dependencies, rateLimiter))
      .options("/api/comments", (c) => handleCommentsOptions(c))
  }
  const post = (
    app: Hono<HonoEnv>,
    payload: unknown,
    headers: Record<string, string> = {
      Origin: "https://mirumi.me",
      "CF-Connecting-IP": "203.0.113.1",
    },
  ) => {
    return app.request(
      "/api/comments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
      },
      env,
    )
  }

  test("検証を通った投稿を pending の Notion row として作り 202 を返す", async () => {
    const dependencies = createDependencies()
    const response = await post(createApp(dependencies), body)

    expect(response.status).toEqual(202)
    expect(response.headers.get("Access-Control-Allow-Origin")).toEqual("https://mirumi.me")
    expect(response.headers.get("Cache-Control")).toEqual("no-store")
    expect(await response.json()).toEqual({ status: "accepted" })
    expect(dependencies.verifyTurnstile).toHaveBeenCalledWith(
      "token",
      "203.0.113.1",
      await createTurnstileIdempotencyKey(requestId, "token"),
    )
    expect(dependencies.createComment).toHaveBeenCalledWith({
      slug: "article",
      parentPageId: null,
      authorName: "読者",
      authorEmail: "mail@example.com",
      content: "本文\n2 行目",
      requestId,
      createdAt: "2026-09-21T00:00:00.000Z",
    })
  })

  test("返信は同じ記事の承認済み親だけを許し、親の page ID を relation にする", async () => {
    const dependencies = createDependencies()
    const response = await post(createApp(dependencies), { ...body, parentId: "c-42" })

    expect(response.status).toEqual(202)
    expect(dependencies.findApprovedParentPageId).toHaveBeenCalledWith("article", {
      kind: "unique",
      number: 42,
    })
    expect(dependencies.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ parentPageId: "parent-page-id" }),
    )

    const missing = createDependencies({ findApprovedParentPageId: vi.fn(async () => null) })
    const rejected = await post(createApp(missing), { ...body, parentId: "123" })
    expect(rejected.status).toEqual(404)
    expect(await rejected.json()).toEqual({ error: "unknown-parent" })
    expect(missing.createComment).not.toHaveBeenCalled()
    // 親の確認は Notion を読むので、Turnstile を通った request だけに限る
    const unverified = createDependencies({
      verifyTurnstile: vi.fn(async () => ({
        success: false,
        errorCodes: ["invalid-input-response"],
        hostname: null,
        action: null,
      })),
    })
    expect((await post(createApp(unverified), { ...body, parentId: "123" })).status).toEqual(403)
    expect(unverified.findApprovedParentPageId).not.toHaveBeenCalled()
  })

  test("FRONTEND_ORIGIN 以外の Origin と Origin なしは拒否する", async () => {
    const dependencies = createDependencies()
    const app = createApp(dependencies)

    expect((await post(app, body, { Origin: "https://evil.example.com" })).status).toEqual(403)
    expect((await post(app, body, {})).status).toEqual(403)
    expect(dependencies.createComment).not.toHaveBeenCalled()
    expect(
      (
        await app.request(
          "/api/comments",
          { method: "OPTIONS", headers: { Origin: "https://mirumi.me" } },
          env,
        )
      ).status,
    ).toEqual(204)
    expect(
      (
        await app.request(
          "/api/comments",
          { method: "OPTIONS", headers: { Origin: "https://evil.example.com" } },
          env,
        )
      ).status,
    ).toEqual(403)
  })

  test("schema に合わない body は Notion や Turnstile に触らず 400 にする", async () => {
    const dependencies = createDependencies()
    const app = createApp(dependencies)
    const cases: Array<unknown> = [
      "not json",
      { ...body, slug: "Invalid Slug" },
      { ...body, parentId: "notion-page-id" },
      { ...body, content: "   " },
      { ...body, content: "a".repeat(5_556) },
      { ...body, authorEmail: "not-an-email" },
      { ...body, requestId: "not-a-uuid" },
      { ...body, turnstileToken: "" },
      { ...body, isOwner: true },
    ]
    for (const payload of cases) {
      expect((await post(app, payload)).status).toEqual(400)
    }
    expect(dependencies.isPublishedPostSlug).not.toHaveBeenCalled()
    expect(dependencies.verifyTurnstile).not.toHaveBeenCalled()
    expect(dependencies.createComment).not.toHaveBeenCalled()
  })

  test("空のメールは null、空の名前はそのまま渡す", async () => {
    const dependencies = createDependencies()
    await post(createApp(dependencies), { ...body, authorEmail: "", authorName: "" })

    expect(dependencies.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ authorEmail: null, authorName: "" }),
    )
  })

  test("公開中でない slug は 404 にし、Turnstile を消費しない", async () => {
    const dependencies = createDependencies({ isPublishedPostSlug: vi.fn(async () => false) })
    const response = await post(createApp(dependencies), body)

    expect(response.status).toEqual(404)
    expect(await response.json()).toEqual({ error: "unknown-article" })
    expect(dependencies.verifyTurnstile).not.toHaveBeenCalled()
  })

  test("同じ request-id の再送は作り直さず 202 を返す", async () => {
    const dependencies = createDependencies({
      findCommentPageIdByRequestId: vi.fn(async () => "existing-page-id"),
    })
    const response = await post(createApp(dependencies), body)

    expect(response.status).toEqual(202)
    expect(dependencies.verifyTurnstile).not.toHaveBeenCalled()
    expect(dependencies.createComment).not.toHaveBeenCalled()
  })

  test("Turnstile の失敗、hostname 不一致、action 不一致は 403 にして保存しない", async () => {
    for (const verification of [
      {
        success: false,
        errorCodes: ["timeout-or-duplicate"],
        hostname: "mirumi.me",
        action: "comment",
      },
      { success: true, errorCodes: [], hostname: "evil.example.com", action: "comment" },
      { success: true, errorCodes: [], hostname: "mirumi.me", action: "login" },
    ]) {
      const dependencies = createDependencies({ verifyTurnstile: vi.fn(async () => verification) })
      const response = await post(createApp(dependencies), body)

      expect(response.status).toEqual(403)
      expect(await response.json()).toEqual({ error: "turnstile" })
      expect(dependencies.createComment).not.toHaveBeenCalled()
    }
  })

  test("IP 単位の rate limit を超えたら 429 にする", async () => {
    const dependencies = createDependencies()
    const rateLimiter = createRateLimiter(false)
    const response = await post(createApp(dependencies, rateLimiter), body)

    expect(response.status).toEqual(429)
    expect(response.headers.get("Retry-After")).toEqual("60")
    expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "203.0.113.1" })
    expect(dependencies.isPublishedPostSlug).not.toHaveBeenCalled()
  })

  test("設定が足りなければ 500 にする", async () => {
    expect((await post(createApp(null), body)).status).toEqual(500)
  })
})
