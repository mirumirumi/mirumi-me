import type { NotionPublishResult } from "shared/notion"

import type {
  DeploymentPageState,
  PageRevision,
  PreparedPageRevision,
  PublishFailure,
  PublishJobRequest,
  PublishJobSummary,
  PublishWorkflowParams,
  PublishWorkflowResult,
} from "../lib/publishing"
import { validatePageRevisionMetadata } from "../lib/publishing"

type WorkflowDurationUnit = "second" | "minute" | "hour" | "day" | "week" | "month" | "year"
type WorkflowDuration = `${number} ${WorkflowDurationUnit}` | `${number} ${WorkflowDurationUnit}s`

interface WorkflowStepConfig {
  retries: {
    limit: number
    delay: WorkflowDuration
    backoff: "constant" | "linear" | "exponential"
  }
  timeout: WorkflowDuration
}

export const BOOTSTRAP_WRITEBACK_CHUNK_SIZE = 50

export const PUBLISH_WORKFLOW_STEP_CONFIGS = {
  loadRequest: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  preflightRequest: {
    retries: { limit: 0, delay: "1 second", backoff: "constant" },
    timeout: "1 minute",
  },
  publishSite: {
    retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
    timeout: "30 minutes",
  },
  // full と bootstrap は全記事の取得に加えて、thumbnail を持たない記事ぶんの自動生成 Lambda を
  // 直列で通すため初回は数時間かかる。publish index が保存されれば次回以降は生成を省略できる。
  // 途中で失敗したときに数時間をもう一度やり直すのは無駄なので retry はしない
  publishSiteFullBuild: {
    retries: { limit: 0, delay: "10 seconds", backoff: "constant" },
    timeout: "6 hours",
  },
  invalidateCloudFront: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  loadDeploymentState: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  writeNotionResult: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "2 minutes",
  },
  writeBootstrapNotionResult: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "10 minutes",
  },
} as const satisfies Record<string, WorkflowStepConfig>

export interface WorkflowStepExecutor {
  do<T extends Rpc.Serializable<T>>(
    name: string,
    config: WorkflowStepConfig,
    callback: () => Promise<T>,
  ): Promise<T>
}

export interface LoadedPublishRequest {
  revisions: Array<PageRevision>
  failed: Array<PublishFailure>
}

export interface PublishWorkflowDependencies {
  loadRequest(): Promise<LoadedPublishRequest>
  publishSite(request: PublishJobRequest): Promise<PublishJobSummary>
  invalidateSite(summary: PublishJobSummary): Promise<void>
  loadDeploymentPages(pageIds: Array<string>): Promise<Array<DeploymentPageState>>
  writeNotionResults(results: Array<NotionPublishResult>, delayMs?: number): Promise<void>
}

interface RunPublishWorkflowOptions {
  workflowId: string
  params: PublishWorkflowParams
  step: WorkflowStepExecutor
  dependencies: PublishWorkflowDependencies
}

const toPublishFailure = (issue: PreparedPageRevision["issues"][number]): PublishFailure => {
  return {
    pageId: issue.pageId,
    code: issue.code,
    message: issue.message,
  }
}

const toFailedNotionResults = (
  failures: Array<PublishFailure>,
  workflowId: string,
  revisions: Array<PageRevision>,
  deploymentPages: Array<DeploymentPageState>,
): Array<NotionPublishResult> => {
  const messagesByPage = new Map<string, Array<string>>()
  for (const failure of failures) {
    const messages = messagesByPage.get(failure.pageId) ?? []
    messages.push(failure.message)
    messagesByPage.set(failure.pageId, messages)
  }

  const revisionByPage = new Map(revisions.map((revision) => [revision.pageId, revision]))
  const deploymentByPage = new Map(deploymentPages.map((page) => [page.pageId, page]))

  return [...messagesByPage].map(([pageId, messages]) => {
    const deployment = deploymentByPage.get(pageId)
    let internalState: "下書き" | "公開中" | "非公開" | null = null
    let deployedAt: string | null = null
    let publishedAt: string | null = null
    if (deployment?.status === "published") {
      internalState = "公開中"
      deployedAt = deployment.deployedAt
      publishedAt = deployment.publishedAt
    } else if (deployment?.status === "unpublished") {
      internalState = "非公開"
    } else if (
      deployment?.status === "missing" &&
      revisionByPage.get(pageId)?.lastDeploy === null
    ) {
      internalState = "下書き"
    }

    return {
      status: "failed",
      pageId,
      internalState,
      deployedAt,
      publishedAt,
      error: `${messages.join(" / ")}（Workflow: ${workflowId}）`,
    }
  })
}

