import type { Context } from "hono"

import {
  createNotionClient,
  fetchNotionPageRevision,
  InvalidNotionPageRevisionError,
  isNotionObjectNotFound,
  isNotionValidationError,
} from "shared/notion"
import { fetchCommentState } from "shared/notion-comments"
import { normalizeNotionPageId } from "shared/site-routes"

import {
  isBotOnlyEvent,
  normalizeNotionPropertyId,
  parseNotionWebhookBody,
  verifyNotionWebhookSignature,
} from "../lib/notion-webhook"
import { readLimitedText } from "../lib/request-body"
import type { HonoEnv } from "../lib/types"
import { startWebhookCommentRefresh, startWebhookPublish } from "../services/start-publish"
import { storeNotionWebhookVerificationToken } from "./notion-webhook-verification"

const MAX_WEBHOOK_BODY_BYTES = 256 * 1_024
const VERIFICATION_RATE_LIMIT_KEY = "/webhooks/notion:verification"

export type NotionWebhookRateLimiter = Pick<RateLimit, "limit">

const isIgnorableNotionError = (err: unknown): boolean => {
  return (
    isNotionObjectNotFound(err) ||
    isNotionValidationError(err) ||
    err instanceof InvalidNotionPageRevisionError
  )
}

// comments の status / 本文 / 投稿者名 / 親コメント の property ID。env が空なら comments は購読しない扱い
const resolveCommentPropertyIds = (env: CloudflareBindings): Set<string> => {
  const ids = new Set<string>()
  for (const value of [
    env.NOTION_COMMENT_STATE_PROPERTY_ID,
    env.NOTION_COMMENT_CONTENT_PROPERTY_ID,
    env.NOTION_COMMENT_AUTHOR_PROPERTY_ID,
    env.NOTION_COMMENT_PARENT_PROPERTY_ID,
  ]) {
    const normalized = value ? normalizeNotionPropertyId(value) : null
    if (normalized) {
      ids.add(normalized)
    }
  }

  return ids
}

interface CommentRefreshTrigger {
  eventId: string
  pageId: string
  requestedAt: string
  // page.created は承認済みの row だけを対象にし、公開フォーム経由の pending は何もしない
  requireApproved: boolean
}

const handleCommentRefreshTrigger = async (
  c: Context<HonoEnv>,
  trigger: CommentRefreshTrigger,
): Promise<Response> => {
  const notionToken = c.env.NOTION_TOKEN
  const dataSourceId = c.env.NOTION_COMMENTS_DATA_SOURCE_ID
  const statePropertyId = c.env.NOTION_COMMENT_STATE_PROPERTY_ID
  const workflow = c.env.COMMENT_REFRESH_WORKFLOW
  if (!notionToken || !dataSourceId || !statePropertyId || !workflow) {
    return c.json({ status: "ignored" })
  }

  try {
    // env には decode 済みの ID を置く前提だが、encode されていても filter_properties へは decode して渡す
    const comment = await fetchCommentState(
      createNotionClient(notionToken),
      dataSourceId,
      normalizeNotionPropertyId(statePropertyId) ?? statePropertyId,
      trigger.pageId,
    )
    if (!comment || (trigger.requireApproved && comment.state !== "approved")) {
      return c.json({ status: "ignored" })
    }
    const started = await startWebhookCommentRefresh(workflow, {
      eventId: trigger.eventId,
      commentPageId: trigger.pageId,
      requestedAt: trigger.requestedAt,
    })

    return c.json({
      status: started.created ? "accepted" : "duplicate",
      workflowId: started.workflowId,
    })
  } catch (err) {
    if (isIgnorableNotionError(err)) {
      console.warn(
        JSON.stringify({
          event: "notion_webhook_comment_ignored",
          pageId: trigger.pageId,
          error: err instanceof Error ? err.name : "UnknownError",
        }),
      )

      return c.json({ status: "ignored" })
    }

    throw err
  }
}

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
    // 何を捨てたかが分からないと購読設定の問題に気づけないので、型と理由を残す
    console.info(
      JSON.stringify({
        event: "notion_webhook_ignored",
        type: webhook.type,
        reason: webhook.reason?.slice(0, 300) ?? null,
      }),
    )

    return c.json({ status: "ignored" })
  }
  // integration 自身が起こした event（既存コメントの import、公開フォームの create、公開エラー の書き戻し）で
  // comment-refresh を起動しない。import は 3,000 件超の page.created を一気に送るので、1 件ずつ
  // Workflow を作ると Container を数百回起動する storm になる。import 後の反映は full build が担う
  const botOnly = isBotOnlyEvent(webhook.event.authors)
  if (webhook.kind === "page-created") {
    if (botOnly) {
      return c.json({ status: "ignored" })
    }
    const createdPageId = normalizeNotionPageId(webhook.event.entity.id)
    if (!createdPageId) {
      return c.json({ error: "Invalid page ID" }, 400)
    }

    return handleCommentRefreshTrigger(c, {
      eventId: webhook.event.id,
      pageId: createdPageId,
      requestedAt: webhook.event.timestamp,
      requireApproved: true,
    })
  }

  const configuredPropertyId = c.env.NOTION_INTERNAL_STATE_PROPERTY_ID
    ? normalizeNotionPropertyId(c.env.NOTION_INTERNAL_STATE_PROPERTY_ID)
    : null
  if (!configuredPropertyId) {
    console.error(JSON.stringify({ event: "notion_state_property_id_missing" }))

    return c.json({ error: "Webhook configuration is missing" }, 500)
  }

  const updatedPropertyIds = new Set(
    webhook.event.data.updated_properties.flatMap((propertyId) => {
      const normalized = normalizeNotionPropertyId(propertyId)

      return normalized ? [normalized] : []
    }),
  )
  const stateWasUpdated = updatedPropertyIds.has(configuredPropertyId)
  const commentPropertyIds = resolveCommentPropertyIds(c.env)
  const commentWasUpdated =
    !botOnly && [...updatedPropertyIds].some((id) => commentPropertyIds.has(id))
  if (!stateWasUpdated && !commentWasUpdated) {
    console.info(
      JSON.stringify({
        event: "notion_webhook_ignored",
        type: webhook.event.type,
        updatedProperties: [...updatedPropertyIds],
        botOnly,
      }),
    )

    return c.json({ status: "ignored" })
  }

  const pageId = normalizeNotionPageId(webhook.event.entity.id)
  if (!pageId) {
    return c.json({ error: "Invalid page ID" }, 400)
  }
  const commentTrigger: CommentRefreshTrigger = {
    eventId: webhook.event.id,
    pageId,
    requestedAt: webhook.event.timestamp,
    requireApproved: false,
  }
  if (!stateWasUpdated) {
    return handleCommentRefreshTrigger(c, commentTrigger)
  }

  const notionToken = c.env.NOTION_TOKEN
  const postsDataSourceId = c.env.NOTION_POSTS_DATA_SOURCE_ID
  const pagesDataSourceId = c.env.NOTION_PAGES_DATA_SOURCE_ID
  const workflow = c.env.PUBLISH_WORKFLOW
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
    // dev と prd は同じ workspace にあり internal-state のプロパティ ID も同じなので、
    // 別環境のページの更新もここまで届く。自分の data source のページでなければ黙って無視する
    if (isIgnorableNotionError(err)) {
      // property ID はデータソースをまたいで衝突しうるので、posts / pages でなければ comments を疑う
      if (commentWasUpdated) {
        return handleCommentRefreshTrigger(c, commentTrigger)
      }
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
