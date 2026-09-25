import { describe, expect, test, vi } from "vitest"

import type {
  DeploymentPageState,
  PageRevision,
  PublishJobRequest,
  PublishJobState,
  PublishJobSummary,
  PublishWorkflowParams,
} from "../lib/publishing"
import {
  BOOTSTRAP_WRITEBACK_CHUNK_SIZE,
  type LoadedPublishRequest,
  PUBLISH_WORKFLOW_STEP_CONFIGS,
  type PublishWorkflowDependencies,
  type PublishWorkflowStepExecutor,
  runPublishWorkflow,
} from "./publish-workflow"

describe("runPublishWorkflow", () => {
  class MemoryStep implements PublishWorkflowStepExecutor {
    calls: Array<{ name: string; config: unknown }> = []
    sleeps: Array<{ name: string; duration: string }> = []
    // sleep は待たないので、poll より前に来ているかを別に記録して確かめる
    order: Array<string> = []

    async do<T>(name: string, config: unknown, callback: () => Promise<T>): Promise<T> {
      this.calls.push({ name, config })
      this.order.push(name)

      return callback()
    }

    async sleep(name: string, duration: string) {
      this.sleeps.push({ name, duration })
      this.order.push(name)
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
          updatedAt: null,
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
    const startPublishSite = vi.fn(async (_request: PublishJobRequest) => undefined)
    const readPublishSiteState = vi.fn(async (_workflowId: string): Promise<PublishJobState> => {
      return { status: "done", summary: makeSummary() }
    })
    const invalidateSite = vi.fn(async (_summary: PublishJobSummary) => undefined)
    const loadDeploymentPages = vi.fn(async (_pageIds: Array<string>) => {
      return [] as Array<DeploymentPageState>
    })
    const writeNotionResults = vi.fn(async () => undefined)

    return {
      dependencies: {
        loadRequest,
        publishSite,
        startPublishSite,
        readPublishSiteState,
        invalidateSite,
        loadDeploymentPages,
        writeNotionResults,
      } satisfies PublishWorkflowDependencies,
      loadRequest,
      publishSite,
      startPublishSite,
      readPublishSiteState,
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
        updatedAt: null,
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
          updatedAt: null,
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
    const { dependencies, readPublishSiteState, writeNotionResults } = createDependencies({
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
    readPublishSiteState.mockResolvedValue({
      status: "done",
      summary: makeSummary({
        pages: pageIds.map((pageId) => ({
          pageId,
          action: "publish",
          deployedAt: "2026-08-24T02:05:00.000Z",
          publishedAt: "2026-08-24T02:00:00.000Z",
          contentHash: "content-hash",
          updatedAt: null,
        })),
      }),
    })
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
        error: "公開処理に失敗しました: container unavailable（Workflow: workflow-id）",
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
        error: "公開処理に失敗しました: container unavailable（Workflow: workflow-id）",
      },
    ])
  })

  describe("full build の完了待ち", () => {
    const fullParams: PublishWorkflowParams = {
      mode: "full",
      source: "release",
      requestId: "release-request",
      requestedAt: params.requestedAt,
      pageIds: [],
    }

    const runFullBuild = async (step: MemoryStep, dependencies: PublishWorkflowDependencies) => {
      return runPublishWorkflow({
        workflowId: "workflow-id",
        params: fullParams,
        step,
        dependencies,
      })
    }

    const loadedForFullBuild = () => {
      return {
        revisions: [
          makeRevision({ internalState: "公開中", publishedAt: "2026-08-20T00:00:00.000Z" }),
        ],
        failed: [],
      }
    }

    test("受け付けと待機を別の step に分ける", async () => {
      const step = new MemoryStep()
      const { dependencies, publishSite, startPublishSite } = createDependencies(
        loadedForFullBuild(),
      )

      await runFullBuild(step, dependencies)

      expect(publishSite).not.toHaveBeenCalled()
      expect(startPublishSite).toHaveBeenCalledTimes(1)
      expect(step.calls.map(({ name }) => name)).toEqual([
        "load-request",
        "preflight-request",
        "start-publish-site",
        "poll-publish-site-0",
        "invalidate-cloudfront",
      ])
      expect(step.sleeps).toEqual([{ name: "wait-publish-site-0", duration: "1 minute" }])
      expect(step.order).toEqual([
        "load-request",
        "preflight-request",
        "start-publish-site",
        "wait-publish-site-0",
        "poll-publish-site-0",
        "invalidate-cloudfront",
      ])
    })

    test("running のあいだは polling を続ける", async () => {
      const step = new MemoryStep()
      const { dependencies, readPublishSiteState, invalidateSite } = createDependencies(
        loadedForFullBuild(),
      )
      readPublishSiteState
        .mockResolvedValueOnce({ status: "running" })
        .mockResolvedValueOnce({ status: "running" })

      await runFullBuild(step, dependencies)

      expect(readPublishSiteState).toHaveBeenCalledTimes(3)
      expect(step.sleeps.map(({ name }) => name)).toEqual([
        "wait-publish-site-0",
        "wait-publish-site-1",
        "wait-publish-site-2",
      ])
      expect(step.order.slice(3, 9)).toEqual([
        "wait-publish-site-0",
        "poll-publish-site-0",
        "wait-publish-site-1",
        "poll-publish-site-1",
        "wait-publish-site-2",
        "poll-publish-site-2",
      ])
      expect(invalidateSite).toHaveBeenCalledTimes(1)
    })

    test("running のまま上限に達したら打ち切る", async () => {
      const step = new MemoryStep()
      const { dependencies, readPublishSiteState, invalidateSite } = createDependencies(
        loadedForFullBuild(),
      )
      readPublishSiteState.mockResolvedValue({ status: "running" })

      await expect(runFullBuild(step, dependencies)).rejects.toThrow(
        "publish job が 720 回の polling で終わりませんでした",
      )
      expect(readPublishSiteState).toHaveBeenCalledTimes(720)
      expect(step.sleeps).toHaveLength(720)
      expect(invalidateSite).not.toHaveBeenCalled()
    })

    test("failed は Container のメッセージで落とす", async () => {
      const step = new MemoryStep()
      const { dependencies, invalidateSite } = createDependencies(loadedForFullBuild())
      dependencies.readPublishSiteState = vi.fn(async () => {
        return { status: "failed", message: "generate が失敗しました" } as PublishJobState
      })

      await expect(runFullBuild(step, dependencies)).rejects.toThrow("generate が失敗しました")
      expect(invalidateSite).not.toHaveBeenCalled()
    })

    test("unknown は job を見失ったとして落とす", async () => {
      const step = new MemoryStep()
      const { dependencies } = createDependencies(loadedForFullBuild())
      dependencies.readPublishSiteState = vi.fn(async () => {
        return { status: "unknown" } as PublishJobState
      })

      await expect(runFullBuild(step, dependencies)).rejects.toThrow(
        "Container が publish job を見失いました",
      )
    })
  })
})
