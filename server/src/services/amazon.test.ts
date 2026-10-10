import { describe, expect, test, vi } from "vitest"

import type { AmazonCardItem } from "shared/amazon"

import type { Fetcher } from "../lib/types"
import { type AmazonCache, AmazonService, type AmazonServiceConfig } from "./amazon"

describe("AmazonService", () => {
  class MemoryCache implements AmazonCache {
    values = new Map<string, string>()
    writes: Array<{ key: string; value: string; expirationTtl: number }> = []

    async get(key: string): Promise<string | null> {
      return this.values.get(key) ?? null
    }

    async put(key: string, value: string, options: { expirationTtl: number }) {
      this.values.set(key, value)
      this.writes.push({ key, value, expirationTtl: options.expirationTtl })
    }
  }

  const now = Date.parse("2026-08-24T00:00:00.000Z")
  const config: AmazonServiceConfig = {
    credentialId: "credential-id",
    credentialSecret: "credential-secret",
    credentialVersion: "3.3",
    marketplace: "www.amazon.co.jp",
    partnerTag: "milmemo-22",
  }
  const cachedItem: AmazonCardItem = {
    asin: "B000000000",
    title: "キャッシュ済み商品",
    detailPageUrl: "https://www.amazon.co.jp/dp/B000000000?tag=milmemo-22",
    image: null,
    byLine: "メーカー",
  }

  test("1 日以内の商品 cache だけで応答して外部 API を呼ばない", async () => {
    const cache = new MemoryCache()
    cache.values.set(
      "amazon-item:v1:www.amazon.co.jp:B000000000",
      JSON.stringify({ version: 1, fetchedAt: "2026-08-23T12:00:00.000Z", item: cachedItem }),
    )
    const fetcher = vi.fn<Fetcher>()
    const service = new AmazonService({ cache, config, fetcher, now: () => now })

    expect(await service.getItems(["B000000000"])).toEqual({
      items: [cachedItem],
      errors: [],
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  test("OAuth token を 1 回取得し、最大 10 ASIN を GetItems へまとめる", async () => {
    const cache = new MemoryCache()
    const fetcher = vi.fn<Fetcher>(async (input, init) => {
      const url = input.toString()
      if (url.includes("/auth/o2/token")) {
        return Response.json({
          access_token: "access-token",
          token_type: "bearer",
          expires_in: 3600,
        })
      }

      expect(url).toEqual("https://creatorsapi.amazon/catalog/v1/getItems")
      expect(init?.headers).toEqual({
        Authorization: "Bearer access-token",
        "Content-Type": "application/json",
        "x-marketplace": "www.amazon.co.jp",
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        itemIds: ["B000000000", "B000000001"],
        itemIdType: "ASIN",
        marketplace: "www.amazon.co.jp",
        partnerTag: "milmemo-22",
        resources: ["images.primary.large", "itemInfo.title", "itemInfo.byLineInfo"],
      })

      return Response.json({
        errors: [{ code: "ItemNotAccessible", message: "B000000001 is unavailable" }],
        itemResults: {
          items: [
            {
              asin: "B000000000",
              detailPageURL: "https://www.amazon.co.jp/dp/B000000000?tag=milmemo-22&linkCode=ogi",
              images: {
                primary: {
                  large: {
                    url: "https://m.media-amazon.com/images/I/example.jpg",
                    width: 500,
                    height: 500,
                  },
                },
              },
              itemInfo: {
                title: { displayValue: "API 商品名" },
                byLineInfo: {
                  contributors: [
                    { name: "著者 A", role: "著者", roleType: "author" },
                    { name: "著者 B", role: "著者", roleType: "author" },
                  ],
                },
              },
            },
          ],
        },
      })
    })
    const service = new AmazonService({ cache, config, fetcher, now: () => now })

    expect(await service.getItems(["B000000000", "B000000001"])).toEqual({
      items: [
        {
          asin: "B000000000",
          title: "API 商品名",
          detailPageUrl: "https://www.amazon.co.jp/dp/B000000000?tag=milmemo-22&linkCode=ogi",
          image: {
            url: "https://m.media-amazon.com/images/I/example.jpg",
            width: 500,
            height: 500,
          },
          byLine: "著者 A、著者 B",
        },
      ],
      errors: [{ asin: "B000000001", code: "ItemNotAccessible" }],
    })
    expect(await service.getItems(["B000000001"])).toEqual({
      items: [],
      errors: [{ asin: "B000000001", code: "ItemNotAccessible" }],
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(cache.writes.map(({ expirationTtl }) => expirationTtl).sort()).toEqual([
      3_300, 3_600, 86_400,
    ])
  })

  test("fresh token cache を再利用し、Creators API の response 順には依存しない", async () => {
    const cache = new MemoryCache()
    cache.values.set(
      await AmazonService.createTokenCacheKey(config),
      JSON.stringify({
        version: 1,
        accessToken: "cached-token",
        expiresAt: "2026-08-24T00:30:00.000Z",
      }),
    )
    const fetcher = vi.fn<Fetcher>(async (_input, init) => {
      expect(init?.headers).toEqual({
        Authorization: "Bearer cached-token",
        "Content-Type": "application/json",
        "x-marketplace": "www.amazon.co.jp",
      })

      return Response.json({
        itemResults: {
          items: [
            {
              asin: "B000000001",
              detailPageURL: "https://www.amazon.co.jp/dp/B000000001?tag=milmemo-22",
              itemInfo: { title: { displayValue: "2 番目" } },
            },
            {
              asin: "B000000000",
              detailPageURL: "https://www.amazon.co.jp/dp/B000000000?tag=milmemo-22",
              itemInfo: { title: { displayValue: "1 番目" } },
            },
          ],
        },
      })
    })
    const service = new AmazonService({ cache, config, fetcher, now: () => now })

    expect(
      (await service.getItems(["B000000000", "B000000001"])).items.map(({ asin }) => asin),
    ).toEqual(["B000000000", "B000000001"])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test("期限切れの商品 cache は外部 API 失敗時にも stale fallback に使わない", async () => {
    const cache = new MemoryCache()
    cache.values.set(
      "amazon-item:v1:www.amazon.co.jp:B000000000",
      JSON.stringify({ version: 1, fetchedAt: "2026-08-22T00:00:00.000Z", item: cachedItem }),
    )
    const fetcher = vi.fn<Fetcher>(async () => new Response(null, { status: 429 }))
    const service = new AmazonService({ cache, config, fetcher, now: () => now })

    expect(await service.getItems(["B000000000"])).toEqual({
      items: [],
      errors: [{ asin: "B000000000", code: "amazon-unavailable" }],
    })
    expect(await service.getItems(["B000000000"])).toEqual({
      items: [],
      errors: [{ asin: "B000000000", code: "amazon-unavailable" }],
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cache.writes.map(({ expirationTtl }) => expirationTtl)).toEqual([300])
  })
})
