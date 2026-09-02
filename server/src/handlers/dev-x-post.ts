import type { Context } from "hono"
import { z } from "zod"

import type { StaticXPostData } from "shared/x-post"
import { resolveXPost } from "shared/x-post"

import { readLimitedText } from "../lib/request-body"
import type { HonoEnv } from "../lib/types"
import { createXaiPostFetcher } from "../services/x-post"

const MAX_BODY_BYTES = 256
const RATE_LIMIT_KEY = "/_dev/x-post"
const requestSchema = z.strictObject({
  postId: z.string().regex(/^\d{5,30}$/),
})

export type DevXPostResolver = (postId: string) => Promise<StaticXPostData>
export type DevXPostRateLimiter = Pick<RateLimit, "limit">

const createResolver = (c: Context<HonoEnv>): DevXPostResolver | null => {
  const cache = c.env.CONTENT_CACHE
  if (!cache || !c.env.XAI_API_KEY || !c.env.XAI_MODEL) {
    return null
  }
  const fetchPost = createXaiPostFetcher(c.env.XAI_API_KEY, c.env.XAI_MODEL)

  return (postId) => resolveXPost(postId, cache, fetchPost)
}

export const handleDevXPost = async (
  c: Context<HonoEnv>,
  resolver: DevXPostResolver | null,
  rateLimiter: DevXPostRateLimiter | null,
): Promise<Response> => {
  if (c.env.APP_ENV !== "dev") {
    return c.notFound()
  }
  const rawBody = await readLimitedText(c.req.raw, MAX_BODY_BYTES)
  if (rawBody === null) {
    return c.json({ error: "Request body is too large" }, 413)
  }
  let raw: unknown
  try {
    raw = JSON.parse(rawBody)
  } catch {
    return c.json({ error: "Invalid request" }, 400)
  }
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: "Invalid request" }, 400)
  }
  if (!resolver || !rateLimiter) {
    console.error(JSON.stringify({ event: "dev_x_post_configuration_missing" }))

    return c.json({ error: "X post configuration is missing" }, 500)
  }
  const rateLimit = await rateLimiter.limit({ key: RATE_LIMIT_KEY })
  if (!rateLimit.success) {
    console.warn(JSON.stringify({ event: "dev_x_post_rate_limited" }))

    return c.json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "60" })
  }

  return c.json(await resolver(parsed.data.postId), 200, { "Cache-Control": "private, no-store" })
}

export const postDevXPost = async (c: Context<HonoEnv>): Promise<Response> => {
  return handleDevXPost(c, createResolver(c), c.env.RATE_LIMITER_60_PER_MINUTE ?? null)
}
