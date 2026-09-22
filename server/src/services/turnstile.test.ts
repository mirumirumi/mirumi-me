import { describe, expect, test, vi } from "vitest"

import {
  createTurnstileIdempotencyKey,
  isTurnstileVerificationAccepted,
  verifyTurnstileToken,
} from "./turnstile"

describe("turnstile", () => {
  describe("createTurnstileIdempotencyKey", () => {
    test("request-id と token の組で決まる UUID を返し、token が変われば別の key になる", async () => {
      const key = await createTurnstileIdempotencyKey("request-id", "token-1")

      expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(await createTurnstileIdempotencyKey("request-id", "token-1")).toEqual(key)
      expect(await createTurnstileIdempotencyKey("request-id", "token-2")).not.toEqual(key)
      expect(await createTurnstileIdempotencyKey("other-request", "token-1")).not.toEqual(key)
    })
  })

  describe("verifyTurnstileToken", () => {
    test("siteverify に secret、token、IP、idempotency key を送って結果を正規化する", async () => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({
          success: true,
          "error-codes": [],
          hostname: "mirumi.me",
          action: "comment",
          challenge_ts: "2026-09-21T00:00:00.000Z",
        }),
      )

      expect(
        await verifyTurnstileToken({
          fetcher,
          secret: "secret",
          token: "token",
          remoteIp: "203.0.113.1",
          idempotencyKey: "request-id",
        }),
      ).toEqual({ success: true, errorCodes: [], hostname: "mirumi.me", action: "comment" })
      const [url, init] = fetcher.mock.calls[0]!
      expect(String(url)).toEqual("https://challenges.cloudflare.com/turnstile/v0/siteverify")
      expect(JSON.parse(init?.body as string)).toEqual({
        secret: "secret",
        response: "token",
        remoteip: "203.0.113.1",
        idempotency_key: "request-id",
      })
    })

    test("失敗 response は error code を持ち、HTTP エラーは例外にする", async () => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({ success: false, "error-codes": ["timeout-or-duplicate"] }),
        )
        .mockResolvedValueOnce(new Response("error", { status: 502 }))

      expect(
        await verifyTurnstileToken({
          fetcher,
          secret: "secret",
          token: "token",
          remoteIp: null,
          idempotencyKey: "request-id",
        }),
      ).toEqual({
        success: false,
        errorCodes: ["timeout-or-duplicate"],
        hostname: null,
        action: null,
      })
      await expect(
        verifyTurnstileToken({
          fetcher,
          secret: "secret",
          token: "token",
          remoteIp: null,
          idempotencyKey: "request-id",
        }),
      ).rejects.toThrowError("502")
    })
  })

  describe("isTurnstileVerificationAccepted", () => {
    const expectation = { hostnames: new Set(["mirumi.me"]), action: "comment" }

    test("success に加えて hostname と action が一致したときだけ通す", () => {
      const verified = { success: true, errorCodes: [], hostname: "mirumi.me", action: "comment" }

      expect(isTurnstileVerificationAccepted(verified, expectation)).toEqual(true)
      expect(isTurnstileVerificationAccepted({ ...verified, success: false }, expectation)).toEqual(
        false,
      )
      expect(
        isTurnstileVerificationAccepted({ ...verified, hostname: "evil.example.com" }, expectation),
      ).toEqual(false)
      expect(isTurnstileVerificationAccepted({ ...verified, hostname: null }, expectation)).toEqual(
        false,
      )
      expect(
        isTurnstileVerificationAccepted({ ...verified, action: "login" }, expectation),
      ).toEqual(false)
    })
  })
})