const loadFailureDeploymentPages = async (
  failures: Array<PublishFailure>,
  step: WorkflowStepExecutor,
  dependencies: PublishWorkflowDependencies,
): Promise<Array<DeploymentPageState>> => {
  if (failures.length === 0) {
    return []
  }

  try {
    return await step.do(
      "load-deployment-state",
      PUBLISH_WORKFLOW_STEP_CONFIGS.loadDeploymentState,
      async () =>
        dependencies.loadDeploymentPages([...new Set(failures.map(({ pageId }) => pageId))]),
    )
  } catch {
    return []
  }
}

const validateJobSummary = (
  summary: PublishJobSummary,
  workflowId: string,
  pages: Array<PreparedPageRevision>,
): void => {
  if (summary.workflowId !== workflowId) {
    throw Error("Container から別 Workflow の結果が返されました")
  }

  const expectedPageIds = new Set(pages.map((page) => page.revision.pageId))
  const resultPageIds = [
    ...summary.pages.map((page) => page.pageId),
    ...summary.failed.map((page) => page.pageId),
  ]
  if (
    resultPageIds.length !== expectedPageIds.size ||
    resultPageIds.some((pageId) => !expectedPageIds.has(pageId)) ||
    new Set(resultPageIds).size !== resultPageIds.length
  ) {
    throw Error("Container の公開結果と依頼した page が一致しません")
  }
}

const createResult = (
  workflowId: string,
  summary: PublishJobSummary | null,
  failures: Array<PublishFailure>,
): PublishWorkflowResult => {
  return {
    workflowId,
    status: 0 < failures.length ? "completed-with-errors" : "completed",
    publishedPageIds:
      summary?.pages.filter((page) => page.action === "publish").map((page) => page.pageId) ?? [],
    unpublishedPageIds:
      summary?.pages.filter((page) => page.action === "unpublish").map((page) => page.pageId) ?? [],
    failed: failures.map(({ pageId, code }) => ({ pageId, code })),
  }
}

const toSuccessfulNotionResults = (summary: PublishJobSummary): Array<NotionPublishResult> => {
  return summary.pages.map((page) => {
    if (page.action === "publish") {
      return {
        status: "published",
        pageId: page.pageId,
        deployedAt: page.deployedAt,
        publishedAt: page.publishedAt,
      }
    }

    return { status: "unpublished", pageId: page.pageId }
  })
}

