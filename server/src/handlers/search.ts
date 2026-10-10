import type { Context } from "hono"

import { type PreparedSearchPost, parseSearchQuery, searchPosts } from "shared/search"

import { createPublicApiCorsHeaders } from "../lib/cors"
import type { HonoEnv } from "../lib/types"
import { SearchIndexCache, SignedS3SearchIndexSource } from "../services/search"

const MAX_QUERY_LENGTH = 200
const MAX_PAGE = 1_000

export type SearchPostsLoader = () => Promise<Array<PreparedSearchPost>>
export type SearchRateLimiter = Pick<RateLimit, "limit">

// 索引を isolate のメモリに持ち続けるため、module scope に 1 つだけ置く
let searchIndexCache: SearchIndexCache | null = null

const createLoader = (c: Context<HonoEnv>): SearchPostsLoader | null => {
  const {
    AWS_REGION: region,
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    SITE_BUCKET_NAME: bucket,
  } = c.env
  if (!region || !accessKeyId || !secretAccessKey || !bucket) {
    return null
  }
  searchIndexCache ??= new SearchIndexCache({
    source: new SignedS3SearchIndexSource({
      fetcher: (input, init) => fetch(input, init),
      region,
      bucket,
      credentials: { accessKeyId, secretAccessKey },
    }),
  })
  const cache = searchIndexCache

  return () => cache.posts()
}

const parsePage = (value: string | null): number | null => {
  if (value === null) {
    return 1
  }
  const page = /^\d+$/.test(value) ? Number(value) : Number.NaN

  return 1 <= page && page <= MAX_PAGE ? page : null
}

const rejectOrigin = (c: Context<HonoEnv>): Response => {
  return c.json({ error: "Origin is not allowed" }, 403, {
    "Cache-Control": "no-store",
    Vary: "Origin",
  })
}

export const handleSearch = async (
  c: Context<HonoEnv>,
  loader: SearchPostsLoader | null,
  rateLimiter: SearchRateLimiter | null,
): Promise<Response> => {
  const headers = createPublicApiCorsHeaders(c)
  if (!headers) {
    return rejectOrigin(c)
  }
  const url = new URL(c.req.url)
  const query = url.searchParams.get("q") ?? ""
  const page = parsePage(url.searchParams.get("page"))
  if (!query.trim() || MAX_QUERY_LENGTH < query.length || page === null) {
    return c.json(
      { error: `q must be 1 to ${MAX_QUERY_LENGTH} characters and page must be 1 to ${MAX_PAGE}` },
      400,
      headers,
    )
  }
  if (!loader || !rateLimiter) {
    console.error(JSON.stringify({ event: "search_configuration_missing" }))

    return c.json({ error: "Search configuration is missing" }, 500, headers)
  }
  // 全体で 1 つの key にすると、bot 1 つで全員が検索できなくなるので送信元ごとに数える
  const rateLimit = await rateLimiter.limit({
    key: `search:${c.req.header("CF-Connecting-IP") ?? "unknown"}`,
  })
  if (!rateLimit.success) {
    console.warn(JSON.stringify({ event: "search_rate_limited" }))

    return c.json({ error: "Rate limit exceeded" }, 429, { ...headers, "Retry-After": "60" })
  }

  let posts: Array<PreparedSearchPost>
  try {
    posts = await loader()
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "search_index_unavailable",
        error: err instanceof Error ? err.message : String(err),
      }),
    )

    return c.json({ error: "Search index is unavailable" }, 503, headers)
  }

  return c.json(searchPosts(posts, parseSearchQuery(query), page), 200, headers)
}

export const getSearch = async (c: Context<HonoEnv>): Promise<Response> => {
  return handleSearch(c, createLoader(c), c.env.RATE_LIMITER_60_PER_MINUTE ?? null)
}

export const handleSearchOptions = (c: Context<HonoEnv>): Response => {
  const headers = createPublicApiCorsHeaders(c)
  if (!headers) {
    return rejectOrigin(c)
  }
  headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
  headers["Access-Control-Max-Age"] = "86400"

  return new Response(null, { status: 204, headers })
}
