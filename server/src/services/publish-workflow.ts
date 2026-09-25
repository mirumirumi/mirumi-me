import type { NotionPublishResult } from "shared/notion"

import type {
  DeploymentPageState,
  PageRevision,
  PreparedPageRevision,
  PublishFailure,
  PublishJobRequest,
  PublishJobState,
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
  // 直列で通すため初回は数時間かかる。受け付けるだけなのでこの step 自体は短く、
  // 完了を待つのは FULL_BUILD_POLL_LIMIT 側の予算
  startPublishSite: {
    retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
    timeout: "5 minutes",
  },
  // 受け付け済みの job の状態を見に行くだけ。ここで諦めると走っている build を追えなくなる
  pollPublishSite: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "2 minutes",
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

// 長い build の完了待ちを step.sleep で刻むのは publish workflow だけなので、ここで足す
export interface PublishWorkflowStepExecutor extends WorkflowStepExecutor {
  sleep(name: string, duration: WorkflowDuration): Promise<void>
}

export interface LoadedPublishRequest {
  revisions: Array<PageRevision>
  failed: Array<PublishFailure>
}

export interface PublishWorkflowDependencies {
  loadRequest(): Promise<LoadedPublishRequest>
  publishSite(request: PublishJobRequest): Promise<PublishJobSummary>
  startPublishSite(request: PublishJobRequest): Promise<void>
  readPublishSiteState(workflowId: string): Promise<PublishJobState>
  invalidateSite(summary: PublishJobSummary): Promise<void>
  loadDeploymentPages(pageIds: Array<string>): Promise<Array<DeploymentPageState>>
  writeNotionResults(results: Array<NotionPublishResult>, delayMs?: number): Promise<void>
}

interface RunPublishWorkflowOptions {
  workflowId: string
  params: PublishWorkflowParams
  step: PublishWorkflowStepExecutor
  dependencies: PublishWorkflowDependencies
}

const toPublishFailure = (issue: PreparedPageRevision["issues"][number]): PublishFailure => {
  return {
    pageId: issue.pageId,
    code: issue.code,
    message: issue.message,
  }
}

const ERROR_SUMMARY_HEAD_CHARS = 160
const ERROR_SUMMARY_TAIL_CHARS = 500

// Container の例外は「何が失敗したか」の前置きに generate のログ末尾が続く形なので、
// 長いときは前置きとログの最後だけを残す
const summarizeError = (err: unknown): string => {
  const message = (err instanceof Error ? err.message : String(err))
    .replaceAll(/[ \t]+/g, " ")
    .trim()
  if (message.length <= ERROR_SUMMARY_HEAD_CHARS + ERROR_SUMMARY_TAIL_CHARS) {
    return message
  }

  return `${message.slice(0, ERROR_SUMMARY_HEAD_CHARS)} … ${message.slice(-ERROR_SUMMARY_TAIL_CHARS)}`
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
        updatedAt: page.updatedAt,
      }
    }

    return { status: "unpublished", pageId: page.pageId }
  })
}

// full / bootstrap は 1 時間以上かかるため、1 つの step で結果を待つと「待っているだけの
// invocation」が Workers の hang 判定で打ち切られる。受け付けと待機を分けて step.sleep で刻む
const FULL_BUILD_POLL_INTERVAL: WorkflowDuration = "1 minute"
// publish index が空の初回ビルドは全記事の thumbnail 生成が走るため極端に遅く、
// dev では 1 回の試行が 4.7 時間走ってまだ終わっていなかった。本番 bootstrap も同じ条件なので、
// 同期方式のときの step timeout（6 時間）では足りない恐れがある。
// step.sleep は Workflows の step 上限に数えられず、待っているあいだのコストも無いので長く取る
const FULL_BUILD_POLL_LIMIT = 720

const runPublishSite = async (
  request: PublishJobRequest,
  step: PublishWorkflowStepExecutor,
  dependencies: PublishWorkflowDependencies,
): Promise<PublishJobSummary> => {
  // partial は数分で終わるので、1 step で完結させたままにする
  if (request.params.mode === "partial") {
    return step.do("publish-site", PUBLISH_WORKFLOW_STEP_CONFIGS.publishSite, async () => {
      return dependencies.publishSite(request)
    })
  }
  await step.do("start-publish-site", PUBLISH_WORKFLOW_STEP_CONFIGS.startPublishSite, async () => {
    await dependencies.startPublishSite(request)
  })
  for (let attempt = 0; attempt < FULL_BUILD_POLL_LIMIT; attempt++) {
    await step.sleep(`wait-publish-site-${attempt}`, FULL_BUILD_POLL_INTERVAL)
    const state = await step.do(
      `poll-publish-site-${attempt}`,
      PUBLISH_WORKFLOW_STEP_CONFIGS.pollPublishSite,
      async () => {
        return dependencies.readPublishSiteState(request.workflowId)
      },
    )
    if (state.status === "done") {
      return state.summary
    }
    if (state.status === "failed") {
      throw Error(state.message)
    }
    // Container が作り直されると受け付けた記録も消えるため、待ち続けずに落とす
    if (state.status === "unknown") {
      throw Error("Container が publish job を見失いました")
    }
  }

  throw Error(`publish job が ${FULL_BUILD_POLL_LIMIT} 回の polling で終わりませんでした`)
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
    summary = await runPublishSite(
      { workflowId, params, pages: publishablePages },
      step,
      dependencies,
    )
    validateJobSummary(summary, workflowId, publishablePages)
  } catch (err) {
    if (params.mode === "partial") {
      // Workflow の describe API は失敗 instance で 500 を返すことがあり、原因が Notion からしか追えない。
      // Container が例外へ載せた generate のログ末尾もここを通るので、短く切って書き戻す
      const message = `公開処理に失敗しました: ${summarizeError(err)}`
      const publishFailures: Array<PublishFailure> = publishablePages.map((page) => ({
        pageId: page.revision.pageId,
        code: "publish-failed",
        message,
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
