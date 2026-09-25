import { z } from "zod"

import { isValidSlug } from "shared/site-routes"

import type { CommentRefreshJobRequest, CommentRefreshJobSummary } from "../lib/comment-refresh"
import type { DeploymentPageState, PublishJobRequest, PublishJobSummary } from "../lib/publishing"
import { PUBLISH_VALIDATION_CODES } from "../lib/publishing"
import type { BackgroundPublishJobs } from "./background-publish"
import type { ContainerConfig } from "./config"
import type { SerialJobQueue } from "./job-queue"

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

export interface RequestHandlerDependencies {
  // publish index の書き手を 1 本に保つための queue。partial の同期実行も full の background 実行も通す
  jobs: SerialJobQueue
  backgroundPublishJobs: BackgroundPublishJobs
  readConfig(): ContainerConfig
  runPublishJob(request: PublishJobRequest, config: ContainerConfig): Promise<PublishJobSummary>
  runCommentRefreshJob(
    request: CommentRefreshJobRequest,
    config: ContainerConfig,
  ): Promise<CommentRefreshJobSummary>
  invalidateSite(
    config: ContainerConfig,
    referenceSeed: string,
    paths: Array<string>,
  ): Promise<void>
  loadDeploymentPageStates(
    pageIds: Array<string>,
    config: ContainerConfig,
  ): Promise<Array<DeploymentPageState>>
}

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

export const createRequestHandler = (
  dependencies: RequestHandlerDependencies,
): ((request: Request) => Promise<Response>) => {
  const { jobs, backgroundPublishJobs } = dependencies

  // full build の裏に積むと、待っている HTTP が返る前に Workflow 側が hang 判定で殺される。
  // そうなると catch が走らず Notion へ失敗も書けないまま、ジョブだけ 1 時間後に実行されて
  // 「サイトには出ているのに Notion は公開待ち」という不整合が残る。待たせずに断る
  const backgroundJobConflict = (): Response | null => {
    const running = backgroundPublishJobs.runningWorkflowIds()
    if (running.length === 0) {
      return null
    }

    return jsonResponse({ error: `full build の実行中です: ${running.join(", ")}` }, 409)
  }

  const startBackgroundPublishJob = (job: PublishJobRequest) => {
    backgroundPublishJobs.start(job.workflowId, async () => {
      const config = dependencies.readConfig()
      const summary = await dependencies.runPublishJob(job, config)
      // Workflow が先に諦めても CDN は更新しておく。失敗しても build 結果は捨てない
      try {
        await dependencies.invalidateSite(
          config,
          `container:${summary.workflowId}:${summary.buildHash}`,
          summary.updatedPaths,
        )
        // best-effort なので、流れたことを後から確認する手段がこのログしかない
        console.log(
          JSON.stringify({
            event: "container_invalidation_requested",
            workflowId: summary.workflowId,
            paths: summary.updatedPaths.length,
          }),
        )
      } catch (err) {
        console.warn(
          JSON.stringify({
            event: "container_invalidation_failed",
            workflowId: summary.workflowId,
            error: err instanceof Error ? err.name : "UnknownError",
            // 握り潰す設計なので、ここが唯一の手がかりになる
            detail: err instanceof Error ? err.message.slice(0, 2_000) : null,
          }),
        )
      }

      return summary
    })
  }

  return async (request) => {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({ status: "ok" })
    }
    if (request.method === "POST" && url.pathname === "/publish") {
      const parsed = publishRequestSchema.safeParse(await readJson(request))
      if (!parsed.success) {
        return jsonResponse({ error: "Invalid publish request" }, 400)
      }
      const job = parsed.data
      // partial は数分で終わるので、結果をそのまま返す経路を残す
      if (job.params.mode === "partial") {
        const busy = backgroundJobConflict()
        if (busy) {
          return busy
        }

        return jsonResponse(
          await jobs.run(`publish:${job.workflowId}`, () =>
            dependencies.runPublishJob(job, dependencies.readConfig()),
          ),
        )
      }
      startBackgroundPublishJob(job)

      return jsonResponse({ accepted: true }, 202)
    }
    if (request.method === "GET" && url.pathname === "/jobs") {
      // ハングしたジョブを busy と答え続けると、Container を止めることも作り直すこともできない。
      // その後ろに積まれたジョブも道連れで動けないので、まとめて busy ではないと答える
      return jsonResponse({
        busy: jobs.isBusy() && !backgroundPublishJobs.hasStaleRunning(),
      })
    }
    if (request.method === "GET" && url.pathname === "/publish-state") {
      const workflowId = url.searchParams.get("workflowId")
      if (!workflowId) {
        return jsonResponse({ error: "workflowId is required" }, 400)
      }

      return jsonResponse(backgroundPublishJobs.read(workflowId) ?? { status: "unknown" })
    }
    if (request.method === "POST" && url.pathname === "/comment-refresh") {
      const parsed = commentRefreshRequestSchema.safeParse(await readJson(request))
      if (!parsed.success) {
        return jsonResponse({ error: "Invalid comment refresh request" }, 400)
      }
      const job = parsed.data
      const busy = backgroundJobConflict()
      if (busy) {
        return busy
      }

      return jsonResponse(
        await jobs.run(`comment-refresh:${job.workflowId}`, () =>
          dependencies.runCommentRefreshJob(job, dependencies.readConfig()),
        ),
      )
    }
    if (request.method === "POST" && url.pathname === "/invalidate") {
      const parsed = invalidationRequestSchema.safeParse(await readJson(request))
      if (!parsed.success) {
        return jsonResponse({ error: "Invalid invalidation request" }, 400)
      }
      await dependencies.invalidateSite(
        dependencies.readConfig(),
        `${parsed.data.workflowId}:${parsed.data.buildHash}`,
        parsed.data.paths,
      )

      return jsonResponse({ invalidated: true })
    }
    if (request.method === "POST" && url.pathname === "/deployment-state") {
      const parsed = deploymentStateRequestSchema.safeParse(await readJson(request))
      if (!parsed.success) {
        return jsonResponse({ error: "Invalid deployment state request" }, 400)
      }

      return jsonResponse({
        pages: await dependencies.loadDeploymentPageStates(
          parsed.data.pageIds,
          dependencies.readConfig(),
        ),
      })
    }

    return jsonResponse({ error: "Not found" }, 404)
  }
}
