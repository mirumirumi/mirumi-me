import type { Context } from "hono"
import { z } from "zod"

import {
  isCommentPublicId,
  MAX_COMMENT_AUTHOR_NAME_LENGTH,
  MAX_COMMENT_CONTENT_LENGTH,
  MAX_COMMENT_EMAIL_LENGTH,
  normalizeCommentContent,
  type ParsedCommentPublicId,
  parseCommentPublicId,
} from "shared/comments"
import { createNotionClient } from "shared/notion"
import {
  type CommentDataSourceSchema,
  createApprovedCommentByPublicIdFilter,
  createPublicCommentParameters,
  createRequestIdFilter,
  fetchCommentRecords,
  type PublicCommentInput,
  resolveCommentDataSourceSchema,
} from "shared/notion-comments"
import { isValidSlug } from "shared/site-routes"

import { readLimitedText } from "../lib/request-body"
import type { HonoEnv } from "../lib/types"
import { DeploymentIndexRepository } from "../repositories/deployment-index"
import { PublishedSlugResolver, SignedS3DeploymentIndexStore } from "../services/published-slugs"
import {
  createTurnstileIdempotencyKey,
  isTurnstileVerificationAccepted,
  type TurnstileVerification,
  verifyTurnstileToken,
} from "../services/turnstile"

const MAX_COMMENT_BODY_BYTES = 64 * 1_024
// comments の schema は property ID を引くためだけに読む。isolate ごとにしばらく持ち回して Notion を叩く回数を減らす
const SCHEMA_CACHE_TTL_MS = 10 * 60 * 1_000
// Turnstile widget 側の data-action と一致させる
export const COMMENT_TURNSTILE_ACTION = "comment"

export type CommentsRateLimiter = Pick<RateLimit, "limit">

export interface CommentSubmissionDependencies {
  isPublishedPostSlug(slug: string): Promise<boolean>
  // 同じ request-id の row があればその page ID。不明時の再試行を重複投稿にしない
  findCommentPageIdByRequestId(requestId: string): Promise<string | null>
  findApprovedParentPageId(slug: string, publicId: ParsedCommentPublicId): Promise<string | null>
  verifyTurnstile(
    token: string,
    remoteIp: string | null,
    idempotencyKey: string,
  ): Promise<TurnstileVerification>
  createComment(input: PublicCommentInput): Promise<void>
  now(): Date
}

const submissionSchema = z.strictObject({
  slug: z.string().refine(isValidSlug),
  parentId: z.string().refine(isCommentPublicId).nullable(),
  authorName: z.string().max(MAX_COMMENT_AUTHOR_NAME_LENGTH),
  authorEmail: z.union([z.literal(""), z.email().max(MAX_COMMENT_EMAIL_LENGTH)]),
  content: z
    .string()
    .transform(normalizeCommentContent)
    .refine((value) => 0 < value.trim().length && value.length <= MAX_COMMENT_CONTENT_LENGTH),
  requestId: z.uuid(),
  turnstileToken: z.string().min(1).max(4_096),
})

const createCorsHeaders = (c: Context<HonoEnv>): Record<string, string> | null => {
  const origin = c.req.raw.headers.get("Origin")
  // Origin は認証ではないが、公開フォームの送信元は FRONTEND_ORIGIN しかないので他は受けない
  if (!origin || !c.env.FRONTEND_ORIGIN || origin !== c.env.FRONTEND_ORIGIN) {
    return null
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": "no-store",
    Vary: "Origin",
  }
}

const rejectOrigin = (c: Context<HonoEnv>): Response => {
  return c.json({ error: "origin" }, 403, { "Cache-Control": "no-store", Vary: "Origin" })
}

const logEvent = (event: string, fields: Record<string, string | null>) => {
  console.info(JSON.stringify({ event, ...fields }))
}

export const handleCommentSubmission = async (
  c: Context<HonoEnv>,
  dependencies: CommentSubmissionDependencies | null,
  rateLimiter: CommentsRateLimiter | null,
): Promise<Response> => {
  const headers = createCorsHeaders(c)
  if (!headers) {
    return rejectOrigin(c)
  }
  const rawBody = await readLimitedText(c.req.raw, MAX_COMMENT_BODY_BYTES)
  if (rawBody === null) {
    return c.json({ error: "invalid-request" }, 413, headers)
  }
  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(rawBody)
  } catch {
    return c.json({ error: "invalid-request" }, 400, headers)
  }
  const submission = submissionSchema.safeParse(parsedBody)
  if (!submission.success) {
    return c.json({ error: "invalid-request" }, 400, headers)
  }
  if (!dependencies || !rateLimiter) {
    console.error(JSON.stringify({ event: "comments_configuration_missing" }))

    return c.json({ error: "configuration" }, 500, headers)
  }

  const remoteIp = c.req.header("CF-Connecting-IP") ?? null
  const rateLimit = await rateLimiter.limit({ key: remoteIp ?? "unknown" })
  if (!rateLimit.success) {
    console.warn(JSON.stringify({ event: "comments_rate_limited" }))

    return c.json({ error: "rate-limited" }, 429, { ...headers, "Retry-After": "60" })
  }

  const { slug, parentId, requestId } = submission.data
  if (!(await dependencies.isPublishedPostSlug(slug))) {
    return c.json({ error: "unknown-article" }, 404, headers)
  }
  if (await dependencies.findCommentPageIdByRequestId(requestId)) {
    logEvent("comment_submission_duplicate", { slug, requestId })

    return c.json({ status: "accepted" }, 202, headers)
  }
  // Turnstile を解いていない request で Notion を叩く回数を増やさないよう、親の確認は検証のあとに回す
  const expectedHostname = c.env.FRONTEND_ORIGIN ? new URL(c.env.FRONTEND_ORIGIN).hostname : null
  const verification = await dependencies.verifyTurnstile(
    submission.data.turnstileToken,
    remoteIp,
    await createTurnstileIdempotencyKey(requestId, submission.data.turnstileToken),
  )
  if (
    !expectedHostname ||
    !isTurnstileVerificationAccepted(verification, {
      hostnames: new Set([expectedHostname]),
      action: COMMENT_TURNSTILE_ACTION,
    })
  ) {
    logEvent("comment_submission_turnstile_rejected", {
      slug,
      requestId,
      errorCodes: verification.errorCodes.join(",") || null,
    })

    return c.json({ error: "turnstile" }, 403, headers)
  }
  let parentPageId: string | null = null
  if (parentId !== null) {
    parentPageId = await dependencies.findApprovedParentPageId(
      slug,
      parseCommentPublicId(parentId)!,
    )
    if (!parentPageId) {
      return c.json({ error: "unknown-parent" }, 404, headers)
    }
  }

  await dependencies.createComment({
    slug,
    parentPageId,
    authorName: submission.data.authorName.replaceAll(/[\r\n\t]+/g, " ").trim(),
    authorEmail: submission.data.authorEmail || null,
    content: submission.data.content,
    requestId,
    createdAt: dependencies.now().toISOString(),
  })
  logEvent("comment_submission_accepted", { slug, requestId })

  return c.json({ status: "accepted" }, 202, headers)
}

