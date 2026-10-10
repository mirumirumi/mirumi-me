import { Hono } from "hono"
import { describe, expect, test, vi } from "vitest"

import type { HonoEnv } from "../lib/types"
import { handlePageView, type PageViewRateLimiter, type PageViewRecorder } from "./page-views"

describe("page view route", () => {
  const env = { FRONTEND_ORIGIN: "https://mirumi.me" }

  const createRecorder = (publishedRoutes: Array<string>) => {
    return {
      isPublishedRoute: vi.fn(async (route: string) => publishedRoutes.includes(route)),
      write: vi.fn((_path: string) => undefined),
    }
  }

  const createRateLimiter = (success: boolean) => {
    return { limit: vi.fn(async (_options: { key: string }) => ({ success })) }
  }

  const createApp = (
    recorder: PageViewRecorder | null,
    rateLimiter: PageViewRateLimiter | null,
  ): Hono<HonoEnv> => {
    return new Hono<HonoEnv>().post("/api/pv", (c) => handlePageView(c, recorder, rateLimiter))
  }

  const send = (app: Hono<HonoEnv>, body: string, headers: Record<string, string> = {}) => {
    return app.request(
      "/api/pv",
      {
        method: "POST",
        body,
        headers: { Origin: "https://mirumi.me", "Content-Type": "text/plain", ...headers },
      },
      env,
    )
  }

  describe("handlePageView", () => {
    test("公開中のページの PV を、そろえたパスで 1 つ書いて 204 を返す", async () => {
      const recorder = createRecorder(["/article/"])
      const rateLimiter = createRateLimiter(true)
      const response = await send(createApp(recorder, rateLimiter), "/article", {
        "CF-Connecting-IP": "203.0.113.1",
      })

      expect(response.status).toEqual(204)
      expect(recorder.write).toHaveBeenCalledWith("/article/")
      expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "pv:203.0.113.1" })
    })

    test("トップと記事一覧は、publish index を見ずに数える", async () => {
      const recorder = createRecorder([])
      const app = createApp(recorder, createRateLimiter(true))

      expect((await send(app, "/")).status).toEqual(204)
      expect((await send(app, "/entry-list/")).status).toEqual(204)
      expect(recorder.write.mock.calls).toEqual([["/"], ["/entry-list/"]])
      expect(recorder.isPublishedRoute).not.toHaveBeenCalled()
    })

    test("公開中でないページは書かずに 204、数えない形のパスは 400 にする", async () => {
      const recorder = createRecorder([])
      const app = createApp(recorder, createRateLimiter(true))

      expect((await send(app, "/hidden/")).status).toEqual(204)
      expect((await send(app, "/category/pc/")).status).toEqual(400)
      expect(recorder.write).not.toHaveBeenCalled()
    })

    test("許していない Origin は 403、rate limit を超えたら 429 にする", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const forbidden = await send(
        createApp(createRecorder(["/article/"]), createRateLimiter(true)),
        "/article/",
        { Origin: "https://example.com" },
      )
      const limited = await send(
        createApp(createRecorder(["/article/"]), createRateLimiter(false)),
        "/article/",
      )
      warn.mockRestore()

      expect(forbidden.status).toEqual(403)
      expect(limited.status).toEqual(429)
    })

    test("publish index を読めなければ 503、設定が足りなければ 500 にする", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
      const unavailable = await send(
        createApp(
          {
            isPublishedRoute: async () => {
              throw Error("S3 が落ちた")
            },
            write: vi.fn(),
          },
          createRateLimiter(true),
        ),
        "/article/",
      )
      const misconfigured = await send(createApp(null, createRateLimiter(true)), "/article/")
      error.mockRestore()

      expect(unavailable.status).toEqual(503)
      expect(misconfigured.status).toEqual(500)
    })
  })
})
