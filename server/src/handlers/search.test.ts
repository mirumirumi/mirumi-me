import { Hono } from "hono"
import { describe, expect, test, vi } from "vitest"

import { prepareSearchPosts } from "shared/search"

import type { HonoEnv } from "../lib/types"
import {
  handleSearch,
  handleSearchOptions,
  type SearchPostsLoader,
  type SearchRateLimiter,
} from "./search"

describe("search route", () => {
  const env = { FRONTEND_ORIGIN: "https://mirumi.me" }
  const posts = prepareSearchPosts([
    {
      pageId: "00000000-0000-0000-0000-000000000001",
      slug: "nuxt-ssg",
      title: "Nuxt の SSG",
      publishedAt: "2026-08-24T00:00:00.000Z",
      updatedAt: null,
      text: "nuxt generate の話",
    },
  ])

  const createRateLimiter = (success: boolean) => {
    return { limit: vi.fn(async (_options: { key: string }) => ({ success })) }
  }

  const createApp = (
    loader: SearchPostsLoader | null,
    rateLimiter: SearchRateLimiter | null,
  ): Hono<HonoEnv> => {
    return new Hono<HonoEnv>()
      .get("/api/search", (c) => handleSearch(c, loader, rateLimiter))
      .options("/api/search", (c) => handleSearchOptions(c))
  }

  describe("handleSearch", () => {
    test("語を照合した結果を、送信元の IP ごとの rate limit のうえで返す", async () => {
      const rateLimiter = createRateLimiter(true)
      const response = await createApp(async () => posts, rateLimiter).request(
        "/api/search?q=%EF%BC%AE%EF%BD%95%EF%BD%98%EF%BD%94&page=1",
        { headers: { Origin: "https://mirumi.me", "CF-Connecting-IP": "203.0.113.1" } },
        env,
      )

      expect(response.status).toEqual(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toEqual("https://mirumi.me")
      expect(await response.json()).toEqual({
        total: 1,
        pages: 1,
        posts: [
          {
            slug: "nuxt-ssg",
            title: "Nuxt の SSG",
            publishedAt: "2026-08-24T00:00:00.000Z",
            updatedAt: null,
          },
        ],
      })
      expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "search:203.0.113.1" })
    })

    test("語が空か長すぎる、page が整数でない・範囲の外なら 400 にする", async () => {
      const app = createApp(async () => posts, createRateLimiter(true))

      for (const query of [
        "q=",
        "q=%20%20",
        `q=${"a".repeat(201)}`,
        "q=a&page=0",
        "q=a&page=1.5",
        "q=a&page=1001",
      ]) {
        const response = await app.request(`/api/search?${query}`, {}, env)
        expect(response.status).toEqual(400)
      }
    })

    test("許していない Origin は 403 にする", async () => {
      const response = await createApp(async () => posts, createRateLimiter(true)).request(
        "/api/search?q=nuxt",
        { headers: { Origin: "https://example.com" } },
        env,
      )

      expect(response.status).toEqual(403)
    })

    test("rate limit を超えたら 429 にする", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const response = await createApp(async () => posts, createRateLimiter(false)).request(
        "/api/search?q=nuxt",
        {},
        env,
      )
      warn.mockRestore()

      expect(response.status).toEqual(429)
      expect(response.headers.get("Retry-After")).toEqual("60")
    })

    test("索引を読めなければ 503、設定が足りなければ 500 にする", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const unavailable = await createApp(async () => {
        throw Error("S3 が落ちた")
      }, createRateLimiter(true)).request("/api/search?q=nuxt", {}, env)
      const misconfigured = await createApp(null, createRateLimiter(true)).request(
        "/api/search?q=nuxt",
        {},
        env,
      )
      error.mockRestore()

      expect(unavailable.status).toEqual(503)
      expect(misconfigured.status).toEqual(500)
    })
  })

  describe("handleSearchOptions", () => {
    test("許した Origin の preflight に GET だけを返す", async () => {
      const response = await createApp(null, null).request(
        "/api/search",
        { method: "OPTIONS", headers: { Origin: "https://mirumi.me" } },
        env,
      )

      expect(response.status).toEqual(204)
      expect(response.headers.get("Access-Control-Allow-Methods")).toEqual("GET, OPTIONS")
    })
  })
})
