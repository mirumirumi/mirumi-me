import { describe, expect, test, vi } from "vitest"

import { createSesEmailSender } from "./ses"

describe("createSesEmailSender", () => {
  const credentials = { accessKeyId: "AKID", secretAccessKey: "secret" }

  test("SES v2 の SendEmail に署名付き JSON を送る", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ MessageId: "id" }))
    const send = createSesEmailSender({ fetcher, region: "ap-northeast-1", credentials })

    await send({ from: "a@example.com", to: "b@example.com", subject: "件名", text: "本文" })

    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toEqual(
      "https://email.ap-northeast-1.amazonaws.com/v2/email/outbound-emails",
    )
    expect(init?.method).toEqual("POST")
    expect(JSON.parse(init?.body as string)).toEqual({
      FromEmailAddress: "a@example.com",
      Destination: { ToAddresses: ["b@example.com"] },
      Content: {
        Simple: {
          Subject: { Data: "件名", Charset: "UTF-8" },
          Body: { Text: { Data: "本文", Charset: "UTF-8" } },
        },
      },
    })
    const headers = init?.headers as Record<string, string>
    expect(headers["content-type"]).toEqual("application/json")
    expect(headers.authorization).toMatch(/\/ap-northeast-1\/ses\/aws4_request, /)
  })

  test("HTTP エラーは status だけを持つ例外にする", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{"message":"Email address is not verified"}', { status: 400 }),
      )
    const send = createSesEmailSender({ fetcher, region: "ap-northeast-1", credentials })

    await expect(
      send({ from: "a@example.com", to: "b@example.com", subject: "件名", text: "本文" }),
    ).rejects.toThrowError("SES SendEmail が失敗しました: 400")
  })
})
