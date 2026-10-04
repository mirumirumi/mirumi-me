import { describe, expect, test, vi } from "vitest"

import type {
  DeploymentPageState,
  PageRevision,
  PublishJobRequest,
  PublishJobState,
  PublishJobSummary,
  PublishWorkflowParams,
} from "../lib/publishing"
import { BOOTSTRAP_PUBLISH_ERROR_PREFIX, GENERATE_PUBLISH_ERROR_PREFIX } from "../lib/publishing"
import type { PublishFailureNotice, UnpublishedReferenceNotice } from "./notifications"
import {
  type LoadedPublishRequest,
  NOTION_WRITEBACK_CHUNK_SIZE,
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
      lastEditedBy: "00000000-0000-0000-0000-0000000000aa",
      lastDeploy: null,
      lastNotionEdit: "2026-08-24T01:00:00.000Z",
      publishedAt: null,
      updatedAt: null,
      category: { name: "技術", slug: "tech" },
      publishError: "",
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
          fetchedHash: "fetched-hash",
        },
      ],
      failed: [],
      skipped: [],
      stale: [],
      updatedPaths: ["/article-slug/", "/article-slug/index.html"],
      unpublishedReferences: [],
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
    const writeNotionResultsIfUnchanged = vi.fn(async () => undefined)
    const findPagesChangedAfterBuild = vi.fn(async () => [] as Array<string>)
    const notifyFailures = vi.fn(async (_notice: PublishFailureNotice) => undefined)
    const notifyUnpublishedReferences = vi.fn(
      async (_notice: UnpublishedReferenceNotice) => undefined,
    )

    return {
      dependencies: {
        loadRequest,
        publishSite,
        startPublishSite,
        readPublishSiteState,
        invalidateSite,
        loadDeploymentPages,
        writeNotionResults,
        writeNotionResultsIfUnchanged,
        findPagesChangedAfterBuild,
        notifyFailures,
        notifyUnpublishedReferences,
      } satisfies PublishWorkflowDependencies,
      loadRequest,
      publishSite,
      startPublishSite,
      readPublishSiteState,
      invalidateSite,
      loadDeploymentPages,
      writeNotionResults,
      writeNotionResultsIfUnchanged,
      findPagesChangedAfterBuild,
      notifyFailures,
      notifyUnpublishedReferences,
    }
  }

  test("永続 step を通して Container の小さい summary を公開結果へ変換する", async () => {
    const step = new MemoryStep()
    const { dependencies, publishSite, writeNotionResults } = createDependencies({
      revisions: [makeRevision()],
      failed: [],
      skippedPageIds: [],
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
      skippedPageIds: [],
      stalePageIds: [],
    })
    expect(step.calls).toEqual([
      { name: "load-request", config: PUBLISH_WORKFLOW_STEP_CONFIGS.loadRequest },
      { name: "preflight-request", config: PUBLISH_WORKFLOW_STEP_CONFIGS.preflightRequest },
      { name: "publish-site", config: PUBLISH_WORKFLOW_STEP_CONFIGS.publishSite },
      {
        name: "invalidate-cloudfront",
        config: PUBLISH_WORKFLOW_STEP_CONFIGS.invalidateCloudFront,
      },
      {
        name: "confirm-published-pages",
        config: PUBLISH_WORKFLOW_STEP_CONFIGS.confirmPublishedPages,
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

  test("build のあとで本文が直されていたら、🟢 にせず押し直してもらう", async () => {
    const step = new MemoryStep()
    const revision = makeRevision()
    const { dependencies, findPagesChangedAfterBuild, writeNotionResults } = createDependencies({
      revisions: [revision],
      failed: [],
      skippedPageIds: [],
    })
    findPagesChangedAfterBuild.mockResolvedValueOnce([revision.pageId])

    await runPublishWorkflow({ workflowId: "workflow-id", params, step, dependencies })

    expect(findPagesChangedAfterBuild).toHaveBeenCalledWith([
      { pageId: revision.pageId, revision, fetchedHash: "fetched-hash" },
    ])
    expect(dependencies.notifyFailures).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "partial",
        failures: [expect.objectContaining({ pageId: revision.pageId })],
      }),
    )
    // 配信はもう直す前の本文に切り替わっているので、配信の状態は書きつつ 🔴 にする
    expect(writeNotionResults).toHaveBeenCalledWith([
      {
        status: "failed",
        pageId: revision.pageId,
        internalState: "公開中",
        deployedAt: "2026-08-24T02:05:00.000Z",
        publishedAt: "2026-08-24T02:00:00.000Z",
        error:
          "公開の途中で本文が直されたので、直す前の本文で公開しました。もう一度「公開」を押してください（Workflow: workflow-id）",
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
      skippedPageIds: [],
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
      { length: NOTION_WRITEBACK_CHUNK_SIZE + 1 },
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
      skippedPageIds: [],
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
          fetchedHash: "fetched-hash",
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
    expect(writeNotionResults.mock.calls.at(0)?.at(0)).toHaveLength(NOTION_WRITEBACK_CHUNK_SIZE)
    expect(writeNotionResults.mock.calls.at(1)?.at(0)).toHaveLength(1)
  })

  test("bootstrap で失敗した記事は 下書き に戻して、bootstrap で書いたとわかる 公開エラー を書く", async () => {
    const failedPageId = "00000000-0000-0000-0000-000000000002"
    const step = new MemoryStep()
    const { dependencies, readPublishSiteState, loadDeploymentPages, writeNotionResults } =
      createDependencies({
        revisions: [
          makeRevision({ internalState: "公開中", publishedAt: "2026-08-20T00:00:00.000Z" }),
          makeRevision({
            pageId: failedPageId,
            slug: "failed-article",
            internalState: "公開中",
            publishedAt: "2026-08-20T00:00:00.000Z",
          }),
        ],
        failed: [],
        skippedPageIds: [],
      })
    readPublishSiteState.mockResolvedValue({
      status: "done",
      summary: makeSummary({
        failed: [
          {
            pageId: failedPageId,
            code: "publish-failed",
            message: "production render warning: ブックマークを解決できませんでした",
          },
        ],
      }),
    })
    loadDeploymentPages.mockResolvedValueOnce([{ pageId: failedPageId, status: "missing" }])

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

    expect(writeNotionResults).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          status: "published",
          pageId: "00000000-0000-0000-0000-000000000001",
        }),
        {
          status: "failed",
          pageId: failedPageId,
          internalState: "下書き",
          deployedAt: null,
          publishedAt: null,
          error: `${BOOTSTRAP_PUBLISH_ERROR_PREFIX}: production render warning: ブックマークを解決できませんでした（Workflow: workflow-id）`,
        },
      ],
      350,
    )
  })

  test("論理エラーの page を除外して正常な page だけ Container へ渡す", async () => {
    const step = new MemoryStep()
    const invalidPageId = "00000000-0000-0000-0000-000000000002"
    const { dependencies, publishSite, loadDeploymentPages, writeNotionResults } =
      createDependencies({
        revisions: [makeRevision(), makeRevision({ pageId: invalidPageId, title: "" })],
        failed: [],
        skippedPageIds: [],
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
      skippedPageIds: [],
      stalePageIds: [],
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
        skippedPageIds: [],
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
      skippedPageIds: [],
      stalePageIds: [],
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
        skippedPageIds: [],
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
      createDependencies({ revisions: [makeRevision()], failed: [], skippedPageIds: [] })
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
      createDependencies({ revisions: [makeRevision()], failed: [], skippedPageIds: [] })
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

  describe("非公開にした記事を指す記事の通知", () => {
    const unpublishing = makeRevision({
      internalState: "非公開待ち",
      title: "非公開にする記事",
      slug: "gone",
      publishedAt: "2026-08-20T00:00:00.000Z",
    })
    const referrer = {
      pageId: "00000000-0000-0000-0000-000000000002",
      title: "指している記事",
      slug: "referrer",
    }
    const unpublishedSummary = (
      unpublishedReferences: PublishJobSummary["unpublishedReferences"],
    ): PublishJobSummary => {
      return makeSummary({
        pages: [
          {
            pageId: unpublishing.pageId,
            action: "unpublish",
            deployedAt: "2026-08-24T02:05:00.000Z",
            contentHash: null,
          },
        ],
        unpublishedReferences,
      })
    }

    test("非公開にした記事を内部ブログカードで指している記事を、題名をそろえて Slack に知らせる", async () => {
      const step = new MemoryStep()
      const { dependencies, publishSite, notifyUnpublishedReferences } = createDependencies({
        revisions: [unpublishing],
        failed: [],
        skippedPageIds: [],
      })
      publishSite.mockResolvedValue(
        unpublishedSummary([
          { pageId: unpublishing.pageId, route: "/gone/", referrers: [referrer] },
        ]),
      )

      await runPublishWorkflow({ workflowId: "workflow-id", params, step, dependencies })

      expect(notifyUnpublishedReferences).toHaveBeenCalledWith({
        workflowId: "workflow-id",
        pages: [
          {
            pageId: unpublishing.pageId,
            title: "非公開にする記事",
            slug: "gone",
            referrers: [referrer],
          },
        ],
      })
      expect(step.calls.map((call) => call.name)).toContain("notify-unpublished-references")
    })

    test("指している記事がなければ知らせない", async () => {
      const step = new MemoryStep()
      const { dependencies, publishSite, notifyUnpublishedReferences } = createDependencies({
        revisions: [unpublishing],
        failed: [],
        skippedPageIds: [],
      })
      publishSite.mockResolvedValue(unpublishedSummary([]))

      await runPublishWorkflow({ workflowId: "workflow-id", params, step, dependencies })

      expect(notifyUnpublishedReferences).not.toHaveBeenCalled()
    })

    test("知らせられなくても、非公開の結果は失敗にしない", async () => {
      const step = new MemoryStep()
      const { dependencies, publishSite, notifyUnpublishedReferences } = createDependencies({
        revisions: [unpublishing],
        failed: [],
        skippedPageIds: [],
      })
      publishSite.mockResolvedValue(
        unpublishedSummary([
          { pageId: unpublishing.pageId, route: "/gone/", referrers: [referrer] },
        ]),
      )
      notifyUnpublishedReferences.mockRejectedValue(Error("slack unavailable"))

      expect(
        await runPublishWorkflow({ workflowId: "workflow-id", params, step, dependencies }),
      ).toEqual(
        expect.objectContaining({
          status: "completed",
          unpublishedPageIds: [unpublishing.pageId],
        }),
      )
    })
  })

  describe("generate の完了待ち", () => {
    const fullParams: PublishWorkflowParams = {
      mode: "full",
      source: "release",
      requestId: "release-request",
      requestedAt: params.requestedAt,
      pageIds: [],
    }

    const runGenerate = async (step: MemoryStep, dependencies: PublishWorkflowDependencies) => {
      return runPublishWorkflow({
        workflowId: "workflow-id",
        params: fullParams,
        step,
        dependencies,
      })
    }

    const loadedForGenerate = () => {
      return {
        revisions: [
          makeRevision({ internalState: "公開中", publishedAt: "2026-08-20T00:00:00.000Z" }),
        ],
        failed: [],
        skippedPageIds: [],
      }
    }

    test("受け付けと待機を別の step に分ける", async () => {
      const step = new MemoryStep()
      const { dependencies, publishSite, startPublishSite } = createDependencies(
        loadedForGenerate(),
      )

      await runGenerate(step, dependencies)

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
        loadedForGenerate(),
      )
      readPublishSiteState
        .mockResolvedValueOnce({ status: "running" })
        .mockResolvedValueOnce({ status: "running" })

      await runGenerate(step, dependencies)

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
        loadedForGenerate(),
      )
      readPublishSiteState.mockResolvedValue({ status: "running" })

      await expect(runGenerate(step, dependencies)).rejects.toThrow(
        "publish job が 720 回の polling で終わりませんでした",
      )
      expect(readPublishSiteState).toHaveBeenCalledTimes(720)
      expect(step.sleeps).toHaveLength(720)
      expect(invalidateSite).not.toHaveBeenCalled()
    })

    test("failed は Container のメッセージで落とす", async () => {
      const step = new MemoryStep()
      const { dependencies, invalidateSite } = createDependencies(loadedForGenerate())
      dependencies.readPublishSiteState = vi.fn(async () => {
        return { status: "failed", message: "generate が失敗しました" } as PublishJobState
      })

      await expect(runGenerate(step, dependencies)).rejects.toThrow("generate が失敗しました")
      expect(invalidateSite).not.toHaveBeenCalled()
    })

    test("unknown は job を見失ったとして落とす", async () => {
      const step = new MemoryStep()
      const { dependencies } = createDependencies(loadedForGenerate())
      dependencies.readPublishSiteState = vi.fn(async () => {
        return { status: "unknown" } as PublishJobState
      })

      await expect(runGenerate(step, dependencies)).rejects.toThrow(
        "Container が publish job を見失いました",
      )
    })
  })

  describe("generate の記事ごとの結果", () => {
    const fullParams: PublishWorkflowParams = {
      mode: "full",
      source: "release",
      requestId: "release-request",
      requestedAt: params.requestedAt,
      pageIds: [],
    }
    const secondPageId = "00000000-0000-0000-0000-000000000002"

    const published = (overrides: Partial<PageRevision> = {}) => {
      return makeRevision({
        internalState: "公開中",
        publishedAt: "2026-08-20T00:00:00.000Z",
        ...overrides,
      })
    }

    test("Workflow と Container が飛ばした記事を結果に出す", async () => {
      const step = new MemoryStep()
      const { dependencies, readPublishSiteState } = createDependencies({
        revisions: [published(), published({ pageId: secondPageId, slug: "second" })],
        failed: [],
        skippedPageIds: ["00000000-0000-0000-0000-000000000003"],
      })
      readPublishSiteState.mockResolvedValue({
        status: "done",
        summary: makeSummary({ skipped: [secondPageId] }),
      })

      expect(
        await runPublishWorkflow({
          workflowId: "workflow-id",
          params: fullParams,
          step,
          dependencies,
        }),
      ).toEqual({
        workflowId: "workflow-id",
        status: "completed",
        publishedPageIds: ["00000000-0000-0000-0000-000000000001"],
        unpublishedPageIds: [],
        failed: [],
        skippedPageIds: ["00000000-0000-0000-0000-000000000003", secondPageId],
        stalePageIds: [],
      })
    })

    test("最後に公開した版からも作り直せなかった記事を結果に出す", async () => {
      const step = new MemoryStep()
      const { dependencies, readPublishSiteState } = createDependencies({
        revisions: [published()],
        failed: [],
        skippedPageIds: [],
      })
      readPublishSiteState.mockResolvedValue({
        status: "done",
        summary: makeSummary({ stale: [secondPageId] }),
      })

      expect(
        await runPublishWorkflow({
          workflowId: "workflow-id",
          params: fullParams,
          step,
          dependencies,
        }),
      ).toEqual(expect.objectContaining({ status: "completed", stalePageIds: [secondPageId] }))
    })

    test("失敗した記事には generate で書いたとわかる 公開エラー だけを、触られていない記事にだけ書く", async () => {
      const step = new MemoryStep()
      const revisions = [published()]
      const {
        dependencies,
        readPublishSiteState,
        writeNotionResults,
        writeNotionResultsIfUnchanged,
      } = createDependencies({ revisions, failed: [], skippedPageIds: [] })
      readPublishSiteState.mockResolvedValue({
        status: "done",
        summary: makeSummary({
          pages: [],
          failed: [
            {
              pageId: "00000000-0000-0000-0000-000000000001",
              code: "publish-failed",
              message: "production render warning: ブックマークを解決できませんでした",
            },
          ],
        }),
      })

      await runPublishWorkflow({
        workflowId: "workflow-id",
        params: fullParams,
        step,
        dependencies,
      })

      expect(writeNotionResults).not.toHaveBeenCalled()
      expect(writeNotionResultsIfUnchanged).toHaveBeenCalledWith(
        [
          {
            status: "failed",
            pageId: "00000000-0000-0000-0000-000000000001",
            internalState: null,
            deployedAt: null,
            publishedAt: null,
            error: `${GENERATE_PUBLISH_ERROR_PREFIX}: production render warning: ブックマークを解決できませんでした（Workflow: workflow-id）`,
          },
        ],
        revisions,
        350,
      )
      expect(step.calls.find(({ name }) => name === "write-generate-notion-result-0")).toEqual({
        name: "write-generate-notion-result-0",
        config: PUBLISH_WORKFLOW_STEP_CONFIGS.writeGenerateNotionResult,
      })
    })

    test("generate が書いた 公開エラー は成功したら消し、ほかの成功した記事には何も書かない", async () => {
      const step = new MemoryStep()
      const revisions = [
        published({
          publishError: `${GENERATE_PUBLISH_ERROR_PREFIX}: 前回の理由（Workflow: old）`,
        }),
        published({ pageId: secondPageId, slug: "second" }),
      ]
      const { dependencies, readPublishSiteState, writeNotionResultsIfUnchanged } =
        createDependencies({ revisions, failed: [], skippedPageIds: [] })
      readPublishSiteState.mockResolvedValue({
        status: "done",
        summary: makeSummary({
          pages: revisions.map(({ pageId }) => ({
            pageId,
            action: "publish",
            deployedAt: "2026-08-24T02:05:00.000Z",
            publishedAt: "2026-08-20T00:00:00.000Z",
            contentHash: "content-hash",
            updatedAt: null,
            fetchedHash: "fetched-hash",
          })),
        }),
      })

      await runPublishWorkflow({
        workflowId: "workflow-id",
        params: fullParams,
        step,
        dependencies,
      })

      expect(writeNotionResultsIfUnchanged).toHaveBeenCalledWith(
        [{ status: "error-cleared", pageId: "00000000-0000-0000-0000-000000000001" }],
        revisions,
        350,
      )
    })

    test("失敗した記事があれば、題名と理由をそろえて通知する", async () => {
      const step = new MemoryStep()
      const { dependencies, readPublishSiteState, notifyFailures } = createDependencies({
        revisions: [published()],
        failed: [],
        skippedPageIds: [],
      })
      readPublishSiteState.mockResolvedValue({
        status: "done",
        summary: makeSummary({
          pages: [],
          failed: [
            {
              pageId: "00000000-0000-0000-0000-000000000001",
              code: "publish-failed",
              message: "Request to Notion API has timed out",
            },
          ],
        }),
      })

      await runPublishWorkflow({
        workflowId: "workflow-id",
        params: fullParams,
        step,
        dependencies,
      })

      expect(notifyFailures).toHaveBeenCalledWith({
        workflowId: "workflow-id",
        mode: "full",
        failures: [
          {
            pageId: "00000000-0000-0000-0000-000000000001",
            title: "記事タイトル",
            slug: "article-slug",
            message: "Request to Notion API has timed out",
          },
        ],
      })
      expect(step.calls.at(-1)?.name).toEqual("notify-failures")
    })

    test("失敗がなければ通知しない", async () => {
      const step = new MemoryStep()
      const { dependencies, notifyFailures } = createDependencies({
        revisions: [published()],
        failed: [],
        skippedPageIds: [],
      })

      await runPublishWorkflow({
        workflowId: "workflow-id",
        params: fullParams,
        step,
        dependencies,
      })

      expect(notifyFailures).not.toHaveBeenCalled()
    })

    test("通知に失敗しても、公開の結果は失敗にしない", async () => {
      const step = new MemoryStep()
      const { dependencies, notifyFailures } = createDependencies({
        revisions: [published({ title: "" })],
        failed: [],
        skippedPageIds: [],
      })
      notifyFailures.mockRejectedValue(Error("slack unavailable"))

      expect(
        await runPublishWorkflow({
          workflowId: "workflow-id",
          params: fullParams,
          step,
          dependencies,
        }),
      ).toEqual(expect.objectContaining({ status: "completed-with-errors" }))
    })

    test("Container に渡す前に落ちた記事にも 公開エラー を書く", async () => {
      const step = new MemoryStep()
      const revisions = [published({ title: "" })]
      const { dependencies, startPublishSite, writeNotionResultsIfUnchanged } = createDependencies({
        revisions,
        failed: [],
        skippedPageIds: [],
      })

      await runPublishWorkflow({
        workflowId: "workflow-id",
        params: fullParams,
        step,
        dependencies,
      })

      expect(startPublishSite).not.toHaveBeenCalled()
      expect(writeNotionResultsIfUnchanged).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            status: "failed",
            error: `${GENERATE_PUBLISH_ERROR_PREFIX}: title が空です（Workflow: workflow-id）`,
          }),
        ],
        revisions,
        350,
      )
    })
  })
})
