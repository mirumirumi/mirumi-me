import { describe, expect, test, vi } from "vitest"

import type { CommentRefreshJobSummary, CommentRefreshWorkflowParams } from "../lib/comment-refresh"
import {
  COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS,
  type CommentRefreshWorkflowDependencies,
  type LoadedComment,
  runCommentRefreshWorkflow,
} from "./comment-refresh-workflow"
import type { WorkflowStepExecutor } from "./publish-workflow"

describe("runCommentRefreshWorkflow", () => {
  class MemoryStep implements WorkflowStepExecutor {
    calls: Array<{ name: string; config: unknown }> = []

    async do<T>(name: string, config: unknown, callback: () => Promise<T>): Promise<T> {
      this.calls.push({ name, config })

      return callback()
    }
  }
  const params: CommentRefreshWorkflowParams = {
    source: "notion-webhook",
    requestId: "event-id",
    requestedAt: "2026-09-21T00:00:00.000Z",
    commentPageId: "00000000-0000-0000-0000-000000000001",
  }
  const summary = (
    overrides: Partial<CommentRefreshJobSummary> = {},
  ): CommentRefreshJobSummary => ({
    workflowId: "event-id",
    slug: "article",
    status: "refreshed",
    reason: null,
    pageId: "00000000-0000-0000-0000-000000000009",
    contentHash: "hash",
    buildHash: "build-hash",
    updatedPaths: ["/article", "/article/*"],
    ...overrides,
  })
  const createDependencies = (
    loaded: LoadedComment | null,
    overrides: Partial<CommentRefreshWorkflowDependencies> = {},
  ): CommentRefreshWorkflowDependencies => ({
    loadComment: vi.fn(async () => loaded),
    refreshComments: vi.fn(async () => summary()),
    invalidateSite: vi.fn(async () => undefined),
    writeRefreshError: vi.fn(async () => undefined),
    writeSlug: vi.fn(async () => undefined),
    ...overrides,
  })

  test("row の slug で Container を呼び、更新した route だけ invalidation する", async () => {
    const step = new MemoryStep()
    const dependencies = createDependencies({
      slug: "article",
      slugInherited: false,
      refreshError: null,
    })

    expect(
      await runCommentRefreshWorkflow({ workflowId: "event-id", params, step, dependencies }),
    ).toEqual({
      workflowId: "event-id",
      commentPageId: params.commentPageId,
      slug: "article",
      status: "refreshed",
    })
    expect(dependencies.refreshComments).toHaveBeenCalledWith({
      workflowId: "event-id",
      requestedAt: params.requestedAt,
      slug: "article",
    })
    expect(dependencies.invalidateSite).toHaveBeenCalledWith(summary())
    expect(dependencies.writeRefreshError).not.toHaveBeenCalled()
    expect(dependencies.writeSlug).not.toHaveBeenCalled()
    expect(step.calls).toEqual([
      { name: "load-comment", config: COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS.loadComment },
      { name: "refresh-comments", config: COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS.refreshComments },
      {
        name: "invalidate-cloudfront",
        config: COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS.invalidateCloudFront,
      },
    ])
  })

  test("前回の 反映エラー が残っていれば成功時に消す", async () => {
    const dependencies = createDependencies({
      slug: "article",
      slugInherited: false,
      refreshError: "前回の失敗",
    })

    await runCommentRefreshWorkflow({
      workflowId: "event-id",
      params,
      step: new MemoryStep(),
      dependencies,
    })

    expect(dependencies.writeRefreshError).toHaveBeenCalledWith(params.commentPageId, null)
  })

  test("変更なし・非公開記事は invalidation も Notion 書き込みもしない", async () => {
    for (const status of ["unchanged", "skipped"] as const) {
      const dependencies = createDependencies(
        { slug: "article", slugInherited: false, refreshError: null },
        { refreshComments: vi.fn(async () => summary({ status, updatedPaths: [] })) },
      )

      expect(
        (
          await runCommentRefreshWorkflow({
            workflowId: "event-id",
            params,
            step: new MemoryStep(),
            dependencies,
          })
        ).status,
      ).toEqual(status)
      expect(dependencies.invalidateSite).not.toHaveBeenCalled()
      expect(dependencies.writeRefreshError).not.toHaveBeenCalled()
    }
  })

  test("comments の row でなければ何もしない", async () => {
    const dependencies = createDependencies(null)

    expect(
      (
        await runCommentRefreshWorkflow({
          workflowId: "event-id",
          params,
          step: new MemoryStep(),
          dependencies,
        })
      ).status,
    ).toEqual("skipped")
    expect(dependencies.refreshComments).not.toHaveBeenCalled()
  })

  test("親から継いだ slug は Container を呼ぶ前に row へ書き戻す", async () => {
    const step = new MemoryStep()
    const dependencies = createDependencies({
      slug: "article",
      slugInherited: true,
      refreshError: null,
    })

    expect(
      (await runCommentRefreshWorkflow({ workflowId: "event-id", params, step, dependencies }))
        .status,
    ).toEqual("refreshed")
    expect(dependencies.writeSlug).toHaveBeenCalledWith(params.commentPageId, "article")
    expect(step.calls.map(({ name }) => name)).toEqual([
      "load-comment",
      "write-notion-slug",
      "refresh-comments",
      "invalidate-cloudfront",
    ])
    expect(step.calls[1]?.config).toEqual(COMMENT_REFRESH_WORKFLOW_STEP_CONFIGS.writeNotionResult)
  })

  test("slug の書き戻しに失敗したら 反映エラー に残して再送出する", async () => {
    const dependencies = createDependencies(
      { slug: "article", slugInherited: true, refreshError: null },
      { writeSlug: vi.fn(async () => Promise.reject(Error("boom"))) },
    )

    await expect(
      runCommentRefreshWorkflow({
        workflowId: "event-id",
        params,
        step: new MemoryStep(),
        dependencies,
      }),
    ).rejects.toThrowError("boom")
    expect(dependencies.writeRefreshError).toHaveBeenCalledWith(
      params.commentPageId,
      "slug の書き戻しに失敗しました: boom（Workflow: event-id）",
    )
    expect(dependencies.refreshComments).not.toHaveBeenCalled()
  })

  test("slug が無い row には 反映エラー を残して終える", async () => {
    const dependencies = createDependencies({ slug: "", slugInherited: false, refreshError: null })

    await runCommentRefreshWorkflow({
      workflowId: "event-id",
      params,
      step: new MemoryStep(),
      dependencies,
    })

    expect(dependencies.writeRefreshError).toHaveBeenCalledWith(
      params.commentPageId,
      "記事 slug がありません（Workflow: event-id）",
    )
    expect(dependencies.refreshComments).not.toHaveBeenCalled()
  })

  test("Container の失敗は 反映エラー に理由を書いてから再送出する", async () => {
    const dependencies = createDependencies(
      { slug: "article", slugInherited: false, refreshError: null },
      { refreshComments: vi.fn(async () => Promise.reject(Error("snapshot がありません"))) },
    )

    await expect(
      runCommentRefreshWorkflow({
        workflowId: "event-id",
        params,
        step: new MemoryStep(),
        dependencies,
      }),
    ).rejects.toThrowError("snapshot がありません")
    expect(dependencies.writeRefreshError).toHaveBeenCalledWith(
      params.commentPageId,
      "反映に失敗しました: snapshot がありません（Workflow: event-id）",
    )
  })

  test("別の結果が返ったら deploy 済みでも成功扱いにしない", async () => {
    const dependencies = createDependencies(
      { slug: "article", slugInherited: false, refreshError: null },
      { refreshComments: vi.fn(async () => summary({ slug: "other" })) },
    )

    await expect(
      runCommentRefreshWorkflow({
        workflowId: "event-id",
        params,
        step: new MemoryStep(),
        dependencies,
      }),
    ).rejects.toThrowError("別の comment refresh")
  })

  test("invalidation の失敗も 反映エラー に残す", async () => {
    const dependencies = createDependencies(
      { slug: "article", slugInherited: false, refreshError: null },
      { invalidateSite: vi.fn(async () => Promise.reject(Error("cloudfront"))) },
    )

    await expect(
      runCommentRefreshWorkflow({
        workflowId: "event-id",
        params,
        step: new MemoryStep(),
        dependencies,
      }),
    ).rejects.toThrowError("cloudfront")
    expect(dependencies.writeRefreshError).toHaveBeenCalledWith(
      params.commentPageId,
      "CloudFront の更新に失敗しました（Workflow: event-id）",
    )
  })
})
