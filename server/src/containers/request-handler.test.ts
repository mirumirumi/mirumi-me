import { describe, expect, test, vi } from "vitest"

import type { PublishJobRequest, PublishJobSummary } from "../lib/publishing"
import { BackgroundPublishJobs } from "./background-publish"
import type { ContainerConfig } from "./config"
import { SerialJobQueue } from "./job-queue"
import { createRequestHandler, type RequestHandlerDependencies } from "./request-handler"

describe("createRequestHandler", () => {
  const config: ContainerConfig = {
    appEnv: "dev",
    notionToken: "notion-token",
    notionPostsDataSourceId: "posts",
    notionPagesDataSourceId: "pages",
    notionCommentsDataSourceId: "comments",
    amazonCardSigningSecret: "secret",
    awsRegion: "ap-northeast-1",
    awsAccessKeyId: "access-key",
    awsSecretAccessKey: "secret-key",
    siteBucketName: "site",
    mediaBucketName: "media",
    cloudFrontDistributionId: "distribution",
    thumbnailFunctionUrl: "https://example.com/thumbnail",
    workersApiOrigin: "https://example.com",
  }

  const deferred = () => {
    let resolve: (value: PublishJobSummary) => void = () => {}
    const promise = new Promise<PublishJobSummary>((value) => {
      resolve = value
    })

    return { promise, resolve }
  }

  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const makeSummary = (workflowId: string): PublishJobSummary => {
    return {
      workflowId,
      buildHash: "build-hash",
      pages: [],
      failed: [],
      updatedPaths: ["/*"],
    }
  }

  const makePublishRequest = (
    workflowId: string,
    mode: PublishJobRequest["params"]["mode"],
  ): PublishJobRequest => {
    return {
      workflowId,
      params: {
        mode,
        source: mode === "partial" ? "notion-webhook" : "release",
        requestId: `${workflowId}-request`,
        requestedAt: "2026-09-25T00:00:00.000Z",
        pageIds: [],
      },
      pages: [
        {
          revision: {
            pageId: "00000000-0000-0000-0000-000000000001",
            kind: "post",
            title: "記事タイトル",
            slug: "article-slug",
            internalState: "公開待ち",
            lastEditedTime: "2026-09-25T00:00:00.000Z",
            lastDeploy: null,
            lastNotionEdit: "2026-09-25T00:00:00.000Z",
            publishedAt: null,
            updatedAt: null,
            category: { name: "技術", slug: "tech" },
          },
          action: "publish",
          route: "/article-slug/",
          effectivePublishedAt: "2026-09-25T00:00:00.000Z",
          issues: [],
        },
      ],
    }
  }

  const postPublish = (workflowId: string, mode: PublishJobRequest["params"]["mode"]): Request => {
    return new Request("http://container.internal/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(makePublishRequest(workflowId, mode)),
    })
  }

  const createDependencies = () => {
    const jobs = new SerialJobQueue()
    const runPublishJob = vi.fn(async (request: PublishJobRequest) => {
      return makeSummary(request.workflowId)
    })
    const runCommentRefreshJob = vi.fn(async () => {
      return {
        workflowId: "comment-workflow",
        slug: "article-slug",
        status: "refreshed" as const,
        reason: null,
        pageId: null,
        contentHash: null,
        buildHash: "build-hash",
        updatedPaths: ["/article-slug/"],
      }
    })
    const invalidateSite = vi.fn(async () => undefined)
    const loadDeploymentPageStates = vi.fn(async () => [])
    const dependencies: RequestHandlerDependencies = {
      jobs,
      backgroundPublishJobs: new BackgroundPublishJobs(jobs),
      readConfig: () => config,
      runPublishJob,
      runCommentRefreshJob,
      invalidateSite,
      loadDeploymentPageStates,
    }

    return {
      dependencies,
      handle: createRequestHandler(dependencies),
      runPublishJob,
      runCommentRefreshJob,
      invalidateSite,
    }
  }

  describe("POST /publish", () => {
    test("partial は結果をそのまま返す", async () => {
      const { handle, runPublishJob } = createDependencies()
      const response = await handle(postPublish("workflow-a", "partial"))
      expect(response.status).toEqual(200)
      expect(await response.json()).toEqual(makeSummary("workflow-a"))
      expect(runPublishJob).toHaveBeenCalledTimes(1)
    })

    test("partial が続けて来ても 409 にはせず、両方とも公開する", async () => {
      const { handle, runPublishJob } = createDependencies()
      const [first, second] = await Promise.all([
        handle(postPublish("workflow-a", "partial")),
        handle(postPublish("workflow-b", "partial")),
      ])
      expect([first.status, second.status]).toEqual([200, 200])
      expect(runPublishJob).toHaveBeenCalledTimes(2)
    })

    test("full は待たずに 202 を返す", async () => {
      const { handle } = createDependencies()
      const response = await handle(postPublish("workflow-a", "full"))
      expect(response.status).toEqual(202)
      expect(await response.json()).toEqual({ accepted: true })
      await flush()
    })

    test("full はジョブ末尾で container 用の seed で invalidation を流す", async () => {
      const { handle, invalidateSite } = createDependencies()
      await handle(postPublish("workflow-a", "full"))
      await flush()
      expect(invalidateSite).toHaveBeenCalledWith(config, "container:workflow-a:build-hash", ["/*"])
    })

    test("invalidation が失敗しても build 結果は done として残す", async () => {
      const { dependencies, handle } = createDependencies()
      dependencies.invalidateSite = vi.fn(async () => {
        throw Error("invalidation が失敗しました")
      })
      await createRequestHandler(dependencies)(postPublish("workflow-a", "full"))
      await flush()
      expect(dependencies.backgroundPublishJobs.read("workflow-a")).toEqual({
        status: "done",
        summary: makeSummary("workflow-a"),
      })
      await handle(postPublish("workflow-b", "partial"))
    })

    test("full build 実行中の partial は 409 で断り、キューに積まない", async () => {
      const { dependencies, handle, runPublishJob } = createDependencies()
      const job = deferred()
      runPublishJob.mockImplementationOnce(() => job.promise)
      await handle(postPublish("workflow-a", "full"))
      await flush()
      const response = await handle(postPublish("workflow-b", "partial"))
      expect(response.status).toEqual(409)
      expect(runPublishJob).toHaveBeenCalledTimes(1)
      job.resolve(makeSummary("workflow-a"))
      await flush()
      expect(dependencies.backgroundPublishJobs.read("workflow-a")?.status).toEqual("done")
    })

    test("壊れた body は 400", async () => {
      const { handle } = createDependencies()
      const response = await handle(
        new Request("http://container.internal/publish", { method: "POST", body: "{}" }),
      )
      expect(response.status).toEqual(400)
    })
  })

  describe("POST /comment-refresh", () => {
    const postCommentRefresh = (): Request => {
      return new Request("http://container.internal/comment-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: "comment-workflow",
          requestedAt: "2026-09-25T00:00:00.000Z",
          slug: "article-slug",
        }),
      })
    }

    test("空いているときは結果を返す", async () => {
      const { handle, runCommentRefreshJob } = createDependencies()
      expect((await handle(postCommentRefresh())).status).toEqual(200)
      expect(runCommentRefreshJob).toHaveBeenCalledTimes(1)
    })

    test("full build 実行中は 409 で断る", async () => {
      const { handle, runPublishJob, runCommentRefreshJob } = createDependencies()
      const job = deferred()
      runPublishJob.mockImplementationOnce(() => job.promise)
      await handle(postPublish("workflow-a", "full"))
      await flush()
      expect((await handle(postCommentRefresh())).status).toEqual(409)
      expect(runCommentRefreshJob).not.toHaveBeenCalled()
      job.resolve(makeSummary("workflow-a"))
      await flush()
    })
  })

  describe("GET /jobs", () => {
    const getJobs = (): Request => {
      return new Request("http://container.internal/jobs")
    }

    test("空いていれば busy は false", async () => {
      const { handle } = createDependencies()
      expect(await (await handle(getJobs())).json()).toEqual({ busy: false })
    })

    test("ジョブが走っているあいだは busy が true", async () => {
      const { handle, runPublishJob } = createDependencies()
      const job = deferred()
      runPublishJob.mockImplementationOnce(() => job.promise)
      await handle(postPublish("workflow-a", "full"))
      await flush()
      expect(await (await handle(getJobs())).json()).toEqual({ busy: true })
      job.resolve(makeSummary("workflow-a"))
      await flush()
      expect(await (await handle(getJobs())).json()).toEqual({ busy: false })
    })
  })

  describe("GET /publish-state", () => {
    test("受け付けていない workflowId は unknown", async () => {
      const { handle } = createDependencies()
      const response = await handle(
        new Request("http://container.internal/publish-state?workflowId=workflow-a"),
      )
      expect(await response.json()).toEqual({ status: "unknown" })
    })

    test("workflowId がなければ 400", async () => {
      const { handle } = createDependencies()
      expect((await handle(new Request("http://container.internal/publish-state"))).status).toEqual(
        400,
      )
    })
  })

  describe("GET /health", () => {
    test("ok を返す", async () => {
      const { handle } = createDependencies()
      expect(await (await handle(new Request("http://container.internal/health"))).json()).toEqual({
        status: "ok",
      })
    })
  })

  describe("未知の経路", () => {
    test("404 を返す", async () => {
      const { handle } = createDependencies()
      expect((await handle(new Request("http://container.internal/nope"))).status).toEqual(404)
    })
  })
})
