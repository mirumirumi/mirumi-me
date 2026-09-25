import { Container } from "@cloudflare/containers"
import { z } from "zod"

import { resolveExternalBookmark } from "shared/bookmark"
import { resolveXPost } from "shared/x-post"

import type { CommentRefreshJobRequest, CommentRefreshJobSummary } from "../lib/comment-refresh"
import type {
  DeploymentPageState,
  PublishJobRequest,
  PublishJobState,
  PublishJobSummary,
} from "../lib/publishing"
import { PUBLISH_FAILURE_CODES } from "../lib/publishing"
import { createXaiPostFetcher, createXPostLinkCardResolver } from "../services/x-post"
import { SerialJobQueue, shouldRecreateContainer } from "./job-queue"

const CONTAINER_VERSION_KEY = "containerVersion"

const publishFailureSchema = z
  .object({
    pageId: z.guid(),
    code: z.enum(PUBLISH_FAILURE_CODES),
    message: z.string().min(1).max(500),
  })
  .strict()

const publishJobSummarySchema = z
  .object({
    workflowId: z.string().min(1).max(200),
    buildHash: z.string().min(1).max(200),
    pages: z.array(
      z.discriminatedUnion("action", [
        z
          .object({
            pageId: z.guid(),
            action: z.literal("publish"),
            deployedAt: z.string(),
            publishedAt: z.string(),
            contentHash: z.string().min(1).max(200),
            updatedAt: z.string().nullable(),
          })
          .strict(),
        z
          .object({
            pageId: z.guid(),
            action: z.literal("unpublish"),
            deployedAt: z.string(),
            contentHash: z.null(),
          })
          .strict(),
      ]),
    ),
    failed: z.array(publishFailureSchema),
    updatedPaths: z.array(z.string().startsWith("/").max(1_000)),
  })
  .strict()

const publishJobStateSchema: z.ZodType<PublishJobState> = z.discriminatedUnion("status", [
  z.object({ status: z.literal("running") }).strict(),
  z.object({ status: z.literal("done"), summary: publishJobSummarySchema }).strict(),
  z.object({ status: z.literal("failed"), message: z.string().min(1).max(4_000) }).strict(),
  z.object({ status: z.literal("unknown") }).strict(),
])

const containerJobsSchema = z.object({ busy: z.boolean() }).strict()

const deploymentPageStateSchema = z.discriminatedUnion("status", [
  z
    .object({
      pageId: z.guid(),
      status: z.literal("published"),
      deployedAt: z.string(),
      publishedAt: z.string(),
    })
    .strict(),
  z.object({ pageId: z.guid(), status: z.literal("unpublished") }).strict(),
  z.object({ pageId: z.guid(), status: z.literal("missing") }).strict(),
])
const deploymentPageStatesSchema = z.object({ pages: z.array(deploymentPageStateSchema) }).strict()

const commentRefreshJobSummarySchema: z.ZodType<CommentRefreshJobSummary> = z
  .object({
    workflowId: z.string().min(1).max(200),
    slug: z.string().min(1).max(200),
    status: z.enum(["refreshed", "unchanged", "skipped"]),
    reason: z.string().max(500).nullable(),
    pageId: z.guid().nullable(),
    contentHash: z.string().min(1).max(200).nullable(),
    buildHash: z.string().min(1).max(200),
    updatedPaths: z.array(z.string().startsWith("/").max(1_000)),
  })
  .strict()

const readErrorDetail = async (response: Response): Promise<string | null> => {
  try {
    const body: unknown = await response.json()
    if (typeof body === "object" && body !== null) {
      // catch-all の 500 は detail、明示的に返すエラーは error に理由が入っている
      for (const key of ["detail", "error"] as const) {
        const value = (body as Record<string, unknown>)[key]
        if (typeof value === "string" && 0 < value.length) {
          return value
        }
      }
    }
  } catch {
    // body が JSON でなければ status だけを伝える
  }

  return null
}

const getRequiredEnv = (env: CloudflareBindings, name: keyof CloudflareBindings): string => {
  const value = env[name]
  if (typeof value !== "string" || !value) {
    throw Error(`Container に渡す設定が不足しています: ${name}`)
  }

  return value
}

export class BuildContainer extends Container<CloudflareBindings> {
  override defaultPort = 8080
  override pingEndpoint = "health"
  override sleepAfter = "15m"

