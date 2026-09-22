import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { z } from "zod"

import { createNotionClient, isNotionObjectNotFound } from "shared/notion"
import {
  createCommentRefreshErrorUpdate,
  createCommentSlugUpdate,
  fetchCommentPage,
  resolveCommentDataSourceSchema,
  resolveInheritedCommentSlug,
} from "shared/notion-comments"

import type {
  CommentRefreshJobRequest,
  CommentRefreshJobSummary,
  CommentRefreshWorkflowParams,
  CommentRefreshWorkflowResult,
} from "../lib/comment-refresh"
import { type LoadedComment, runCommentRefreshWorkflow } from "../services/comment-refresh-workflow"
import type { WorkflowStepExecutor } from "../services/publish-workflow"

const commentRefreshWorkflowParamsSchema = z
  .object({
    source: z.enum(["notion-webhook", "admin"]),
    requestId: z.string().min(1).max(200),
    requestedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
    commentPageId: z.guid(),
  })
  .strict()

const getCommentConfig = (env: CloudflareBindings): { token: string; dataSourceId: string } => {
  if (!env.NOTION_TOKEN || !env.NOTION_COMMENTS_DATA_SOURCE_ID) {
    throw Error("Notion の comments 設定が不足しています")
  }

  return { token: env.NOTION_TOKEN, dataSourceId: env.NOTION_COMMENTS_DATA_SOURCE_ID }
}

const loadComment = async (
  commentPageId: string,
  env: CloudflareBindings,
): Promise<LoadedComment | null> => {
  const { token, dataSourceId } = getCommentConfig(env)
  const client = createNotionClient(token)
  try {
    const schema = await resolveCommentDataSourceSchema(client, dataSourceId)
    const record = await fetchCommentPage(client, schema, commentPageId)
    if (!record) {
      return null
    }
    if (record.slug) {
      return { slug: record.slug, slugInherited: false, refreshError: record.refreshError }
    }
    const slug = await resolveInheritedCommentSlug(client, schema, record)

    return { slug, slugInherited: slug !== "", refreshError: record.refreshError }
  } catch (err) {
    // 削除済み row は slug を特定できないので何もしない。誤削除は full build で収束させる運用
    if (isNotionObjectNotFound(err)) {
      return null
    }

    throw err
  }
}

const refreshComments = async (
  request: CommentRefreshJobRequest,
  env: CloudflareBindings,
): Promise<CommentRefreshJobSummary> => {
  if (!env.BUILD_CONTAINER) {
    throw Error("BuildContainer binding がありません")
  }

  return env.BUILD_CONTAINER.getByName("publisher").runCommentRefreshJob(request)
}

const invalidateSite = async (summary: CommentRefreshJobSummary, env: CloudflareBindings) => {
  if (!env.BUILD_CONTAINER) {
    throw Error("BuildContainer binding がありません")
  }

  await env.BUILD_CONTAINER.getByName("publisher").invalidateSiteCache(
    summary.workflowId,
    summary.buildHash,
    summary.updatedPaths,
  )
}

const writeRefreshError = async (
  commentPageId: string,
  error: string | null,
  env: CloudflareBindings,
) => {
  const { token } = getCommentConfig(env)
  try {
    await createNotionClient(token).pages.update(
      createCommentRefreshErrorUpdate(commentPageId, error),
    )
  } catch (err) {
    if (!isNotionObjectNotFound(err)) {
      throw err
    }
  }
}

const writeSlug = async (commentPageId: string, slug: string, env: CloudflareBindings) => {
  const { token } = getCommentConfig(env)
  await createNotionClient(token).pages.update(createCommentSlugUpdate(commentPageId, slug))
}

const createStepExecutor = (step: WorkflowStep): WorkflowStepExecutor => {
  return {
    do: (name, config, callback) => step.do(name, config, callback),
  }
}

export class CommentRefreshWorkflow extends WorkflowEntrypoint<
  CloudflareBindings,
  CommentRefreshWorkflowParams
> {
  override async run(
    event: Readonly<WorkflowEvent<CommentRefreshWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<CommentRefreshWorkflowResult> {
    const parsed = commentRefreshWorkflowParamsSchema.safeParse(event.payload)
    if (!parsed.success) {
      throw new NonRetryableError("Workflow の入力が不正です")
    }

    return runCommentRefreshWorkflow({
      workflowId: event.instanceId,
      params: parsed.data,
      step: createStepExecutor(step),
      dependencies: {
        loadComment: async (commentPageId) => loadComment(commentPageId, this.env),
        refreshComments: async (request) => refreshComments(request, this.env),
        invalidateSite: async (summary) => invalidateSite(summary, this.env),
        writeRefreshError: async (commentPageId, error) =>
          writeRefreshError(commentPageId, error, this.env),
        writeSlug: async (commentPageId, slug) => writeSlug(commentPageId, slug, this.env),
      },
    })
  }
}
