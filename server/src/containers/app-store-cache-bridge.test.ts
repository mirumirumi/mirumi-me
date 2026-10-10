import { describe, expect, test, vi } from "vitest"

import { APP_STORE_CACHE_BRIDGE_URL, handleAppStoreCacheBridge } from "./app-store-cache-bridge"

describe("handleAppStoreCacheBridge", () => {
  const createCache = (values: Record<string, string> = {}) => {
    return {
      get: vi.fn(async (key: string) => values[key] ?? null),
      put: vi.fn(
        async (_key: string, _value: string, _options?: { expirationTtl: number }) => undefined,
      ),
    }
  }

  const getUrl = (key: string): string => {
    const url = new URL(APP_STORE_CACHE_BRIDGE_URL)
    url.searchParams.set("key", key)

    return url.href
  }

  test("GET は App Store の cache の値を返し、無ければ null を返す", async () => {
    const cache = createCache({ "app-store:v1:jp:42": "cached" })

    expect(
      await (
        await handleAppStoreCacheBridge(new Request(getUrl("app-store:v1:jp:42")), cache)
      ).json(),
    ).toEqual({ value: "cached" })
    expect(
      await (
        await handleAppStoreCacheBridge(new Request(getUrl("app-store:v1:jp:1")), cache)
      ).json(),
    ).toEqual({ value: null })
  })

  test("PUT は有効期限つきで KV に書き、204 を返す", async () => {
    const cache = createCache()
    const response = await handleAppStoreCacheBridge(
      new Request(APP_STORE_CACHE_BRIDGE_URL, {
        method: "PUT",
        body: JSON.stringify({ key: "app-store:v1:jp:42", value: "app", expirationTtl: 3_600 }),
      }),
      cache,
    )

    expect(response.status).toEqual(204)
    expect(cache.put).toHaveBeenCalledWith("app-store:v1:jp:42", "app", { expirationTtl: 3_600 })
  })

  test("App Store の cache 以外の key と、GET / PUT 以外は断る", async () => {
    const cache = createCache({ "x-post:v4:1": "post" })

    expect(
      (await handleAppStoreCacheBridge(new Request(getUrl("x-post:v4:1")), cache)).status,
    ).toEqual(400)
    expect(
      (
        await handleAppStoreCacheBridge(
          new Request(APP_STORE_CACHE_BRIDGE_URL, {
            method: "PUT",
            body: JSON.stringify({ key: "bookmark:v1:a", value: "card", expirationTtl: 3_600 }),
          }),
          cache,
        )
      ).status,
    ).toEqual(400)
    expect(
      (
        await handleAppStoreCacheBridge(
          new Request(APP_STORE_CACHE_BRIDGE_URL, { method: "DELETE" }),
          cache,
        )
      ).status,
    ).toEqual(405)
    expect(cache.get).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })
})
