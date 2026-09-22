import { describe, expect, test } from "vitest"

import {
  createNotionWebhookSignature,
  normalizeNotionPropertyId,
  parseNotionWebhookBody,
  verifyNotionWebhookSignature,
} from "./notion-webhook"

describe("notion-webhook", () => {
  describe("verifyNotionWebhookSignature", () => {
    test("raw body の HMAC-SHA256 を検証する", async () => {
      const rawBody = '{"type":"page.properties_updated","value":"日本語"}'
      const signature = await createNotionWebhookSignature(rawBody, "verification-secret")

      expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)
      expect(await verifyNotionWebhookSignature(rawBody, signature, "verification-secret")).toEqual(
        true,
      )
      expect(
        await verifyNotionWebhookSignature(`${rawBody} `, signature, "verification-secret"),
      ).toEqual(false)
      expect(
        await verifyNotionWebhookSignature(rawBody, "sha256=invalid", "verification-secret"),
      ).toEqual(false)
    })
  })

  describe("parseNotionWebhookBody", () => {
    test("初回 verification token を通常 event と分ける", () => {
      expect(parseNotionWebhookBody('{"verification_token":"secret-do-not-log"}')).toEqual({
        kind: "verification",
        verificationToken: "secret-do-not-log",
      })
    })

    test("page.properties_updated の必要な値だけを検証する", () => {
      expect(
        parseNotionWebhookBody(
          JSON.stringify({
            id: "event-id",
            timestamp: "2026-08-24T01:00:00.000Z",
            type: "page.properties_updated",
            entity: {
              id: "00000000-0000-0000-0000-000000000001",
              type: "page",
            },
            data: {
              parent: { id: "parent-id", type: "database" },
              updated_properties: ["o=BU"],
            },
            ignored_by_worker: true,
          }),
        ),
      ).toEqual({
        kind: "event",
        event: {
          id: "event-id",
          timestamp: "2026-08-24T01:00:00.000Z",
          type: "page.properties_updated",
          entity: {
            id: "00000000-0000-0000-0000-000000000001",
            type: "page",
          },
          data: { updated_properties: ["o=BU"] },
        },
      })
    })

    test("対象外 event は body 全体を保持せず ignored にする", () => {
      expect(
        parseNotionWebhookBody(
          JSON.stringify({ type: "page.content_updated", secret_like_value: "discard" }),
        ),
      ).toEqual({ kind: "ignored", type: "page.content_updated", reason: null })
    })

    test("壊れた JSON は拒否し、対象 event の不正 schema は理由付きで ignored にする", () => {
      expect(() => parseNotionWebhookBody("{")).toThrow("Webhook body が JSON ではありません")
      expect(() => parseNotionWebhookBody(JSON.stringify({ no: "type" }))).toThrow(
        "Webhook event の schema が不正です",
      )
      // 4xx を返し続けると Notion が配信を止めるので、署名済みの event は schema 違いでも 200 で捨てる
      const ignored = parseNotionWebhookBody(
        JSON.stringify({
          type: "page.properties_updated",
          entity: { id: "page-id", type: "page" },
          data: { updated_properties: [] },
        }),
      )
      expect(ignored.kind).toEqual("ignored")
      expect(ignored.kind === "ignored" && ignored.reason).toContain("id")
    })
  })

  describe("normalizeNotionPropertyId", () => {
    test("URL encode 済みと raw property ID を同じ値にする", () => {
      expect(normalizeNotionPropertyId("o%3DBU")).toEqual("o=BU")
      expect(normalizeNotionPropertyId("o=BU")).toEqual("o=BU")
      expect(normalizeNotionPropertyId("%invalid")).toEqual(null)
    })
  })
})
