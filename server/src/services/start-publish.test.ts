import { describe, expect, test, vi } from "vitest"

import {
  type PublishWorkflowBinding,
  startAdminPublish,
  startWebhookPublish,
} from "./start-publish"

describe("start-publish", () => {
  const createBinding = () => {
    const create = vi.fn(async ({ id }: { id: string }) => ({ id }))
    const createBatch = vi.fn(async (batch: Array<{ id: string }>) => {
      return batch.map(({ id }) => ({ id }))
    })

    return {
      binding: { create, createBatch } as PublishWorkflowBinding,
      create,
      createBatch,
    }
  }

  test("Webhook event ID を instance ID にして idempotent な createBatch を使う", async () => {
    const { binding, create, createBatch } = createBinding()

    expect(
      await startWebhookPublish(binding, {
        eventId: "event-id",
        pageId: "00000000-0000-0000-0000-000000000001",
        requestedAt: "2026-08-24T01:00:00.000Z",
      }),
    ).toEqual({ workflowId: "event-id", created: true })
    expect(create).not.toHaveBeenCalled()
    expect(createBatch).toHaveBeenCalledWith([
      {
        id: "event-id",
        params: {
          mode: "partial",
          source: "notion-webhook",
          requestId: "event-id",
          requestedAt: "2026-08-24T01:00:00.000Z",
          pageIds: ["00000000-0000-0000-0000-000000000001"],
        },
      },
    ])
  })

  test("既存 Webhook instance が skip された場合も正常な duplicate にする", async () => {
    const { binding, createBatch } = createBinding()
    createBatch.mockResolvedValueOnce([])

    expect(
      await startWebhookPublish(binding, {
        eventId: "event-id",
        pageId: "00000000-0000-0000-0000-000000000001",
        requestedAt: "2026-08-24T01:00:00.000Z",
      }),
    ).toEqual({ workflowId: "event-id", created: false })
  })

  test("admin request は複数 page を 1 Workflow instance にまとめる", async () => {
    const { binding, create } = createBinding()

    expect(
      await startAdminPublish(binding, {
        workflowId: "admin-request-id",
        requestId: "request-id",
        requestedAt: "2026-08-24T02:00:00.000Z",
        pageIds: ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"],
      }),
    ).toEqual({ workflowId: "admin-request-id", created: true })
    expect(create).toHaveBeenCalledWith({
      id: "admin-request-id",
      params: {
        mode: "partial",
        source: "admin",
        requestId: "request-id",
        requestedAt: "2026-08-24T02:00:00.000Z",
        pageIds: ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"],
      },
    })
  })
})
