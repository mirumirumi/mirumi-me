import { Container } from "@cloudflare/containers"
import { z } from "zod"

import { resolveExternalBookmark } from "shared/bookmark"
import { resolveXPost } from "shared/x-post"

import type { DeploymentPageState, PublishJobRequest, PublishJobSummary } from "../lib/publishing"
import { PUBLISH_FAILURE_CODES } from "../lib/publishing"
import { createXaiPostFetcher } from "../services/x-post"

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

  private jobQueue: Promise<void> = Promise.resolve()

  private createEnvVars(): Record<string, string> {
    return {
      APP_ENV: getRequiredEnv(this.env, "APP_ENV"),
      NOTION_TOKEN: getRequiredEnv(this.env, "NOTION_TOKEN"),
      NOTION_POSTS_DATA_SOURCE_ID: getRequiredEnv(this.env, "NOTION_POSTS_DATA_SOURCE_ID"),
      NOTION_PAGES_DATA_SOURCE_ID: getRequiredEnv(this.env, "NOTION_PAGES_DATA_SOURCE_ID"),
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

  private async executePublishJob(request: PublishJobRequest): Promise<PublishJobSummary> {
    // suspended instance は application rollout 前の image を保持しうるため、build ごとに作り直す
    await this.destroy()
    this.envVars = this.createEnvVars()
    const response = await this.containerFetch("http://container.internal/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    })
    if (!response.ok) {
      let detail: string | null = null
      try {
        const body: unknown = await response.json()
        if (
          typeof body === "object" &&
          body !== null &&
          "detail" in body &&
          typeof body.detail === "string"
        ) {
          detail = body.detail
        }
      } catch {
        detail = null
      }
      throw Error(
        `Container の publish job が失敗しました: ${response.status}${detail ? ` (${detail})` : ""}`,
      )
    }

    return publishJobSummarySchema.parse(await response.json())
  }

  async runPublishJob(request: PublishJobRequest): Promise<PublishJobSummary> {
    const job = this.jobQueue.then(() => this.executePublishJob(request))
    this.jobQueue = job.then(
      () => undefined,
      () => undefined,
    )

    return job
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
        ),
      )
    }

    return new Response("Not Found", { status: 404 })
  },
}
