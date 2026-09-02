import { z } from "zod"

export interface BookmarkCardData {
  kind: "internal" | "external"
  url: string
  title: string
  description: string | null
  imageUrl: string | null
  label: string
}

const bookmarkCardSchema: z.ZodType<BookmarkCardData> = z.strictObject({
  kind: z.enum(["internal", "external"]),
  url: z.url(),
  title: z.string().min(1).max(300),
  description: z.string().max(1_000).nullable(),
  imageUrl: z.url().nullable(),
  label: z.string().max(300),
})

const FRESH_CACHE_MS = 30 * 24 * 60 * 60 * 1_000
const MAX_HTML_BYTES = 1_024 * 1_024
const FETCH_TIMEOUT_MS = 5_000
const MAX_REDIRECTS = 3
const cacheSchema = z.strictObject({
  version: z.literal(1),
  fetchedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  card: z.strictObject({
    kind: z.literal("external"),
    url: z.url(),
    title: z.string().max(300),
    description: z.string().max(1_000).nullable(),
    imageUrl: z.url().nullable(),
    label: z.string().max(300),
  }),
})

export const parseBookmarkCardData = (value: unknown): BookmarkCardData => {
  return bookmarkCardSchema.parse(value)
}

export interface BookmarkCache {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>
}

type FetchBookmarkCard = (url: URL) => Promise<BookmarkCardData>

const isPrivateIpv4 = (hostname: string): boolean => {
  const parts = hostname.split(".").map(Number)
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || 255 < part)
  ) {
    return false
  }
  const [first, second] = parts as [number, number, number, number]

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && 63 < second && second < 128) ||
    (first === 169 && second === 254) ||
    (first === 172 && 15 < second && second < 32) ||
    (first === 192 && second === 168) ||
    224 <= first
  )
}

export const validateBookmarkUrl = (value: string): URL => {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw Error("Bookmark URL の scheme が不正です")
  }
  if (url.username || url.password) {
    throw Error("Bookmark URL に認証情報は指定できません")
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw Error("Bookmark URL の port が不正です")
  }
  // 末尾ドット付きの FQDN でも denylist の完全一致が外れないように落とす
  const hostname = url.hostname
    .replace(/^\[|]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase()
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal" ||
    hostname.includes(":") ||
    isPrivateIpv4(hostname)
  ) {
    throw Error("private address の Bookmark URL は取得できません")
  }
  url.hash = ""

  return url
}

const readLimitedHtml = async (response: Response): Promise<string> => {
  if (!response.body) {
    throw Error("Bookmark の response body がありません")
  }
  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    received += value.byteLength
    if (MAX_HTML_BYTES < received) {
      await reader.cancel()
      throw Error("Bookmark HTML が 1 MiB の上限を超えています")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return new TextDecoder().decode(bytes)
}

const htmlAttribute = (tag: string, name: string): string | null => {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))

  return match?.[2]?.trim() || null
}

const metaContent = (html: string, names: Array<string>): string | null => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = htmlAttribute(tag, "property") ?? htmlAttribute(tag, "name")
    if (key && names.includes(key.toLowerCase())) {
      return htmlAttribute(tag, "content")
    }
  }

  return null
}

const decodeEntities = (value: string): string => {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

export const fetchBookmarkCard = async (initialUrl: URL): Promise<BookmarkCardData> => {
  let url = initialUrl
  for (let redirectCount = 0; redirectCount < MAX_REDIRECTS + 1; redirectCount++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "text/html,application/xhtml+xml" },
    })
    if (299 < response.status && response.status < 400) {
      const location = response.headers.get("Location")
      await response.body?.cancel()
      if (!location || redirectCount === MAX_REDIRECTS) {
        throw Error("Bookmark の redirect が不正です")
      }
      url = validateBookmarkUrl(new URL(location, url).href)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`Bookmark の取得に失敗しました: ${response.status}`)
    }
    const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? ""
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      await response.body?.cancel()
      throw Error("Bookmark URL が HTML ではありません")
    }
    const html = await readLimitedHtml(response)
    const rawTitle =
      metaContent(html, ["og:title", "twitter:title"]) ??
      html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ??
      url.hostname
    const rawDescription = metaContent(html, [
      "og:description",
      "description",
      "twitter:description",
    ])
    const rawImage = metaContent(html, ["og:image", "twitter:image"])
    let imageUrl: string | null = null
    if (rawImage) {
      try {
        imageUrl = validateBookmarkUrl(new URL(decodeEntities(rawImage), url).href).href
      } catch {
        imageUrl = null
      }
    }

    return {
      kind: "external",
      url: url.href,
      title: decodeEntities(rawTitle).slice(0, 300),
      description: rawDescription ? decodeEntities(rawDescription).slice(0, 1_000) : null,
      imageUrl,
      label: url.hostname,
    }
  }

  throw Error("Bookmark を取得できませんでした")
}

const cacheKey = async (url: URL): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url.href))
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")

  return `bookmark:v1:${hash}`
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

export const resolveExternalBookmark = async (
  value: string,
  cache: BookmarkCache,
  fetchCard: FetchBookmarkCard = fetchBookmarkCard,
  now = new Date().toISOString(),
): Promise<BookmarkCardData> => {
  const url = validateBookmarkUrl(value)
  const key = await cacheKey(url)
  let cachedValue: string | null = null
  try {
    cachedValue = await cache.get(key)
  } catch {}
  const cached = parseCached(cachedValue)
  if (cached && Date.parse(now) - Date.parse(cached.fetchedAt) < FRESH_CACHE_MS) {
    return cached.card
  }

  let card: BookmarkCardData
  try {
    card = await fetchCard(url)
  } catch (err) {
    if (cached) {
      return cached.card
    }

    return {
      kind: "external",
      url: url.href,
      title: url.hostname,
      description: null,
      imageUrl: null,
      label: url.hostname,
    }
  }
  try {
    await cache.put(key, JSON.stringify({ version: 1, fetchedAt: now, card }), {
      expirationTtl: 365 * 24 * 60 * 60,
    })
  } catch {}

  return card
}