  private readonly jobs = new SerialJobQueue()

  private createEnvVars(): Record<string, string> {
    return {
      APP_ENV: getRequiredEnv(this.env, "APP_ENV"),
      NOTION_TOKEN: getRequiredEnv(this.env, "NOTION_TOKEN"),
      NOTION_POSTS_DATA_SOURCE_ID: getRequiredEnv(this.env, "NOTION_POSTS_DATA_SOURCE_ID"),
      NOTION_PAGES_DATA_SOURCE_ID: getRequiredEnv(this.env, "NOTION_PAGES_DATA_SOURCE_ID"),
      NOTION_COMMENTS_DATA_SOURCE_ID: getRequiredEnv(this.env, "NOTION_COMMENTS_DATA_SOURCE_ID"),
      AMAZON_CARD_SIGNING_SECRET: getRequiredEnv(this.env, "AMAZON_CARD_SIGNING_SECRET"),
      AWS_REGION: getRequiredEnv(this.env, "AWS_REGION"),
      AWS_ACCESS_KEY_ID: getRequiredEnv(this.env, "AWS_ACCESS_KEY_ID"),
      AWS_SECRET_ACCESS_KEY: getRequiredEnv(this.env, "AWS_SECRET_ACCESS_KEY"),
      SITE_BUCKET_NAME: getRequiredEnv(this.env, "SITE_BUCKET_NAME"),
      MEDIA_BUCKET_NAME: getRequiredEnv(this.env, "MEDIA_BUCKET_NAME"),
      CLOUDFRONT_DISTRIBUTION_ID: getRequiredEnv(this.env, "CLOUDFRONT_DISTRIBUTION_ID"),
      THUMBNAIL_FUNCTION_URL: getRequiredEnv(this.env, "THUMBNAIL_FUNCTION_URL"),
      WORKERS_API_ORIGIN: getRequiredEnv(this.env, "WORKERS_API_ORIGIN"),
    }
  }

  // Container の中でジョブが走っているかを本人に聞く。停止中なら聞くだけで起動してしまうので、
  // running のときしか問い合わせない
  private async isContainerBusy(): Promise<boolean> {
    // 親クラスの this.container は型が private なので、DO の binding から直接見る
    if (!this.ctx.container?.running) {
      return false
    }
    // 判断できないときは「走っているかもしれない」側に倒し、動いているジョブを守る。
    // ここで throw すると、ガードのためにジョブを落としたり alarm を回し続けたりしてしまう
    try {
      const response = await this.containerFetch("http://container.internal/jobs")
      if (!response.ok) {
        await response.body?.cancel()

        return true
      }

      return containerJobsSchema.parse(await response.json()).busy
    } catch {
      return true
    }
  }

  // full build は HTTP を開いたまま待たないので、走っている最中でも containerFetch の
  // inflight が 0 になる。つまりライブラリから見るとアイドルで、放っておくと sleepAfter の
  // 15 分で SIGTERM が飛び、1 時間のビルドが記録も残さず消える。
  // ここで本人に確認して、走っているなら止めない。ライブラリはこのあと必ず
  // renewActivityTimeout() を呼ぶので、見送るたびに次の猶予が 15 分ぶん伸びる
  override async onActivityExpired(): Promise<void> {
    if (await this.isContainerBusy()) {
      return
    }
    await super.onActivityExpired()
  }

  private async destroyOutdatedInstance(): Promise<void> {
    const version = this.env.CF_VERSION_METADATA?.id
    const lastSeen = await this.ctx.storage.get<string>(CONTAINER_VERSION_KEY)
    if (!shouldRecreateContainer(version, lastSeen)) {
      return
    }
    // destroy は SIGKILL なので、走っているジョブを巻き込む。version を記録せずに見送り、
    // 空いている次のジョブで作り直させる
    if (await this.isContainerBusy()) {
      return
    }
    await this.destroy()
    if (version) {
      await this.ctx.storage.put(CONTAINER_VERSION_KEY, version)
    }
  }

  private async executePublishJob(request: PublishJobRequest): Promise<PublishJobSummary> {
    await this.destroyOutdatedInstance()
    this.envVars = this.createEnvVars()
    const response = await this.containerFetch("http://container.internal/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const detail = await readErrorDetail(response)
      throw Error(
        `Container の publish job が失敗しました: ${response.status}${detail ? ` (${detail})` : ""}`,
      )
    }

    return publishJobSummarySchema.parse(await response.json())
  }

