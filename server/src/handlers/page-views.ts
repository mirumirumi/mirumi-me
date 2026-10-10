import type { Context } from "hono"

import { normalizePageViewPath } from "shared/page-views"

import { createPublicApiCorsHeaders } from "../lib/cors"
import type { HonoEnv } from "../lib/types"
import { DeploymentIndexRepository } from "../repositories/deployment-index"
import { PublishedRouteResolver, SignedS3DeploymentIndexStore } from "../services/published-slugs"

// publish index に載らないが PV を数えるページ（WordPress 時代もこの 2 つは固定の ID で数えていた）
const ALWAYS_COUNTED_PATHS = new Set(["/", "/entry-list/"])
const MAX_BODY_LENGTH = 300

export interface PageViewRecorder {
  isPublishedRoute(route: string): Promise<boolean>
  write(path: string): void
}

export type PageViewRateLimiter = Pick<RateLimit, "limit">

const createRecorder = (c: Context<HonoEnv>): PageViewRecorder | null => {
  const {
    AWS_REGION: region,
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    SITE_BUCKET_NAME: bucket,
    MIRUMI_ME_PV: dataset,
  } = c.env
  if (!region || !accessKeyId || !secretAccessKey || !bucket || !dataset) {
    return null
  }
  const routes = new PublishedRouteResolver({
    repository: new DeploymentIndexRepository(
      new SignedS3DeploymentIndexStore({
        fetcher: (input, init) => fetch(input, init),
        region,
        bucket,
        credentials: { accessKeyId, secretAccessKey },
      }),
    ),
    cache: c.env.CONTENT_CACHE ?? null,
  })

  return {
    isPublishedRoute: (route) => routes.isPublishedRoute(route),
    // 1 PV を 1 点として書く。site-admin-extension は SUM(_sample_interval) で数える
    write: (path) => dataset.writeDataPoint({ indexes: [path], doubles: [1] }),
  }
}

const rejectOrigin = (c: Context<HonoEnv>): Response => {
  return c.json({ error: "Origin is not allowed" }, 403, {
    "Cache-Control": "no-store",
    Vary: "Origin",
  })
}

// フロントは keepalive つきの fetch で text/plain の本文にパスだけを送る。応答は読まないので、数えなくても 204 を返す
export const handlePageView = async (
  c: Context<HonoEnv>,
  recorder: PageViewRecorder | null,
  rateLimiter: PageViewRateLimiter | null,
): Promise<Response> => {
  const headers = createPublicApiCorsHeaders(c)
  if (!headers) {
    return rejectOrigin(c)
  }
  const body = await c.req.text()
  const path = body.length <= MAX_BODY_LENGTH ? normalizePageViewPath(body.trim()) : null
  if (!path) {
    return c.json({ error: "body must be a page path" }, 400, headers)
  }
  if (!recorder || !rateLimiter) {
    console.error(JSON.stringify({ event: "page_view_configuration_missing" }))

    return c.json({ error: "Page view configuration is missing" }, 500, headers)
  }
  const rateLimit = await rateLimiter.limit({
    key: `pv:${c.req.header("CF-Connecting-IP") ?? "unknown"}`,
  })
  if (!rateLimit.success) {
    console.warn(JSON.stringify({ event: "page_view_rate_limited" }))

    return c.json({ error: "Rate limit exceeded" }, 429, { ...headers, "Retry-After": "60" })
  }

  let counted: boolean
  try {
    counted = ALWAYS_COUNTED_PATHS.has(path) || (await recorder.isPublishedRoute(path))
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "page_view_routes_unavailable",
        error: err instanceof Error ? err.message : String(err),
      }),
    )

    return c.json({ error: "Published routes are unavailable" }, 503, headers)
  }
  if (counted) {
    recorder.write(path)
  }

  return new Response(null, { status: 204, headers })
}

export const postPageView = async (c: Context<HonoEnv>): Promise<Response> => {
  return handlePageView(c, createRecorder(c), c.env.RATE_LIMITER_60_PER_MINUTE ?? null)
}
