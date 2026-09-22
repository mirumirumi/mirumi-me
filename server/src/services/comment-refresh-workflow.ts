import type {
  CommentRefreshJobRequest,
  CommentRefreshJobSummary,
  CommentRefreshWorkflowParams,
  CommentRefreshWorkflowResult,
} from "../lib/comment-refresh"
import type { WorkflowStepExecutor } from "./publish-workflow"

export const COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS = {
  loadComment: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  refreshComments: {
    retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
    timeout: "30 minutes",
  },
  invalidateCloudFront: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  writeNotionResult: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
} as const

export interface LoadedComment {
  slug: string
  // row の slug が空で親から継いだとき true。Container を呼ぶ前に row へ書き戻し、以後は通常の row として扱う
  slugInherited: boolean
  // 反映エラー が残っていれば成功時に消す。空なら Notion へ書かない（無駄な更新 event を出さない）
  refreshError: string | null
}

export interface CommentRefreshWorkflowDependencies {
  // comments の row でなければ null
  loadComment(commentPageId: string): Promise<LoadedComment | null>
  refreshComments(request: CommentRefreshJobRequest): Promise<CommentRefreshJobSummary>
  invalidateSite(summary: CommentRefreshJobSummary): Promise<void>
  writeRefreshError(commentPageId: string, error: string | null): Promise<void>
  writeSlug(commentPageId: string, slug: string): Promise<void>
}

interface RunCommentRefreshWorkflowOptions {
  workflowId: string
  params: CommentRefreshWorkflowParams
  step: WorkflowStepExecutor
  dependencies: CommentRefreshWorkflowDependencies
}

const ERROR_SUMMARY_CHARS = 600

const summarizeError = (err: unknown): string => {
  const message = (err instanceof Error ? err.message : String(err))
    .replaceAll(/[ \t]+/g, " ")
    .trim()

  return message.length <= ERROR_SUMMARY_CHARS
    ? message
    : `${message.slice(0, ERROR_SUMMARY_CHARS)} …`
}

export const runCommentRefreshWorkflow = async ({
  workflowId,
  params,
  step,
  dependencies,
}: RunCommentRefreshWorkflowOptions): Promise<CommentRefreshWorkflowResult> => {
  const { commentPageId } = params
  const loaded = await step.do(
    "load-comment",
    COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS.loadComment,
    async () => dependencies.loadComment(commentPageId),
  )
  if (!loaded) {
    return { workflowId, commentPageId, slug: "", status: "skipped" }
  }
  const writeError = async (error: string | null) => {
    await step.do(
      "write-notion-result",
      COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS.writeNotionResult,
      async () => {
        await dependencies.writeRefreshError(commentPageId, error)
      },
    )
  }
  if (!loaded.slug) {
    await writeError(`記事 slug がありません（Workflow: ${workflowId}）`)

    return { workflowId, commentPageId, slug: "", status: "skipped" }
  }
  if (loaded.slugInherited) {
    // Container は slug で query するので、先に書き戻さないとこの row 自身が結果に入らない
    try {
      await step.do(
        "write-notion-slug",
        COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS.writeNotionResult,
        async () => {
          await dependencies.writeSlug(commentPageId, loaded.slug)
        },
      )
    } catch (err) {
      await writeError(
        `slug の書き戻しに失敗しました: ${summarizeError(err)}（Workflow: ${workflowId}）`,
      )
      throw err
    }
  }

  let summary: CommentRefreshJobSummary
  try {
    summary = await step.do(
      "refresh-comments",
      COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS.refreshComments,
      async () => {
        return dependencies.refreshComments({
          workflowId,
          requestedAt: params.requestedAt,
          slug: loaded.slug,
        })
      },
    )
    if (summary.workflowId !== workflowId || summary.slug !== loaded.slug) {
      throw Error("Container から別の comment refresh の結果が返されました")
    }
  } catch (err) {
    // desired state は Notion の status に残る。失敗理由だけを row に出して次の retry / full build に委ねる
    await writeError(`反映に失敗しました: ${summarizeError(err)}（Workflow: ${workflowId}）`)
    throw err
  }

  if (0 < summary.updatedPaths.length) {
    try {
      await step.do(
        "invalidate-cloudfront",
        COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS.invalidateCloudFront,
        async () => {
          await dependencies.invalidateSite(summary)
        },
      )
    } catch (err) {
      await writeError(`CloudFront の更新に失敗しました（Workflow: ${workflowId}）`)
      throw err
    }
  }
  if (loaded.refreshError !== null) {
    await writeError(null)
  }

  return { workflowId, commentPageId, slug: summary.slug, status: summary.status }
}
