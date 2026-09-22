import { createHash } from "node:crypto"
import { z } from "zod"

import { isValidSlug } from "shared/site-routes"

import type { CommentRefreshJobRequest } from "../lib/comment-refresh"
import type { PublishJobRequest } from "../lib/publishing"
import { PUBLISH_VALIDATION_CODES } from "../lib/publishing"
import { CloudFrontInvalidator } from "./aws"
import { runContainerCommentRefreshJob } from "./comment-refresh-job"
import { readContainerConfig } from "./config"
import { loadDeploymentPageStates } from "./deployment-state"
import { runContainerPublishJob } from "./publish-job"

const MAX_REQUEST_BYTES = 2 * 1_024 * 1_024
// admin の部分公開は 100 件までだが、full build は現行 473 page をまとめて受け取る
const MAX_PUBLISH_JOB_PAGES = 1_000
const dateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
const categorySchema = z.strictObject({ name: z.string().min(1), slug: z.string().min(1) })
const revisionSchema = z.strictObject({
  pageId: z.guid(),
  kind: z.enum(["post", "page"]),
  title: z.string(),
  slug: z.string(),
  internalState: z.enum(["下書き", "公開待ち", "公開中", "非公開待ち", "非公開"]).nullable(),
  lastEditedTime: dateSchema,
  lastDeploy: dateSchema.nullable(),
  lastNotionEdit: dateSchema.nullable(),
  publishedAt: dateSchema.nullable(),
  updatedAt: dateSchema.nullable(),
  category: categorySchema.nullable(),
})
const publishRequestSchema: z.ZodType<PublishJobRequest> = z.strictObject({
  workflowId: z.string().min(1).max(200),
  params: z.strictObject({
    mode: z.enum(["partial", "full", "bootstrap"]),
    source: z.enum(["notion-webhook", "admin", "release"]),
    requestId: z.string().min(1).max(200),
    requestedAt: dateSchema,
    pageIds: z.array(z.guid()).max(100),
  }),
  pages: z
    .array(
      z.strictObject({
        revision: revisionSchema,
        action: z.enum(["publish", "unpublish", "noop"]),
        route: z.string().startsWith("/").nullable(),
        effectivePublishedAt: dateSchema.nullable(),
        issues: z.array(
          z.strictObject({
            pageId: z.guid(),
            code: z.enum(PUBLISH_VALIDATION_CODES),
            message: z.string().min(1).max(500),
          }),
        ),
      }),
    )
    .max(MAX_PUBLISH_JOB_PAGES),
})
const invalidationRequestSchema = z.strictObject({
  workflowId: z.string().min(1).max(200),
  buildHash: z.string().min(1).max(200),
  paths: z.array(z.string().startsWith("/").max(1_000)).max(3_000),
})
const deploymentStateRequestSchema = z.strictObject({
  pageIds: z.array(z.guid()).min(1).max(100),
})
const commentRefreshRequestSchema: z.ZodType<CommentRefreshJobRequest> = z.strictObject({
  workflowId: z.string().min(1).max(200),
  requestedAt: dateSchema,
  slug: z.string().refine(isValidSlug),
})

const jsonResponse = (value: unknown, status = 200): Response => {
  return Response.json(value, { status })
}

const readJson = async (request: Request): Promise<unknown> => {
  const contentLength = Number(request.headers.get("Content-Length"))
  if (Number.isFinite(contentLength) && MAX_REQUEST_BYTES < contentLength) {
    throw Error("request body が 2 MiB の上限を超えています")
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (MAX_REQUEST_BYTES < bytes.byteLength) {
    throw Error("request body が 2 MiB の上限を超えています")
  }

  return JSON.parse(new TextDecoder().decode(bytes))
}

const handleRequest = async (request: Request): Promise<Response> => {
  const url = new URL(request.url)
  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ status: "ok" })
  }
  if (request.method === "POST" && url.pathname === "/publish") {
    const parsed = publishRequestSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid publish request" }, 400)
    }

    return jsonResponse(await runContainerPublishJob(parsed.data, readContainerConfig()))
  }
  if (request.method === "POST" && url.pathname === "/comment-refresh") {
    const parsed = commentRefreshRequestSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid comment refresh request" }, 400)
    }

    return jsonResponse(await runContainerCommentRefreshJob(parsed.data, readContainerConfig()))
  }
  if (request.method === "POST" && url.pathname === "/invalidate") {
    const parsed = invalidationRequestSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid invalidation request" }, 400)
    }
    const config = readContainerConfig()
    const reference = createHash("sha256")
      .update(`${parsed.data.workflowId}:${parsed.data.buildHash}`)
      .digest("hex")
    await new CloudFrontInvalidator(
      {
        region: config.awsRegion,
        accessKeyId: config.awsAccessKeyId,
        secretAccessKey: config.awsSecretAccessKey,
      },
      config.cloudFrontDistributionId,
    ).invalidate(parsed.data.paths, reference)

    return jsonResponse({ invalidated: true })
  }
  if (request.method === "POST" && url.pathname === "/deployment-state") {
    const parsed = deploymentStateRequestSchema.safeParse(await readJson(request))
    if (!parsed.success) {
      return jsonResponse({ error: "Invalid deployment state request" }, 400)
    }

    return jsonResponse({
      pages: await loadDeploymentPageStates(parsed.data.pageIds, readContainerConfig()),
    })
  }

  return jsonResponse({ error: "Not found" }, 404)
}

const server = Bun.serve({
  port: 8080,
  fetch: async (request) => {
    try {
      return await handleRequest(request)
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 2_000) : null
      console.error(
        JSON.stringify({
          event: "container_request_failed",
          path: new URL(request.url).pathname,
          error: err instanceof Error ? err.name : "UnknownError",
          detail,
        }),
      )

      return jsonResponse({ error: "Internal server error", detail }, 500)
    }
  },
})

// sleepAfter の停止は SIGTERM を送るだけで、PID 1 のプロセスには既定のシグナル動作が入らず
// ハンドラがないと黙って無視される。明示的に受けて終了しないと Container が動き続ける。
// sleepAfter はアイドル時にしか発火しないため、ここで待つべき処理は残っていない
const shutdown = () => {
  void server.stop()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