interface CachedCommentSchema {
  dataSourceId: string
  schema: Promise<CommentDataSourceSchema>
  expiresAt: number
}

let cachedSchema: CachedCommentSchema | null = null

const resolveCachedCommentSchema = (
  notion: ReturnType<typeof createNotionClient>,
  dataSourceId: string,
): Promise<CommentDataSourceSchema> => {
  const now = Date.now()
  if (cachedSchema && cachedSchema.dataSourceId === dataSourceId && now < cachedSchema.expiresAt) {
    return cachedSchema.schema
  }
  const schema = resolveCommentDataSourceSchema(notion, dataSourceId)
  const entry: CachedCommentSchema = {
    dataSourceId,
    schema,
    expiresAt: now + SCHEMA_CACHE_TTL_MS,
  }
  cachedSchema = entry
  // 失敗した取得を持ち回さない
  schema.catch(() => {
    if (cachedSchema === entry) {
      cachedSchema = null
    }
  })

  return schema
}

const createDependencies = (c: Context<HonoEnv>): CommentSubmissionDependencies | null => {
  const {
    NOTION_TOKEN: notionToken,
    NOTION_COMMENTS_DATA_SOURCE_ID: dataSourceId,
    TURNSTILE_SECRET: turnstileSecret,
    AWS_REGION: awsRegion,
    AWS_ACCESS_KEY_ID: awsAccessKeyId,
    AWS_SECRET_ACCESS_KEY: awsSecretAccessKey,
    SITE_BUCKET_NAME: siteBucketName,
  } = c.env
  if (
    !notionToken ||
    !dataSourceId ||
    !turnstileSecret ||
    !awsRegion ||
    !awsAccessKeyId ||
    !awsSecretAccessKey ||
    !siteBucketName
  ) {
    return null
  }
  const fetcher = (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    return fetch(input, init)
  }
  const notion = createNotionClient(notionToken)
  const schema = (): Promise<CommentDataSourceSchema> => {
    return resolveCachedCommentSchema(notion, dataSourceId)
  }
  const slugs = new PublishedSlugResolver({
    repository: new DeploymentIndexRepository(
      new SignedS3DeploymentIndexStore({
        fetcher,
        region: awsRegion,
        bucket: siteBucketName,
        credentials: { accessKeyId: awsAccessKeyId, secretAccessKey: awsSecretAccessKey },
      }),
    ),
    cache: c.env.CONTENT_CACHE ?? null,
  })

  return {
    isPublishedPostSlug: (slug) => slugs.isPublishedPostSlug(slug),
    findCommentPageIdByRequestId: async (requestId) => {
      const records = await fetchCommentRecords(
        notion,
        await schema(),
        createRequestIdFilter(requestId),
      )

      return records[0]?.pageId ?? null
    },
    findApprovedParentPageId: async (slug, publicId) => {
      const records = await fetchCommentRecords(
        notion,
        await schema(),
        createApprovedCommentByPublicIdFilter(slug, publicId),
      )

      return records[0]?.pageId ?? null
    },
    verifyTurnstile: (token, remoteIp, idempotencyKey) => {
      return verifyTurnstileToken({
        fetcher,
        secret: turnstileSecret,
        token,
        remoteIp,
        idempotencyKey,
      })
    },
    createComment: async (input) => {
      await notion.pages.create(createPublicCommentParameters((await schema()).dataSourceId, input))
    },
    now: () => new Date(),
  }
}

export const postComment = async (c: Context<HonoEnv>): Promise<Response> => {
  return handleCommentSubmission(c, createDependencies(c), c.env.RATE_LIMITER_COMMENTS ?? null)
}

export const handleCommentsOptions = (c: Context<HonoEnv>): Response => {
  const headers = createCorsHeaders(c)
  if (!headers) {
    return rejectOrigin(c)
  }
  headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
  headers["Access-Control-Allow-Headers"] = "Content-Type"
  headers["Access-Control-Max-Age"] = "86400"

  return new Response(null, { status: 204, headers })
}