  private async executeCommentRefreshJob(
    request: CommentRefreshJobRequest,
  ): Promise<CommentRefreshJobSummary> {
    await this.destroyOutdatedInstance()
    this.envVars = this.createEnvVars()
    const response = await this.containerFetch("http://container.internal/comment-refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const detail = await readErrorDetail(response)
      throw Error(
        `Container の comment refresh job が失敗しました: ${response.status}${detail ? ` (${detail})` : ""}`,
      )
    }

    return commentRefreshJobSummarySchema.parse(await response.json())
  }

  async runPublishJob(request: PublishJobRequest): Promise<PublishJobSummary> {
    return this.jobs.run(`publish:${request.workflowId}`, () => this.executePublishJob(request))
  }

  // full / bootstrap 用。Container に受け付けさせるだけで、完了は readPublishJobState で待つ
  async startPublishJob(request: PublishJobRequest): Promise<void> {
    await this.destroyOutdatedInstance()
    this.envVars = this.createEnvVars()
    const response = await this.containerFetch("http://container.internal/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      const detail = await readErrorDetail(response)
      throw Error(
        `Container が publish job を受け付けませんでした: ${response.status}${detail ? ` (${detail})` : ""}`,
      )
    }
    // body を残すと containerFetch の inflight が減らず、sleepAfter が発火しなくなる
    await response.body?.cancel()
  }

  // 走っている job を巻き込むため、ここでは instance を作り直さない
  async readPublishJobState(workflowId: string): Promise<PublishJobState> {
    this.envVars = this.createEnvVars()
    const url = new URL("http://container.internal/publish-state")
    url.searchParams.set("workflowId", workflowId)
    const response = await this.containerFetch(url.toString())
    if (!response.ok) {
      const detail = await readErrorDetail(response)
      throw Error(
        `Container の publish job 状態を取得できませんでした: ${response.status}${detail ? ` (${detail})` : ""}`,
      )
    }

    return publishJobStateSchema.parse(await response.json())
  }

  // publish index を書くのは publish と comment refresh の両方なので、同じ queue で直列にする
  async runCommentRefreshJob(request: CommentRefreshJobRequest): Promise<CommentRefreshJobSummary> {
    return this.jobs.run(`comment-refresh:${request.workflowId}`, () =>
      this.executeCommentRefreshJob(request),
    )
  }

  async invalidateSiteCache(
    workflowId: string,
    buildHash: string,
    paths: Array<string>,
  ): Promise<void> {
    this.envVars = this.createEnvVars()
    const response = await this.containerFetch("http://container.internal/invalidate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowId, buildHash, paths }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`Container の invalidation が失敗しました: ${response.status}`)
    }
    await response.body?.cancel()
  }

  async loadDeploymentPageStates(pageIds: Array<string>): Promise<Array<DeploymentPageState>> {
    this.envVars = this.createEnvVars()
    const response = await this.containerFetch("http://container.internal/deployment-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageIds }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`Container の publish index 取得が失敗しました: ${response.status}`)
    }

    return deploymentPageStatesSchema.parse(await response.json()).pages
  }
}

BuildContainer.outboundByHost = {
  "bindings.internal": async (request, env) => {
    if (request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 })
    }
    if (!env.CONTENT_CACHE) {
      console.error(JSON.stringify({ event: "content_cache_binding_missing" }))

      return new Response("Internal Server Error", { status: 500 })
    }
    const url = new URL(request.url)
    if (url.pathname === "/bookmark") {
      const target = url.searchParams.get("url")
      if (!target) {
        return Response.json({ error: "Invalid bookmark URL" }, { status: 400 })
      }

      return Response.json(await resolveExternalBookmark(target, env.CONTENT_CACHE))
    }
    const postId = url.pathname.match(/^\/x-post\/(\d+)$/)?.[1]
    if (postId) {
      if (!env.XAI_API_KEY || !env.XAI_MODEL) {
        return Response.json({ error: "X post service is not configured" }, { status: 500 })
      }

      return Response.json(
        await resolveXPost(
          postId,
          env.CONTENT_CACHE,
          createXaiPostFetcher(env.XAI_API_KEY, env.XAI_MODEL),
          createXPostLinkCardResolver(env.CONTENT_CACHE),
        ),
      )
    }

    return new Response("Not Found", { status: 404 })
  },
}
