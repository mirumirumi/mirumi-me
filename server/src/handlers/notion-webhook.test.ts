import { Hono } from "hono"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { InvalidNotionPageRevisionError } from "shared/notion"

import { createNotionWebhookSignature } from "../lib/notion-webhook"
import type { HonoEnv } from "../lib/types"
import { handleNotionWebhook } from "./notion-webhook"

const fetchCommentState = vi.hoisted(() => vi.fn())
const fetchNotionPageRevision = vi.hoisted(() => vi.fn())

vi.mock("shared/notion-comments", async (importOriginal) => {
  return { ...(await importOriginal<typeof import("shared/notion-comments")>()), fetchCommentState }
})
vi.mock("shared/notion", async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import("shared/notion")>()),
    createNotionClient: () => ({}),
    fetchNotionPageRevision,
  }
})

describe("Notion webhook comment routing", () => {
  const secret = "secret"
  const pageId = "00000000-0000-0000-0000-000000000001"
  const createWorkflowBinding = () => {
    const createBatch = vi.fn(async (options: Array<{ id: string }>) => {
      return options.map(({ id }) => ({ id }))
    })

    return { createBatch }
  }
  const createEnv = (overrides: Record<string, unknown> = {}) => {
    const commentRefreshWorkflow = createWorkflowBinding()
    const publishWorkflow = createWorkflowBinding()

    return {
      env: {
        NOTION_WEBHOOK_SECRET: secret,
        NOTION_TOKEN: "notion-token",
        NOTION_INTERNAL_STATE_PROPERTY_ID: "o=BU",
        NOTION_POSTS_DATA_SOURCE_ID: "posts",
        NOTION_PAGES_DATA_SOURCE_ID: "pages",
        NOTION_COMMENTS_DATA_SOURCE_ID: "comments",
        NOTION_COMMENT_STATE_PROPERTY_ID: "PkBpQQ",
        NOTION_COMMENT_CONTENT_PROPERTY_ID: "%3E%5Cb",
        NOTION_COMMENT_AUTHOR_PROPERTY_ID: "title",
        NOTION_COMMENT_PARENT_PROPERTY_ID: "Sj1NYw",
        PUBLISH_WORKFLOW: publishWorkflow,
        COMMENT_REFRESH_WORKFLOW: commentRefreshWorkflow,
        ...overrides,
      } as unknown as CloudflareBindings,
      commentRefreshWorkflow,
      publishWorkflow,
    }
  }
  const app = new Hono<HonoEnv>().post("/webhooks/notion", (c) => handleNotionWebhook(c, null))
  const send = async (event: unknown, env: CloudflareBindings) => {
    const rawBody = JSON.stringify(event)

    return app.request(
      "/webhooks/notion",
      {
        method: "POST",
        headers: { "X-Notion-Signature": await createNotionWebhookSignature(rawBody, secret) },
        body: rawBody,
      },
      env,
    )
  }
  const propertiesUpdated = (updatedProperties: Array<string>) => ({
    id: "event-id",
    timestamp: "2026-09-21T00:00:00.000Z",
    type: "page.properties_updated",
    entity: { id: pageId, type: "page" },
    data: { updated_properties: updatedProperties },
  })
  const pageCreated = {
    id: "created-event-id",
    timestamp: "2026-09-21T00:00:00.000Z",
    type: "page.created",
    entity: { id: pageId, type: "page" },
  }

  beforeEach(() => {
    fetchCommentState.mockReset()
    fetchNotionPageRevision.mockReset()
  })

  test("comments の property 更新は row を確認して comment refresh を起動する", async () => {
    fetchCommentState.mockResolvedValueOnce({ pageId, state: "approved" })
    const { env, commentRefreshWorkflow, publishWorkflow } = createEnv()
    const response = await send(propertiesUpdated(["%3E%5Cb"]), env)

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ status: "accepted", workflowId: "event-id" })
    expect(fetchCommentState).toHaveBeenCalledWith({}, "comments", "PkBpQQ", pageId)
    expect(commentRefreshWorkflow.createBatch).toHaveBeenCalledWith([
      {
        id: "event-id",
        params: {
          source: "notion-webhook",
          requestId: "event-id",
          requestedAt: "2026-09-21T00:00:00.000Z",
          commentPageId: pageId,
        },
      },
    ])
    expect(publishWorkflow.createBatch).not.toHaveBeenCalled()
    expect(fetchNotionPageRevision).not.toHaveBeenCalled()
  })

  test("非表示（pending / spam）への変更も refresh の対象にする", async () => {
    fetchCommentState.mockResolvedValueOnce({ pageId, state: "spam" })
    const { env, commentRefreshWorkflow } = createEnv()

    expect((await send(propertiesUpdated(["PkBpQQ"]), env)).status).toEqual(200)
    expect(commentRefreshWorkflow.createBatch).toHaveBeenCalledTimes(1)
  })

  test("page.created は承認済みの comments 行だけを対象にする", async () => {
    fetchCommentState
      .mockResolvedValueOnce({ pageId, state: "pending" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ pageId, state: "approved" })
    const { env, commentRefreshWorkflow } = createEnv()

    expect(await (await send(pageCreated, env)).json()).toEqual({ status: "ignored" })
    expect(await (await send(pageCreated, env)).json()).toEqual({ status: "ignored" })
    expect(await (await send(pageCreated, env)).json()).toEqual({
      status: "accepted",
      workflowId: "created-event-id",
    })
    expect(commentRefreshWorkflow.createBatch).toHaveBeenCalledTimes(1)
  })

  test("integration 自身（bot だけ）が起こした event は comments の refresh を起動しない", async () => {
    const { env, commentRefreshWorkflow } = createEnv()
    const bot = [{ id: "bot-id", type: "bot" }]

    expect(await (await send({ ...pageCreated, authors: bot }, env)).json()).toEqual({
      status: "ignored",
    })
    expect(
      await (await send({ ...propertiesUpdated(["PkBpQQ"]), authors: bot }, env)).json(),
    ).toEqual({
      status: "ignored",
    })
    expect(fetchCommentState).not.toHaveBeenCalled()
    expect(commentRefreshWorkflow.createBatch).not.toHaveBeenCalled()

    // person が混ざっていれば従来どおり。知らない type（agent など）も bot ではないので同じ扱い
    fetchCommentState.mockResolvedValue({ pageId, state: "approved" })
    expect(
      await (
        await send({ ...pageCreated, authors: [...bot, { id: "user", type: "person" }] }, env)
      ).json(),
    ).toEqual({ status: "accepted", workflowId: "created-event-id" })
    expect(
      await (await send({ ...pageCreated, authors: [{ id: "agent", type: "agent" }] }, env)).json(),
    ).toEqual({ status: "accepted", workflowId: "created-event-id" })
  })

  test("通知日時 や 反映エラー だけの更新は Notion を読まずに無視する", async () => {
    const { env, commentRefreshWorkflow } = createEnv()

    expect(await (await send(propertiesUpdated(["notified", "error"]), env)).json()).toEqual({
      status: "ignored",
    })
    expect(fetchCommentState).not.toHaveBeenCalled()
    expect(commentRefreshWorkflow.createBatch).not.toHaveBeenCalled()
  })

  test("comments の property ID が未設定なら comments の更新は購読しない", async () => {
    const { env } = createEnv({
      NOTION_COMMENT_STATE_PROPERTY_ID: "",
      NOTION_COMMENT_CONTENT_PROPERTY_ID: "",
      NOTION_COMMENT_AUTHOR_PROPERTY_ID: "",
      NOTION_COMMENT_PARENT_PROPERTY_ID: "",
    })

    expect(await (await send(propertiesUpdated(["PkBpQQ"]), env)).json()).toEqual({
      status: "ignored",
    })
    expect(await (await send(pageCreated, env)).json()).toEqual({ status: "ignored" })
    expect(fetchCommentState).not.toHaveBeenCalled()
  })

  test("internal-state と同じ property ID が comments 側にもあるときは posts でなければ comments を疑う", async () => {
    fetchNotionPageRevision.mockRejectedValueOnce(new InvalidNotionPageRevisionError("not posts"))
    fetchCommentState.mockResolvedValueOnce({ pageId, state: "approved" })
    const { env, commentRefreshWorkflow, publishWorkflow } = createEnv({
      NOTION_COMMENT_STATE_PROPERTY_ID: "o=BU",
    })

    expect(await (await send(propertiesUpdated(["o%3DBU"]), env)).json()).toEqual({
      status: "accepted",
      workflowId: "event-id",
    })
    expect(publishWorkflow.createBatch).not.toHaveBeenCalled()
    expect(commentRefreshWorkflow.createBatch).toHaveBeenCalledTimes(1)
  })

  test("internal-state の更新は従来どおり publish Workflow を起動する", async () => {
    fetchNotionPageRevision.mockResolvedValueOnce({ internalState: "公開待ち" })
    const { env, commentRefreshWorkflow, publishWorkflow } = createEnv()

    expect(await (await send(propertiesUpdated(["o%3DBU"]), env)).json()).toEqual({
      status: "accepted",
      workflowId: "event-id",
    })
    expect(publishWorkflow.createBatch).toHaveBeenCalledTimes(1)
    expect(commentRefreshWorkflow.createBatch).not.toHaveBeenCalled()
  })
})
