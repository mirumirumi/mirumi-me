import { z } from "zod"

// アプリ紹介カードの `[app ios="…"]` を、App Store の URL だけから組み立てるための値。
// iTunes Search API の lookup（認証不要・無料）で引き、KV に cache する。
// 移行した 103 件は name / icon などを焼き込んであるので引かない

// 価格が変わりうるので、ブログカード（30 日）より短く取り直す
const FRESH_CACHE_MS = 7 * 24 * 60 * 60 * 1_000
const CACHE_TTL_SECONDS = 365 * 24 * 60 * 60
const FETCH_TIMEOUT_MS = 5_000
const DEFAULT_COUNTRY = "jp"

export interface AppStoreApp {
  id: string
  name: string
  developer: string
  price: string
  artworkUrl: string
}

export interface AppStoreCache {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>
}

export type LookupAppStoreApp = (id: string, country: string) => Promise<AppStoreApp>

const appStoreAppSchema: z.ZodType<AppStoreApp> = z.strictObject({
  id: z.string().regex(/^\d+$/),
  name: z.string().min(1),
  developer: z.string(),
  price: z.string(),
  artworkUrl: z.url(),
})

const cacheSchema = z.strictObject({
  version: z.literal(1),
  fetchedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  app: appStoreAppSchema,
})

const lookupSchema = z.object({
  resultCount: z.number(),
  results: z.array(
    z.object({
      trackId: z.number(),
      trackName: z.string().min(1),
      artistName: z.string(),
      formattedPrice: z.string().optional(),
      artworkUrl100: z.url().optional(),
      artworkUrl512: z.url().optional(),
    }),
  ),
})

// Container と Worker の橋渡しで受け取った値を確かめる
export const parseAppStoreApp = (value: unknown): AppStoreApp => {
  return appStoreAppSchema.parse(value)
}

// https://apps.apple.com/jp/app/<名前>/id<数字> の形（古い itunes.apple.com も）。国がなければ jp
export const parseAppStoreUrl = (value: string): { id: string; country: string } | null => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.hostname !== "apps.apple.com" && url.hostname !== "itunes.apple.com") {
    return null
  }
  const match = url.pathname.match(/^\/(?:([a-z]{2})\/)?app\/(?:[^/]+\/)?id(\d+)\/?$/)
  if (!match?.[2]) {
    return null
  }

  return { id: match[2], country: match[1] ?? DEFAULT_COUNTRY }
}

export const fetchAppStoreApp: LookupAppStoreApp = async (id, country) => {
  const url = new URL("https://itunes.apple.com/lookup")
  url.searchParams.set("id", id)
  url.searchParams.set("country", country)
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) {
    await response.body?.cancel()
    throw Error(`iTunes の lookup に失敗しました: ${response.status}`)
  }
  const result = lookupSchema.parse(await response.json()).results[0]
  const artworkUrl = result?.artworkUrl512 ?? result?.artworkUrl100
  if (!result || !artworkUrl) {
    throw Error(`App Store にアプリが見つかりません: ${id}`)
  }

  return {
    id,
    name: result.trackName,
    developer: result.artistName,
    price: result.formattedPrice ?? "",
    artworkUrl,
  }
}

const parseCached = (value: string | null) => {
  if (!value) {
    return null
  }
  try {
    return cacheSchema.parse(JSON.parse(value))
  } catch {
    return null
  }
}

interface ResolveAppStoreAppOptions {
  lookup?: LookupAppStoreApp
  now?: string
}

export const resolveAppStoreApp = async (
  value: string,
  cache: AppStoreCache,
  options?: ResolveAppStoreAppOptions,
): Promise<AppStoreApp> => {
  const parsed = parseAppStoreUrl(value)
  if (!parsed) {
    throw Error(`App Store の URL ではありません: ${value}`)
  }
  const now = options?.now ?? new Date().toISOString()
  const key = `app-store:v1:${parsed.country}:${parsed.id}`
  let cachedValue: string | null = null
  try {
    cachedValue = await cache.get(key)
  } catch {}
  const cached = parseCached(cachedValue)
  if (cached && Date.parse(now) - Date.parse(cached.fetchedAt) < FRESH_CACHE_MS) {
    return cached.app
  }

  let app: AppStoreApp
  try {
    app = await (options?.lookup ?? fetchAppStoreApp)(parsed.id, parsed.country)
  } catch (err) {
    // 一時的に引けなくても、前に引いた値があればカードは出せる
    if (cached) {
      return cached.app
    }
    throw err
  }
  try {
    await cache.put(key, JSON.stringify({ version: 1, fetchedAt: now, app }), {
      expirationTtl: CACHE_TTL_SECONDS,
    })
  } catch {}

  return app
}
