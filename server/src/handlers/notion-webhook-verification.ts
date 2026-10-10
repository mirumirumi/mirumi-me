import type { Context } from "hono"

import type { HonoEnv } from "../lib/types"

export const NOTION_WEBHOOK_VERIFICATION_KEY = "notion-webhook-verification:v1"
const VERIFICATION_TOKEN_TTL_SECONDS = 10 * 60

export const storeNotionWebhookVerificationToken = async (cache: KVNamespace, token: string) => {
  await cache.put(NOTION_WEBHOOK_VERIFICATION_KEY, token, {
    expirationTtl: VERIFICATION_TOKEN_TTL_SECONDS,
  })
}

export const getNotionWebhookVerification = async (c: Context<HonoEnv>): Promise<Response> => {
  const cache = c.env.CONTENT_CACHE
  if (!cache) {
    console.error(JSON.stringify({ event: "content_cache_binding_missing" }))

    return c.json({ error: "Webhook verification storage is missing" }, 500)
  }

  const verificationToken = await cache.get(NOTION_WEBHOOK_VERIFICATION_KEY)
  if (!verificationToken) {
    return c.json({ error: "Webhook verification token is not available" }, 404, {
      "Cache-Control": "no-store",
    })
  }
  await cache.delete(NOTION_WEBHOOK_VERIFICATION_KEY)

  return c.json({ verificationToken }, 200, { "Cache-Control": "no-store" })
}