export const runPublishWorkflow = async ({
  workflowId,
  params,
  step,
  dependencies,
}: RunPublishWorkflowOptions): Promise<PublishWorkflowResult> => {
  const loaded = await step.do(
    "load-request",
    PUBLISH_WORKFLOW_STEP_CONFIGS.loadRequest,
    dependencies.loadRequest,
  )
  const prepared = await step.do(
    "preflight-request",
    PUBLISH_WORKFLOW_STEP_CONFIGS.preflightRequest,
    async () => {
      return loaded.revisions.map((revision) =>
        validatePageRevisionMetadata(revision, params.mode, params.requestedAt),
      )
    },
  )
  const preflightFailures = [
    ...loaded.failed,
    ...prepared.flatMap((page) => page.issues.map(toPublishFailure)),
  ]
  const publishablePages = prepared.filter(
    (page) => page.action !== "noop" && page.issues.length === 0,
  )

  if (publishablePages.length === 0) {
    if (params.mode === "partial" && 0 < preflightFailures.length) {
      const deploymentPages = await loadFailureDeploymentPages(
        preflightFailures,
        step,
        dependencies,
      )
      await step.do(
        "write-notion-result",
        PUBLISH_WORKFLOW_STEP_CONFIGS.writeNotionResult,
        async () => {
          await dependencies.writeNotionResults(
            toFailedNotionResults(preflightFailures, workflowId, loaded.revisions, deploymentPages),
          )
        },
      )
    }

    return createResult(workflowId, null, preflightFailures)
  }

  let summary: PublishJobSummary
  try {
    const publishSiteConfig =
      params.mode === "partial"
        ? PUBLISH_WORKFLOW_STEP_CONFIGS.publishSite
        : PUBLISH_WORKFLOW_STEP_CONFIGS.publishSiteFullBuild
    summary = await step.do("publish-site", publishSiteConfig, async () => {
      return dependencies.publishSite({ workflowId, params, pages: publishablePages })
    })
    validateJobSummary(summary, workflowId, publishablePages)
  } catch (err) {
    if (params.mode === "partial") {
      const publishFailures: Array<PublishFailure> = publishablePages.map((page) => ({
        pageId: page.revision.pageId,
        code: "publish-failed",
        message: "公開処理に失敗しました",
      }))
      const failures = [...preflightFailures, ...publishFailures]
      const deploymentPages = await loadFailureDeploymentPages(failures, step, dependencies)
      await step.do(
        "write-notion-result",
        PUBLISH_WORKFLOW_STEP_CONFIGS.writeNotionResult,
        async () => {
          await dependencies.writeNotionResults(
            toFailedNotionResults(failures, workflowId, loaded.revisions, deploymentPages),
          )
        },
      )
    }

    throw err
  }

  const failures = [...preflightFailures, ...summary.failed]
  try {
    await step.do(
      "invalidate-cloudfront",
      PUBLISH_WORKFLOW_STEP_CONFIGS.invalidateCloudFront,
      async () => {
        await dependencies.invalidateSite(summary)
      },
    )
  } catch (err) {
    if (params.mode === "partial") {
      const invalidationFailures: Array<PublishFailure> = summary.pages.map((page) => ({
        pageId: page.pageId,
        code: "publish-failed",
        message: "CloudFront の更新に失敗しました",
      }))
      const allFailures = [...failures, ...invalidationFailures]
      const deploymentPages = await loadFailureDeploymentPages(allFailures, step, dependencies)
      await step.do(
        "write-notion-result",
        PUBLISH_WORKFLOW_STEP_CONFIGS.writeNotionResult,
        async () => {
          await dependencies.writeNotionResults(
            toFailedNotionResults(allFailures, workflowId, loaded.revisions, deploymentPages),
          )
        },
      )
    }

    throw err
  }
  if (params.mode === "partial") {
    const successResults = toSuccessfulNotionResults(summary)
    const deploymentPages = await loadFailureDeploymentPages(failures, step, dependencies)
    await step.do(
      "write-notion-result",
      PUBLISH_WORKFLOW_STEP_CONFIGS.writeNotionResult,
      async () => {
        await dependencies.writeNotionResults([
          ...toFailedNotionResults(failures, workflowId, loaded.revisions, deploymentPages),
          ...successResults,
        ])
      },
    )
  } else if (params.mode === "bootstrap") {
    const successResults = toSuccessfulNotionResults(summary)
    // step の再試行は先頭からやり直すため、chunk に分けて書き戻し済みのぶんを捨てない
    for (let index = 0; index < successResults.length; index += BOOTSTRAP_WRITEBACK_CHUNK_SIZE) {
      const chunk = successResults.slice(index, index + BOOTSTRAP_WRITEBACK_CHUNK_SIZE)
      await step.do(
        `write-bootstrap-notion-result-${index / BOOTSTRAP_WRITEBACK_CHUNK_SIZE}`,
        PUBLISH_WORKFLOW_STEP_CONFIGS.writeBootstrapNotionResult,
        async () => {
          await dependencies.writeNotionResults(chunk, 350)
        },
      )
    }
  }

  return createResult(workflowId, summary, failures)
}
