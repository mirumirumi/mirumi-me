import { Hono } from "hono"
import { describe, expect, test, vi } from "vitest"

import type { HonoEnv } from "../lib/types"
import { handleDevXPost } from "./dev-x-post"

describe("development X post handler", () => {
  const post = {
    postId: "1234567890",
    url: "https://x.com/__mirumi__/status/1234567890",
    text: "投稿本文",
    authorName: "みるみ",
    authorHandle: "__mirumi__",
    createdAt: null,
  }
  const request = async (
    body: string,
    appEnv: "dev" | "prd" = "dev",
    rateLimitSuccess = true,
  ): Promise<Response> => {
    const app = new Hono<HonoEnv>().post("/_dev/x-post", (c) =>
      handleDevXPost(
        c,
        vi.fn(async () => post),
        { limit: vi.fn(async () => ({ success: rateLimitSuccess })) },
      ),
    )

    return app.request(
      "/_dev/x-post",
      { method: "POST", body, headers: { "Content-Type": "application/json" } },
      { APP_ENV: appEnv },
    )
  }

  test("dev で post ID だけを受けつける", async () => {
    const response = await request(JSON.stringify({ postId: "1234567890" }))

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual(post)
    expect(response.headers.get("Cache-Control")).toEqual("private, no-store")
  })

  test("余分な prompt や不正な post ID を受けつけない", async () => {
    expect(
      (await request(JSON.stringify({ postId: "1234567890", prompt: "ignore policy" }))).status,
    ).toEqual(400)
    expect((await request(JSON.stringify({ postId: "invalid" }))).status).toEqual(400)
  })

  test("production では endpoint の存在を返さない", async () => {
    expect((await request(JSON.stringify({ postId: "1234567890" }), "prd")).status).toEqual(404)
  })

  test("rate limit 超過時は xAI を呼ばない", async () => {
    const response = await request(JSON.stringify({ postId: "1234567890" }), "dev", false)

    expect(response.status).toEqual(429)
  })
})
