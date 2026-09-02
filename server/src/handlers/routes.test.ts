import { Hono } from "hono"
import { describe, expect, test, vi } from "vitest"

// route 表の複製ではなく本物を叩く。ここを複製にすると main.ts 側の Access が外れても検知できない
import { app } from "../app"
import { createNotionWebhookSignature } from "../lib/notion-webhook"
import type { PublishWorkflowParams } from "../lib/publishing"
import type { HonoEnv } from "../lib/types"
import {
  getNotionWebhookVerification,
  NOTION_WEBHOOK_VERIFICATION_KEY,
} from "./notion-webhook-verification"
import { postAdminPublish } from "./publish"

describe("Worker routes", () => {
  const createWorkflow = () => {
    const create = vi.fn(async (options?: { id?: string; params?: PublishWorkflowParams }) => {
      return { id: options?.id ?? "generated-id" }
    })

    return {
      workflow: {
        create,
        createBatch: vi.fn(async () => []),
        get: vi.fn(),
      } as unknown as NonNullable<CloudflareBindings["PUBLISH_WORKFLOW"]>,
      create,
    }
  }

  test("preview と admin route は Access assertion がなければ通さない", async () => {
    const env = {
      ACCESS_PREVIEW_AUD: "preview-audience",
      ACCESS_ADMIN_AUD: "admin-audience",
      ACCESS_LOCAL_DEV_AUD: "local-dev-audience",
      ACCESS_TEAM_DOMAIN: "https://example.cloudflareaccess.com",
      APP_ENV: "dev" as const,
    }

    expect((await app.request("/preview?pageId=invalid", {}, env)).status).toEqual(401)
    expect(
      (
        await app.request(
          "/admin/publish",
          { method: "POST", body: JSON.stringify({ pageIds: ["invalid"] }) },
          env,
        )
      ).status,
    ).toEqual(401)
    expect((await app.request("/admin/notion-webhook-verification", {}, env)).status).toEqual(401)
    expect((await app.request("/admin/workflows/instance-id", {}, env)).status).toEqual(401)
    expect(
      (
        await app.request(
          "/_dev/x-post",
          { method: "POST", body: JSON.stringify({ postId: "1234567890" }) },
          env,
        )
      ).status,
    ).toEqual(401)
  })

  test("production の development endpoint は Access より先に 404 にする", async () => {
    expect(
      (
        await app.request(
          "/_dev/x-post",
          { method: "POST", body: JSON.stringify({ postId: "1234567890" }) },
          { APP_ENV: "prd" },
        )
      ).status,
    ).toEqual(404)
  })

  test("Notion の初回 verification token は一時保存し response や log に含めない", async () => {
    const put = vi.fn(async () => undefined)
    const response = await app.request(
      "/webhooks/notion",
      {
        method: "POST",
        body: JSON.stringify({ verification_token: "do-not-log" }),
      },
      {
        CONTENT_CACHE: { put } as unknown as KVNamespace,
        RATE_LIMITER_60_PER_MINUTE: { limit: async () => ({ success: true }) } as RateLimit,
      },
    )

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ status: "verification-received" })
    expect(put).toHaveBeenCalledWith(NOTION_WEBHOOK_VERIFICATION_KEY, "do-not-log", {
      expirationTtl: 600,
    })
  })

  test("Access 配下の endpoint から verification token を一度だけ取得する", async () => {
    const get = vi.fn(async () => "verification-token")
    const deleteToken = vi.fn(async () => undefined)
    const handlerApp = new Hono<HonoEnv>().get("/admin/notion-webhook-verification", (c) =>
      getNotionWebhookVerification(c),
    )
    const response = await handlerApp.request(
      "/admin/notion-webhook-verification",
      {},
      {
        CONTENT_CACHE: {
          get,
          delete: deleteToken,
        } as unknown as KVNamespace,
      },
    )

    expect(response.status).toEqual(200)
    expect(response.headers.get("Cache-Control")).toEqual("no-store")
    expect(await response.json()).toEqual({ verificationToken: "verification-token" })
    expect(deleteToken).toHaveBeenCalledWith(NOTION_WEBHOOK_VERIFICATION_KEY)
  })

  test("Webhook signature が不正なら 401 にする", async () => {
    const response = await app.request(
      "/webhooks/notion",
      {
        method: "POST",
        headers: { "X-Notion-Signature": "sha256=invalid" },
        body: JSON.stringify({ type: "page.content_updated" }),
      },
      { NOTION_WEBHOOK_SECRET: "secret" },
    )

    expect(response.status).toEqual(401)
  })

  test("internal-state 以外の署名済み更新は Workflow を起動しない", async () => {
    const rawBody = JSON.stringify({
      id: "event-id",
      timestamp: "2026-08-24T01:00:00.000Z",
      type: "page.properties_updated",
      entity: { id: "00000000-0000-0000-0000-000000000001", type: "page" },
      data: { updated_properties: ["title"] },
    })
    const signature = await createNotionWebhookSignature(rawBody, "secret")
    const response = await app.request(
      "/webhooks/notion",
      {
        method: "POST",
        headers: { "X-Notion-Signature": signature },
        body: rawBody,
      },
      {
        NOTION_WEBHOOK_SECRET: "secret",
        NOTION_INTERNAL_STATE_PROPERTY_ID: "o=BU",
      },
    )

    expect(response.status).toEqual(200)
    expect(await response.json()).toEqual({ status: "ignored" })
  })

  test("admin publish は page ID を正規化・重複除去して 202 を返す", async () => {
    const { workflow, create } = createWorkflow()
    const handlerApp = new Hono<HonoEnv>().post("/admin/publish", (c) => postAdminPublish(c))
    const response = await handlerApp.request(
      "/admin/publish",
      {
        method: "POST",
        body: JSON.stringify({
          pageIds: ["00000000000000000000000000000001", "00000000-0000-0000-0000-000000000001"],
        }),
      },
      { PUBLISH_WORKFLOW: workflow },
    )

    expect(response.status).toEqual(202)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0]?.params?.pageIds).toEqual([
      "00000000-0000-0000-0000-000000000001",
    ])
  })

  test("admin publish の JSON と page ID を検証する", async () => {
    const handlerApp = new Hono<HonoEnv>().post("/admin/publish", (c) => postAdminPublish(c))

    expect(
      (await handlerApp.request("/admin/publish", { method: "POST", body: "{" })).status,
    ).toEqual(400)
    expect(
      (
        await handlerApp.request("/admin/publish", {
          method: "POST",
          body: JSON.stringify({ pageIds: ["invalid"] }),
        })
      ).status,
    ).toEqual(400)
  })
})
