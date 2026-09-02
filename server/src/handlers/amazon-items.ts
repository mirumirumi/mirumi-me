import type { Context } from "hono"

import type { AmazonItemsResponse } from "shared/amazon"
import { verifyAmazonCardSignature } from "shared/amazon"

import type { HonoEnv } from "../lib/types"
import { AmazonService } from "../services/amazon"

const AMAZON_ITEM_QUERY = /^([A-Z0-9]{10})\.([A-Za-z0-9_-]{43})$/
const AMAZON_ITEMS_RATE_LIMIT_KEY = "/api/amazon/items"

export type AmazonItemsResolver = (asins: Array<string>) => Promise<AmazonItemsResponse>
export type AmazonItemsRateLimiter = Pick<RateLimit, "limit">

interface ParsedAmazonItem {
  asin: string
  signature: string
}

const isDevLoopbackOrigin = (origin: string, appEnv: string | undefined): boolean => {
  if (appEnv !== "dev") {
    return false
  }

  try {
    const url = new URL(origin)
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"])

    return (
      (url.protocol === "http:" || url.protocol === "https:") && loopbackHosts.has(url.hostname)
    )
  } catch {
    return false
  }
}

const createCorsHeaders = (c: Context<HonoEnv>): Record<string, string> | null => {
  const origin = c.req.raw.headers.get("Origin") ?? undefined
  const allowedOrigins = new Set<string>(
    [c.env.FRONTEND_ORIGIN, c.env.WORKERS_API_ORIGIN].filter((value) => value !== undefined),
  )
  if (origin && !allowedOrigins.has(origin) && !isDevLoopbackOrigin(origin, c.env.APP_ENV)) {
    return null
  }

  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    Vary: "Origin",
  }
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin
  }

  return headers
}

const parseItems = (url: string): Array<ParsedAmazonItem> | null => {
  const values = new URL(url).searchParams.getAll("item")
  if (values.length === 0 || 10 < values.length) {
    return null
  }

  const items: Array<ParsedAmazonItem> = []
  for (const value of values) {
    const match = value.match(AMAZON_ITEM_QUERY)
    if (!match?.[1] || !match[2]) {
      return null
    }
    items.push({ asin: match[1], signature: match[2] })
  }
  if (new Set(items.map(({ asin }) => asin)).size !== items.length) {
    return null
  }

  return items
}

const createResolver = (c: Context<HonoEnv>): AmazonItemsResolver | null => {
  const {
    AMAZON_CREATORS_CREDENTIAL_ID: credentialId,
    AMAZON_CREATORS_CREDENTIAL_SECRET: credentialSecret,
    AMAZON_CREATORS_CREDENTIAL_VERSION: credentialVersion,
    AMAZON_CREATORS_MARKETPLACE: marketplace,
    AMAZON_ASSOCIATE_TAG: partnerTag,
    CONTENT_CACHE: cache,
  } = c.env
  if (
    !credentialId ||
    !credentialSecret ||
    !credentialVersion ||
    !marketplace ||
    !partnerTag ||
    !cache
  ) {
    return null
  }

  const service = new AmazonService({
    cache,
    config: {
      credentialId,
      credentialSecret,
      credentialVersion,
      marketplace,
      partnerTag,
    },
    fetcher: (input, init) => fetch(input, init),
    now: () => Date.now(),
  })

  return (asins) => service.getItems(asins)
}

export const handleAmazonItems = async (
  c: Context<HonoEnv>,
  resolver: AmazonItemsResolver | null,
  rateLimiter: AmazonItemsRateLimiter | null,
): Promise<Response> => {
  const headers = createCorsHeaders(c)
  if (!headers) {
    return c.json({ error: "Origin is not allowed" }, 403, {
      "Cache-Control": "no-store",
      Vary: "Origin",
    })
  }

  const items = parseItems(c.req.url)
  if (!items) {
    return c.json({ error: "item must contain 1 to 10 unique signed ASINs" }, 400, headers)
  }
  const secret = c.env.AMAZON_CARD_SIGNING_SECRET
  if (!secret) {
    console.error(JSON.stringify({ event: "amazon_signing_secret_missing" }))

    return c.json({ error: "Amazon configuration is missing" }, 500, headers)
  }

  const verified = await Promise.all(
    items.map(({ asin, signature }) => verifyAmazonCardSignature(asin, signature, secret)),
  )
  if (verified.some((valid) => !valid)) {
    return c.json({ error: "Invalid item signature" }, 401, headers)
  }
  if (!resolver || !rateLimiter) {
    console.error(JSON.stringify({ event: "amazon_configuration_missing" }))

    return c.json({ error: "Amazon configuration is missing" }, 500, headers)
  }
  const rateLimit = await rateLimiter.limit({ key: AMAZON_ITEMS_RATE_LIMIT_KEY })
  if (!rateLimit.success) {
    console.warn(JSON.stringify({ event: "amazon_items_rate_limited" }))

    return c.json({ error: "Rate limit exceeded" }, 429, {
      ...headers,
      "Retry-After": "60",
    })
  }

  return c.json(await resolver(items.map(({ asin }) => asin)), 200, headers)
}

export const getAmazonItems = async (c: Context<HonoEnv>): Promise<Response> => {
  return handleAmazonItems(c, createResolver(c), c.env.RATE_LIMITER_60_PER_MINUTE ?? null)
}

export const handleAmazonItemsOptions = (c: Context<HonoEnv>): Response => {
  const headers = createCorsHeaders(c)
  if (!headers) {
    return c.json({ error: "Origin is not allowed" }, 403, {
      "Cache-Control": "no-store",
      Vary: "Origin",
    })
  }
  headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
  headers["Access-Control-Max-Age"] = "86400"

  return new Response(null, { status: 204, headers })
}
