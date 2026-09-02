import type { Context } from "hono"

import {
  createNotionClient,
  fetchNotionPageRevision,
  isNotionObjectNotFound,
  isNotionValidationError,
} from "shared/notion"
import { normalizeNotionPageId } from "shared/site-routes"

import {
  normalizeNotionPropertyId,
  parseNotionWebhookBody,
  verifyNotionWebhookSignature,
} from "../lib/notion-webhook"
import { readLimitedText } from "../lib/request-body"
import type { HonoEnv } from "../lib/types"
import { startWebhookPublish } from "../services/start-publish"
import { storeNotionWebhookVerificationToken } from "./notion-webhook-verification"

const MAX_WEBHOOK_BODY_BYTES = 256 * 1_024
const VERIFICATION_RATE_LIMIT_KEY = "/webhooks/notion:verification"

export type NotionWebhookRateLimiter = Pick<RateLimit, "limit">

export const handleNotionWebhook = async (
  c: Context<HonoEnv>,
  rateLimiter: NotionWebhookRateLimiter | null,
): Promise<Response> => {
  const rawBody = await readLimitedText(c.req.raw, MAX_WEBHOOK_BODY_BYTES)
  if (rawBody === null) {
    return c.json({ error: "Webhook body is too large" }, 413)
  }

  let webhook: ReturnType<typeof parseNotionWebhookBody>
  try {
    webhook = parseNotionWebhookBody(rawBody)
  } catch {
    return c.json({ error: "Invalid webhook body" }, 400)
  }

  if (webhook.kind === "verification") {
    if (!c.env.CONTENT_CACHE) {
      console.error(JSON.stringify({ event: "content_cache_binding_missing" }))

      return c.json({ error: "Webhook verification storage is missing" }, 500)
    }
    if (!rateLimiter) {
      console.error(JSON.stringify({ event: "rate_limiter_binding_missing" }))

      return c.json({ error: "Webhook configuration is missing" }, 500)
    }
    // 署名検証を通らずに KV へ書ける唯一の経路なので、ここだけ回数を絞る。
    // 署名済み event 側は絞らない（攻撃者の連打で正規の配信が 429 になるのを避けるため）
    const rateLimit = await rateLimiter.limit({ key: VERIFICATION_RATE_LIMIT_KEY })
    if (!rateLimit.success) {
      console.warn(JSON.stringify({ event: "notion_webhook_verification_rate_limited" }))

      return c.json({ error: "Rate limit exceeded" }, 429, { "Retry-After": "60" })
    }
    await storeNotionWebhookVerificationToken(c.env.CONTENT_CACHE, webhook.verificationToken)
    console.info(JSON.stringify({ event: "notion_webhook_verification_received" }))

    return c.json({ status: "verification-received" })
  }

  const webhookSecret = c.env.NOTION_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error(JSON.stringify({ event: "notion_webhook_secret_missing" }))

    return c.json({ error: "Webhook configuration is missing" }, 500)
  }

  const signature = c.req.header("X-Notion-Signature")
  if (!signature || !(await verifyNotionWebhookSignature(rawBody, signature, webhookSecret))) {
    return c.json({ error: "Invalid webhook signature" }, 401)
  }

  if (webhook.kind === "ignored") {
    return c.json({ status: "ignored" })
  }

  const configuredPropertyId = c.env.NOTION_INTERNAL_STATE_PROPERTY_ID
    ? normalizeNotionPropertyId(c.env.NOTION_INTERNAL_STATE_PROPERTY_ID)
    : null
  if (!configuredPropertyId) {
    console.error(JSON.stringify({ event: "notion_state_property_id_missing" }))

    return c.json({ error: "Webhook configuration is missing" }, 500)
  }

  const stateWasUpdated = webhook.event.data.updated_properties.some((propertyId) => {
    return normalizeNotionPropertyId(propertyId) === configuredPropertyId
  })
  if (!stateWasUpdated) {
    return c.json({ status: "ignored" })
  }

  const pageId = normalizeNotionPageId(webhook.event.entity.id)
  const notionToken = c.env.NOTION_TOKEN
  const postsDataSourceId = c.env.NOTION_POSTS_DATA_SOURCE_ID
  const pagesDataSourceId = c.env.NOTION_PAGES_DATA_SOURCE_ID
  const workflow = c.env.PUBLISH_WORKFLOW
  if (!pageId) {
    return c.json({ error: "Invalid page ID" }, 400)
  }
  if (!notionToken || !postsDataSourceId || !pagesDataSourceId || !workflow) {
    console.error(JSON.stringify({ event: "publish_binding_missing" }))

    return c.json({ error: "Publish configuration is missing" }, 500)
  }

  try {
    const notion = createNotionClient(notionToken)
    const revision = await fetchNotionPageRevision(notion, pageId, {
      posts: postsDataSourceId,
      pages: pagesDataSourceId,
    })
    if (revision.internalState !== "公開待ち" && revision.internalState !== "非公開待ち") {
      return c.json({ status: "ignored" })
    }

    const started = await startWebhookPublish(workflow, {
      eventId: webhook.event.id,
      pageId,
      requestedAt: webhook.event.timestamp,
    })

    return c.json({
      status: started.created ? "accepted" : "duplicate",
      workflowId: started.workflowId,
    })
  } catch (err) {
    if (isNotionObjectNotFound(err) || isNotionValidationError(err)) {
      console.warn(
        JSON.stringify({
          event: "notion_webhook_page_ignored",
          pageId,
          error: err instanceof Error ? err.name : "UnknownError",
        }),
      )

      return c.json({ status: "ignored" })
    }

    throw err
  }
}

export const postNotionWebhook = async (c: Context<HonoEnv>): Promise<Response> => {
  return handleNotionWebhook(c, c.env.RATE_LIMITER_60_PER_MINUTE ?? null)
}
