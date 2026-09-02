import { describe, expect, test, vi } from "vitest"

import type {
  DeploymentPageState,
  PageRevision,
  PublishJobRequest,
  PublishJobSummary,
  PublishWorkflowParams,
} from "../lib/publishing"
import {
  BOOTSTRAP_WRITEBACK_CHUNK_SIZE,
  type LoadedPublishRequest,
  PUBLISH_WORKFLOW_STEP_CONFIGS,
  type PublishWorkflowDependencies,
  runPublishWorkflow,
  type WorkflowStepExecutor,
} from "./publish-workflow"

describe("runPublishWorkflow", () => {
  class MemoryStep implements WorkflowStepExecutor {
    calls: Array<{ name: string; config: unknown }> = []

    async do<T>(name: string, config: unknown, callback: () => Promise<T>): Promise<T> {
      this.calls.push({ name, config })

      return callback()
    }
  }

  const params: PublishWorkflowParams = {
    mode: "partial",
    source: "admin",
    requestId: "request-id",
    requestedAt: "2026-08-24T02:00:00.000Z",
    pageIds: ["00000000-0000-0000-0000-000000000001"],
  }

  const makeRevision = (overrides: Partial<PageRevision> = {}): PageRevision => {
    return {
      pageId: "00000000-0000-0000-0000-000000000001",
      kind: "post",
      title: "記事タイトル",
      slug: "article-slug",
      internalState: "公開待ち",
      lastEditedTime: "2026-08-24T01:00:00.000Z",
      lastDeploy: null,
      lastNotionEdit: "2026-08-24T01:00:00.000Z",
      publishedAt: null,
      updatedAt: null,
      category: { name: "技術", slug: "tech" },
      ...overrides,
    }
  }

  const makeSummary = (overrides: Partial<PublishJobSummary> = {}): PublishJobSummary => {
    return {
      workflowId: "workflow-id",
      buildHash: "build-hash",
      pages: [
        {
          pageId: "00000000-0000-0000-0000-000000000001",
          action: "publish",
          deployedAt: "2026-08-24T02:05:00.000Z",
          publishedAt: "2026-08-24T02:00:00.000Z",
          contentHash: "content-hash",
        },
      ],
      failed: [],
      updatedPaths: ["/article-slug/", "/article-slug/index.html"],
      ...overrides,
    }
  }

  const createDependencies = (loaded: LoadedPublishRequest) => {
    const loadRequest = vi.fn(async () => loaded)
    const publishSite = vi.fn(async (_request: PublishJobRequest) => makeSummary())
    const invalidateSite = vi.fn(async (_summary: PublishJobSummary) => undefined)
    const loadDeploymentPages = vi.fn(async (_pageIds: Array<string>) => {
      return [] as Array<DeploymentPageState>
    })
    const writeNotionResults = vi.fn(async () => undefined)

    return {
      dependencies: {
        loadRequest,
        publishSite,
        invalidateSite,
        loadDeploymentPages,
        writeNotionResults,
      } satisfies PublishWorkflowDependencies,
      loadRequest,
      publishSite,
      invalidateSite,
      loadDeploymentPages,
      writeNotionResults,
    }
  }

  test("永続 step を通して Container の小さい summary を公開結果へ変換する", async () => {
    const step = new MemoryStep()
    const { dependencies, publishSite, writeNotionResults } = createDependencies({
      revisions: [makeRevision()],
      failed: [],
    })

    expect(
      await runPublishWorkflow({
        workflowId: "workflow-id",
        params,
        step,
        dependencies,
      }),
    ).toEqual({
      workflowId: "workflow-id",
      status: "completed",
      publishedPageIds: ["00000000-0000-0000-0000-000000000001"],
      unpublishedPageIds: [],
      failed: [],
    })
    expect(step.calls).toEqual([
      { name: "load-request", config: PUBLISH_WORKFLOW_STEP_CONFIGS.loadRequest },
      { name: "preflight-request", config: PUBLISH_WORKFLOW_STEP_CONFIGS.preflightRequest },
      { name: "publish-site", config: PUBLISH_WORKFLOW_STEP_CONFIGS.publishSite },
      {
        name: "invalidate-cloudfront",
        config: PUBLISH_WORKFLOW_STEP_CONFIGS.invalidateCloudFront,
      },
      { name: "write-notion-result", config: PUBLISH_WORKFLOW_STEP_CONFIGS.writeNotionResult },
    ])
    expect(publishSite).toHaveBeenCalledWith({
      workflowId: "workflow-id",
      params,
      pages: [
        expect.objectContaining({
          action: "publish",
          effectivePublishedAt: "2026-08-24T02:00:00.000Z",
          issues: [],
        }),
      ],
    })
    expect(writeNotionResults).toHaveBeenCalledWith([
      {
        status: "published",
        pageId: "00000000-0000-0000-0000-000000000001",
        deployedAt: "2026-08-24T02:05:00.000Z",
        publishedAt: "2026-08-24T02:00:00.000Z",
      },
    ])
  })

  test("bootstrap は deploy 済み page の Notion 結果を rate limit 付きで初期化する", async () => {
    const step = new MemoryStep()
    const { dependencies, writeNotionResults } = createDependencies({
      revisions: [
        makeRevision({
          internalState: "公開中",
          publishedAt: "2026-08-20T00:00:00.000Z",
        }),
      ],
      failed: [],
    })
    const bootstrapParams: PublishWorkflowParams = {
      mode: "bootstrap",
      source: "release",
      requestId: "bootstrap-request",
      requestedAt: params.requestedAt,
      pageIds: [],
    }

    await runPublishWorkflow({
      workflowId: "workflow-id",
      params: bootstrapParams,
      step,
      dependencies,
    })

    expect(writeNotionResults).toHaveBeenCalledWith(
      [
        {
          status: "published",
          pageId: "00000000-0000-0000-0000-000000000001",
          deployedAt: "2026-08-24T02:05:00.000Z",
          publishedAt: "2026-08-24T02:00:00.000Z",
        },
      ],
      350,
    )
    expect(step.calls.at(-1)).toEqual({
      name: "write-bootstrap-notion-result-0",
      config: PUBLISH_WORKFLOW_STEP_CONFIGS.writeBootstrapNotionResult,
    })
  })

  test("bootstrap の Notion 書き戻しは chunk ごとに別 step へ分ける", async () => {
    const pageIds = Array.from(
      { length: BOOTSTRAP_WRITEBACK_CHUNK_SIZE + 1 },
      (_, index) => `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    )
    const step = new MemoryStep()
    const { dependencies, publishSite, writeNotionResults } = createDependencies({
      revisions: pageIds.map((pageId, index) =>
        makeRevision({
          pageId,
          slug: `article-${index}`,
          internalState: "公開中",
          publishedAt: "2026-08-20T00:00:00.000Z",
        }),
      ),
      failed: [],
    })
    publishSite.mockResolvedValue(
      makeSummary({
        pages: pageIds.map((pageId) => ({
          pageId,
          action: "publish",
          deployedAt: "2026-08-24T02:05:00.000Z",
          publishedAt: "2026-08-24T02:00:00.000Z",
          contentHash: "content-hash",
        })),
      }),
    )
    await runPublishWorkflow({
      workflowId: "workflow-id",
      params: {
        mode: "bootstrap",
        source: "release",
        requestId: "bootstrap-request",
        requestedAt: params.requestedAt,
        pageIds: [],
      },
      step,
      dependencies,
    })
    const writebackSteps = step.calls.filter(({ name }) =>
      name.startsWith("write-bootstrap-notion-result-"),
    )
    expect(writebackSteps.map(({ name }) => name)).toEqual([
      "write-bootstrap-notion-result-0",
      "write-bootstrap-notion-result-1",
    ])
    expect(writeNotionResults).toHaveBeenCalledTimes(2)
    expect(writeNotionResults.mock.calls.at(0)?.at(0)).toHaveLength(BOOTSTRAP_WRITEBACK_CHUNK_SIZE)
    expect(writeNotionResults.mock.calls.at(1)?.at(0)).toHaveLength(1)
  })

  test("論理エラーの page を除外して正常な page だけ Container へ渡す", async () => {
    const step = new MemoryStep()
    const invalidPageId = "00000000-0000-0000-0000-000000000002"
    const { dependencies, publishSite, loadDeploymentPages, writeNotionResults } =
      createDependencies({
        revisions: [makeRevision(), makeRevision({ pageId: invalidPageId, title: "" })],
        failed: [],
      })
    loadDeploymentPages.mockResolvedValueOnce([
      {
        pageId: invalidPageId,
        status: "published",
        deployedAt: "2026-08-23T02:00:00.000Z",
        publishedAt: "2026-08-20T02:00:00.000Z",
      },
    ])

    expect(
      await runPublishWorkflow({
        workflowId: "workflow-id",
        params: { ...params, pageIds: [...params.pageIds, invalidPageId] },
        step,
        dependencies,
      }),
    ).toEqual({
      workflowId: "workflow-id",
      status: "completed-with-errors",
      publishedPageIds: ["00000000-0000-0000-0000-000000000001"],
      unpublishedPageIds: [],
      failed: [{ pageId: invalidPageId, code: "missing-title" }],
    })
    expect(publishSite.mock.calls.at(0)?.at(0)?.pages).toHaveLength(1)
    expect(writeNotionResults).toHaveBeenCalledWith([
      {
        status: "failed",
        pageId: invalidPageId,
        internalState: "公開中",
        deployedAt: "2026-08-23T02:00:00.000Z",
        publishedAt: "2026-08-20T02:00:00.000Z",
        error: "title が空です（Workflow: workflow-id）",
      },
      expect.objectContaining({
        status: "published",
        pageId: "00000000-0000-0000-0000-000000000001",
      }),
    ])
  })

  test("全 page が論理エラーなら Container を起動せず失敗を書き戻す", async () => {
    const step = new MemoryStep()
    const { dependencies, publishSite, loadDeploymentPages, writeNotionResults } =
      createDependencies({
        revisions: [],
        failed: [
          {
            pageId: "00000000-0000-0000-0000-000000000001",
            code: "page-not-found",
            message: "公開対象の page が見つかりません",
          },
        ],
      })
    loadDeploymentPages.mockResolvedValueOnce([
      {
        pageId: "00000000-0000-0000-0000-000000000001",
        status: "missing",
      },
    ])

    expect(
      await runPublishWorkflow({
        workflowId: "workflow-id",
        params,
        step,
        dependencies,
      }),
    ).toEqual({
      workflowId: "workflow-id",
      status: "completed-with-errors",
      publishedPageIds: [],
      unpublishedPageIds: [],
      failed: [
        {
          pageId: "00000000-0000-0000-0000-000000000001",
          code: "page-not-found",
        },
      ],
    })
    expect(publishSite).not.toHaveBeenCalled()
    expect(writeNotionResults).toHaveBeenCalledWith([
      expect.objectContaining({
        status: "failed",
        pageId: "00000000-0000-0000-0000-000000000001",
      }),
    ])
  })

  test("Container の retry 枯渇後は失敗を書き戻して Workflow を失敗させる", async () => {
    const step = new MemoryStep()
    const { dependencies, publishSite, loadDeploymentPages, writeNotionResults } =
      createDependencies({
        revisions: [makeRevision()],
        failed: [],
      })
    const publishError = Error("container unavailable")
    publishSite.mockRejectedValueOnce(publishError)
    loadDeploymentPages.mockResolvedValueOnce([
      {
        pageId: "00000000-0000-0000-0000-000000000001",
        status: "published",
        deployedAt: "2026-08-24T02:00:00.000Z",
        publishedAt: "2026-08-24T01:00:00.000Z",
      },
    ])

    await expect(
      runPublishWorkflow({
        workflowId: "workflow-id",
        params,
        step,
        dependencies,
      }),
    ).rejects.toEqual(publishError)
    expect(writeNotionResults).toHaveBeenCalledWith([
      {
        status: "failed",
        pageId: "00000000-0000-0000-0000-000000000001",
        internalState: "公開中",
        deployedAt: "2026-08-24T02:00:00.000Z",
        publishedAt: "2026-08-24T01:00:00.000Z",
        error: "公開処理に失敗しました（Workflow: workflow-id）",
      },
    ])
  })

  test("CloudFront 失敗時は index 上の実配信状態を書き戻す", async () => {
    const step = new MemoryStep()
    const { dependencies, invalidateSite, loadDeploymentPages, writeNotionResults } =
      createDependencies({ revisions: [makeRevision()], failed: [] })
    const invalidationError = Error("cloudfront unavailable")
    invalidateSite.mockRejectedValueOnce(invalidationError)
    loadDeploymentPages.mockResolvedValueOnce([
      {
        pageId: "00000000-0000-0000-0000-000000000001",
        status: "published",
        deployedAt: "2026-08-24T02:05:00.000Z",
        publishedAt: "2026-08-24T02:00:00.000Z",
      },
    ])

    await expect(
      runPublishWorkflow({ workflowId: "workflow-id", params, step, dependencies }),
    ).rejects.toEqual(invalidationError)
    expect(writeNotionResults).toHaveBeenCalledWith([
      {
        status: "failed",
        pageId: "00000000-0000-0000-0000-000000000001",
        internalState: "公開中",
        deployedAt: "2026-08-24T02:05:00.000Z",
        publishedAt: "2026-08-24T02:00:00.000Z",
        error: "CloudFront の更新に失敗しました（Workflow: workflow-id）",
      },
    ])
  })

  test("index を読めない失敗は Notion state を推測しない", async () => {
    const step = new MemoryStep()
    const { dependencies, publishSite, loadDeploymentPages, writeNotionResults } =
      createDependencies({ revisions: [makeRevision()], failed: [] })
    const publishError = Error("container unavailable")
    publishSite.mockRejectedValueOnce(publishError)
    loadDeploymentPages.mockRejectedValueOnce(Error("index unavailable"))

    await expect(
      runPublishWorkflow({ workflowId: "workflow-id", params, step, dependencies }),
    ).rejects.toEqual(publishError)
    expect(writeNotionResults).toHaveBeenCalledWith([
      {
        status: "failed",
        pageId: "00000000-0000-0000-0000-000000000001",
        internalState: null,
        deployedAt: null,
        publishedAt: null,
        error: "公開処理に失敗しました（Workflow: workflow-id）",
      },
    ])
  })
})
