import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { z } from "zod"

import {
  createNotionClient,
  fetchNotionPageRevision,
  fetchNotionPageRevisions,
  InvalidNotionPageRevisionError,
  isNotionObjectNotFound,
  isNotionValidationError,
  type NotionDataSourceIds,
  type NotionPublishResult,
  writeNotionPublishResult,
} from "shared/notion"
import { isIgnoredFixedPageSlug } from "shared/site-routes"

import type {
  DeploymentPageState,
  PublishFailure,
  PublishJobRequest,
  PublishJobState,
  PublishJobSummary,
  PublishWorkflowParams,
  PublishWorkflowResult,
} from "../lib/publishing"
import {
  type LoadedPublishRequest,
  type PublishWorkflowStepExecutor,
  runPublishWorkflow,
} from "../services/publish-workflow"

const publishWorkflowParamsSchema = z
  .object({
    mode: z.enum(["partial", "full", "bootstrap"]),
    source: z.enum(["notion-webhook", "admin", "release"]),
    requestId: z.string().min(1).max(200),
    requestedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
    pageIds: z.array(z.guid()).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "partial" && value.pageIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["pageIds"],
        message: "partial publish には page ID が必要です",
      })
    }
    if (value.mode !== "partial" && 0 < value.pageIds.length) {
      context.addIssue({
        code: "custom",
        path: ["pageIds"],
        message: "full publish に page ID は指定できません",
      })
    }
    if (value.mode === "partial" && value.source === "release") {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "release は partial publish を起動できません",
      })
    }
    if (value.mode !== "partial" && value.source !== "release") {
      context.addIssue({
        code: "custom",
        path: ["source"],
        message: "full publish は release からだけ起動できます",
      })
    }
  })

const getNotionConfig = (
  env: CloudflareBindings,
): { token: string; dataSources: NotionDataSourceIds } => {
  if (!env.NOTION_TOKEN || !env.NOTION_POSTS_DATA_SOURCE_ID || !env.NOTION_PAGES_DATA_SOURCE_ID) {
    throw Error("Notion の公開設定が不足しています")
  }

  return {
    token: env.NOTION_TOKEN,
    dataSources: {
      posts: env.NOTION_POSTS_DATA_SOURCE_ID,
      pages: env.NOTION_PAGES_DATA_SOURCE_ID,
    },
  }
}

const loadPartialRequest = async (
  params: PublishWorkflowParams,
  token: string,
  dataSources: NotionDataSourceIds,
): Promise<LoadedPublishRequest> => {
  const client = createNotionClient(token)
  const revisions: LoadedPublishRequest["revisions"] = []
  const failed: Array<PublishFailure> = []

  for (const pageId of params.pageIds) {
    try {
      const revision = await fetchNotionPageRevision(client, pageId, dataSources)
      // 黙って落とすと Notion 側が公開待ちのまま止まり、操作者に手がかりが残らない
      if (isIgnoredFixedPageSlug(revision.slug)) {
        failed.push({
          pageId,
          code: "invalid-page",
          message: "この固定ページは公開対象ではありません",
        })
        continue
      }
      revisions.push(revision)
    } catch (err) {
      if (isNotionObjectNotFound(err)) {
        failed.push({
          pageId,
          code: "page-not-found",
          message: "公開対象の page が見つかりません",
        })
        continue
      }
      if (isNotionValidationError(err) || err instanceof InvalidNotionPageRevisionError) {
        failed.push({
          pageId,
          code: "invalid-page",
          message: "公開対象の Notion page が不正です",
        })
        continue
      }

      throw err
    }
  }

  return { revisions, failed }
}

const loadRequest = async (
  params: PublishWorkflowParams,
  env: CloudflareBindings,
): Promise<LoadedPublishRequest> => {
  const { token, dataSources } = getNotionConfig(env)
  if (params.mode === "partial") {
    return loadPartialRequest(params, token, dataSources)
  }

  const revisions = await fetchNotionPageRevisions(createNotionClient(token), dataSources)

  return {
    revisions: revisions.filter((revision) => !isIgnoredFixedPageSlug(revision.slug)),
    failed: [],
  }
}

const publishSite = async (
  request: PublishJobRequest,
  env: CloudflareBindings,
): Promise<PublishJobSummary> => {
  if (!env.BUILD_CONTAINER) {
    throw Error("BuildContainer binding がありません")
  }

  return env.BUILD_CONTAINER.getByName("publisher").runPublishJob(request)
}

const startPublishSite = async (request: PublishJobRequest, env: CloudflareBindings) => {
  if (!env.BUILD_CONTAINER) {
    throw Error("BuildContainer binding がありません")
  }

  await env.BUILD_CONTAINER.getByName("publisher").startPublishJob(request)
}

const readPublishSiteState = async (
  workflowId: string,
  env: CloudflareBindings,
): Promise<PublishJobState> => {
  if (!env.BUILD_CONTAINER) {
    throw Error("BuildContainer binding がありません")
  }

  return env.BUILD_CONTAINER.getByName("publisher").readPublishJobState(workflowId)
}

const invalidateSite = async (summary: PublishJobSummary, env: CloudflareBindings) => {
  if (!env.BUILD_CONTAINER) {
    throw Error("BuildContainer binding がありません")
  }

  await env.BUILD_CONTAINER.getByName("publisher").invalidateSiteCache(
    summary.workflowId,
    summary.buildHash,
    summary.updatedPaths,
  )
}

const loadDeploymentPages = async (
  pageIds: Array<string>,
  env: CloudflareBindings,
): Promise<Array<DeploymentPageState>> => {
  if (!env.BUILD_CONTAINER) {
    throw Error("BuildContainer binding がありません")
  }

  return env.BUILD_CONTAINER.getByName("publisher").loadDeploymentPageStates(pageIds)
}

const writeNotionResults = async (
  results: Array<NotionPublishResult>,
  env: CloudflareBindings,
  delayMs?: number,
) => {
  const { token } = getNotionConfig(env)
  const client = createNotionClient(token)
  for (let index = 0; index < results.length; index++) {
    if (0 < index && delayMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
    }
    const result = results[index]!
    try {
      await writeNotionPublishResult(client, result)
    } catch (err) {
      if (isNotionObjectNotFound(err)) {
        continue
      }

      throw err
    }
  }
}

const createStepExecutor = (step: WorkflowStep): PublishWorkflowStepExecutor => {
  return {
    do: (name, config, callback) => step.do(name, config, callback),
    sleep: (name, duration) => step.sleep(name, duration),
  }
}

export class PublishWorkflow extends WorkflowEntrypoint<CloudflareBindings, PublishWorkflowParams> {
  override async run(
    event: Readonly<WorkflowEvent<PublishWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<PublishWorkflowResult> {
    const parsed = publishWorkflowParamsSchema.safeParse(event.payload)
    if (!parsed.success) {
      throw new NonRetryableError("Workflow の入力が不正です")
    }

    const params = parsed.data

    return runPublishWorkflow({
      workflowId: event.instanceId,
      params,
      step: createStepExecutor(step),
      dependencies: {
        loadRequest: async () => loadRequest(params, this.env),
        publishSite: async (request) => publishSite(request, this.env),
        startPublishSite: async (request) => startPublishSite(request, this.env),
        readPublishSiteState: async (id) => readPublishSiteState(id, this.env),
        invalidateSite: async (summary) => invalidateSite(summary, this.env),
        loadDeploymentPages: async (pageIds) => loadDeploymentPages(pageIds, this.env),
        writeNotionResults: async (results, delayMs) =>
          writeNotionResults(results, this.env, delayMs),
      },
    })
  }
}
