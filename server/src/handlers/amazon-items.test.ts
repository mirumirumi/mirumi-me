import { Hono } from "hono"
import { describe, expect, test, vi } from "vitest"

import { createAmazonCardSignature } from "shared/amazon"

import type { HonoEnv } from "../lib/types"
import {
  type AmazonItemsRateLimiter,
  type AmazonItemsResolver,
  handleAmazonItems,
  handleAmazonItemsOptions,
} from "./amazon-items"

describe("Amazon items route", () => {
  const secret = "signing-secret"
  const createRateLimiter = (success: boolean): AmazonItemsRateLimiter => {
    return { limit: vi.fn(async () => ({ success })) }
  }
  const createApp = (
    resolver: AmazonItemsResolver,
    rateLimiter?: AmazonItemsRateLimiter,
  ): Hono<HonoEnv> => {
    const resolvedRateLimiter = rateLimiter ?? createRateLimiter(true)

    return new Hono<HonoEnv>()
      .get("/api/amazon/items", (c) => handleAmazonItems(c, resolver, resolvedRateLimiter))
      .options("/api/amazon/items", (c) => handleAmazonItemsOptions(c))
  }
  const createItemQuery = async (asin: string): Promise<string> => {
    const signature = await createAmazonCardSignature(asin, secret)

    return `item=${asin}.${signature}`
  }

  describe("handleAmazonItems", () => {
    test("署名済み ASIN を検証して resolver の結果を no-store で返す", async () => {
      const resolver = vi.fn<AmazonItemsResolver>(async (asins) => ({
        items: [
          {
            asin: asins[0]!,
            title: "商品名",
            detailPageUrl: "https://www.amazon.co.jp/dp/B000000000",
            image: null,
            byLine: null,
          },
        ],
        errors: [],
      }))
      const app = createApp(resolver)
      const response = await app.request(
        `/api/amazon/items?${await createItemQuery("B000000000")}`,
        { headers: { Origin: "https://mirumi.me" } },
        {
          AMAZON_CARD_SIGNING_SECRET: secret,
          FRONTEND_ORIGIN: "https://mirumi.me",
        },
      )

      expect(response.status).toEqual(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toEqual("https://mirumi.me")
      expect(response.headers.get("Cache-Control")).toEqual("no-store")
      expect(response.headers.get("Vary")).toEqual("Origin")
      expect(await response.json()).toEqual({
        items: [
          {
            asin: "B000000000",
            title: "商品名",
            detailPageUrl: "https://www.amazon.co.jp/dp/B000000000",
            image: null,
            byLine: null,
          },
        ],
        errors: [],
      })
      expect(resolver).toHaveBeenCalledWith(["B000000000"])
    })

    test("署名なし、不正 ASIN、重複、11 件超を拒否する", async () => {
      const resolver = vi.fn<AmazonItemsResolver>()
      const app = createApp(resolver)
      const duplicate = await createItemQuery("B000000000")
      const tooMany = await Promise.all(
        Array.from({ length: 11 }, async (_, index) => {
          return createItemQuery(`B${String(index).padStart(9, "0")}`)
        }),
      )

      expect(
        (await app.request("/api/amazon/items", {}, { AMAZON_CARD_SIGNING_SECRET: secret })).status,
      ).toEqual(400)
      expect(
        (
          await app.request(
            "/api/amazon/items?item=invalid.signature",
            {},
            { AMAZON_CARD_SIGNING_SECRET: secret },
          )
        ).status,
      ).toEqual(400)
      expect(
        (
          await app.request(
            `/api/amazon/items?${duplicate}&${duplicate}`,
            {},
            { AMAZON_CARD_SIGNING_SECRET: secret },
          )
        ).status,
      ).toEqual(400)
      expect(
        (
          await app.request(
            `/api/amazon/items?${tooMany.join("&")}`,
            {},
            { AMAZON_CARD_SIGNING_SECRET: secret },
          )
        ).status,
      ).toEqual(400)
      expect(resolver).not.toHaveBeenCalled()
    })

    test("別 ASIN の署名流用と署名改変を拒否する", async () => {
      const resolver = vi.fn<AmazonItemsResolver>()
      const rateLimiter = createRateLimiter(true)
      const app = createApp(resolver, rateLimiter)
      const signature = await createAmazonCardSignature("B000000000", secret)

      expect(
        (
          await app.request(
            `/api/amazon/items?item=B000000001.${signature}`,
            {},
            { AMAZON_CARD_SIGNING_SECRET: secret },
          )
        ).status,
      ).toEqual(401)
      expect(
        (
          await app.request(
            `/api/amazon/items?item=B000000000.${signature.slice(0, -1)}A`,
            {},
            { AMAZON_CARD_SIGNING_SECRET: secret },
          )
        ).status,
      ).toEqual(401)
      expect(resolver).not.toHaveBeenCalled()
      expect(rateLimiter.limit).not.toHaveBeenCalled()
    })

    test("allowlist 外の Origin を外部 API 呼び出し前に拒否する", async () => {
      const resolver = vi.fn<AmazonItemsResolver>()
      const app = createApp(resolver)
      const response = await app.request(
        `/api/amazon/items?${await createItemQuery("B000000000")}`,
        { headers: { Origin: "https://example.com" } },
        { AMAZON_CARD_SIGNING_SECRET: secret },
      )

      expect(response.status).toEqual(403)
      expect(resolver).not.toHaveBeenCalled()
    })

    test("preview Worker の origin も許可する", async () => {
      const resolver = vi.fn<AmazonItemsResolver>(async () => ({ items: [], errors: [] }))
      const app = createApp(resolver)
      const origin = "https://mirumi-me-dev.example.workers.dev"
      const response = await app.request(
        `/api/amazon/items?${await createItemQuery("B000000000")}`,
        { headers: { Origin: origin } },
        {
          AMAZON_CARD_SIGNING_SECRET: secret,
          WORKERS_API_ORIGIN: origin,
        },
      )

      expect(response.status).toEqual(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toEqual(origin)
    })

    test("環境別 frontend origin を許可する", async () => {
      const resolver = vi.fn<AmazonItemsResolver>(async () => ({ items: [], errors: [] }))
      const app = createApp(resolver)
      const origin = "https://d3694gpnjd4x49.cloudfront.net"
      const response = await app.request(
        `/api/amazon/items?${await createItemQuery("B000000000")}`,
        { headers: { Origin: origin } },
        {
          AMAZON_CARD_SIGNING_SECRET: secret,
          FRONTEND_ORIGIN: origin,
        },
      )

      expect(response.status).toEqual(200)
      expect(response.headers.get("Access-Control-Allow-Origin")).toEqual(origin)
    })

    test("loopback origin は dev だけ許可する", async () => {
      const resolver = vi.fn<AmazonItemsResolver>(async () => ({ items: [], errors: [] }))
      const app = createApp(resolver)
      const url = `/api/amazon/items?${await createItemQuery("B000000000")}`
      const request = { headers: { Origin: "http://localhost:3000" } }

      expect(
        (
          await app.request(url, request, {
            AMAZON_CARD_SIGNING_SECRET: secret,
            APP_ENV: "dev",
          })
        ).status,
      ).toEqual(200)
      expect(
        (
          await app.request(url, request, {
            AMAZON_CARD_SIGNING_SECRET: secret,
            APP_ENV: "prd",
          })
        ).status,
      ).toEqual(403)
    })

    test("rate limit 超過時は resolver を呼ばず 429 を返す", async () => {
      const resolver = vi.fn<AmazonItemsResolver>()
      const rateLimiter = createRateLimiter(false)
      const app = createApp(resolver, rateLimiter)
      const response = await app.request(
        `/api/amazon/items?${await createItemQuery("B000000000")}`,
        {},
        { AMAZON_CARD_SIGNING_SECRET: secret },
      )

      expect(response.status).toEqual(429)
      expect(response.headers.get("Retry-After")).toEqual("60")
      expect(rateLimiter.limit).toHaveBeenCalledWith({ key: "/api/amazon/items" })
      expect(resolver).not.toHaveBeenCalled()
    })
  })

  describe("handleAmazonItemsOptions", () => {
    test("許可 origin の preflight だけを受け付ける", async () => {
      const app = createApp(vi.fn<AmazonItemsResolver>())
      const allowed = await app.request(
        "/api/amazon/items",
        {
          method: "OPTIONS",
          headers: { Origin: "https://mirumi.me" },
        },
        {
          FRONTEND_ORIGIN: "https://mirumi.me",
        },
      )
      const denied = await app.request(
        "/api/amazon/items",
        {
          method: "OPTIONS",
          headers: { Origin: "https://example.com" },
        },
        {
          FRONTEND_ORIGIN: "https://mirumi.me",
        },
      )

      expect(allowed.status).toEqual(204)
      expect(allowed.headers.get("Access-Control-Allow-Methods")).toEqual("GET, OPTIONS")
      expect(denied.status).toEqual(403)
    })
  })
})
