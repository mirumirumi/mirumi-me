import { describe, expect, test, vi } from "vitest"

import { createSlackNotifier } from "./slack"

describe("createSlackNotifier", () => {
  test("Incoming Webhook へ text を JSON で送る", async () => {
    const fetcher = vi.fn(async (_input: string, _init?: RequestInit) => new Response("ok"))
    const notify = createSlackNotifier("https://hooks.slack.com/services/example", fetcher)

    await notify("本文")

    expect(fetcher).toHaveBeenCalledWith("https://hooks.slack.com/services/example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "本文" }),
    })
  })

  test("Slack が受け付けなければ例外にする", async () => {
    const notify = createSlackNotifier(
      "https://hooks.slack.com/services/example",
      async () => new Response("invalid_payload", { status: 400 }),
    )

    await expect(notify("本文")).rejects.toThrow("Slack への通知に失敗しました: 400")
  })
})
