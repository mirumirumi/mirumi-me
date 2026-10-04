import { z } from "zod"

// Container が App Store の cache（Worker の KV `CONTENT_CACHE`）を読み書きするための橋渡し。
// iTunes を引くのは Container 側で、Worker は KV の読み書きだけを受け持つ（Worker から引くと Apple が 403 で断るため）
export const APP_STORE_CACHE_BRIDGE_URL = "http://bindings.internal/app-store-cache"

// 橋渡しで触れるのは App Store の cache だけにする
const KEY_PATTERN = /^app-store:v1:[a-z]{2}:\d+$/

const putSchema = z.strictObject({
  key: z.string().regex(KEY_PATTERN),
  value: z.string().max(100_000),
  expirationTtl: z.number().int().min(60),
})

export interface AppStoreCacheStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>
}

export const handleAppStoreCacheBridge = async (
  request: Request,
  cache: AppStoreCacheStore,
): Promise<Response> => {
  if (request.method === "GET") {
    const key = new URL(request.url).searchParams.get("key")
    if (!key || !KEY_PATTERN.test(key)) {
      return Response.json({ error: "Invalid App Store cache key" }, { status: 400 })
    }

    return Response.json({ value: await cache.get(key) })
  }
  if (request.method === "PUT") {
    const parsed = putSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return Response.json({ error: "Invalid App Store cache entry" }, { status: 400 })
    }
    await cache.put(parsed.data.key, parsed.data.value, {
      expirationTtl: parsed.data.expirationTtl,
    })

    return new Response(null, { status: 204 })
  }

  return new Response("Method Not Allowed", { status: 405 })
}
