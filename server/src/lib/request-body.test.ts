import { describe, expect, test } from "vitest"

import { readLimitedText } from "./request-body"

describe("readLimitedText", () => {
  test("Content-Length が上限を超えていれば body を読まずに拒否する", async () => {
    const request = new Request("https://example.com", {
      method: "POST",
      headers: { "Content-Length": "101" },
      body: "small",
    })

    expect(await readLimitedText(request, 100)).toEqual(null)
  })

  test("実際の UTF-8 byte 数を上限までに制限する", async () => {
    const accepted = new Request("https://example.com", { method: "POST", body: "あ" })
    const rejected = new Request("https://example.com", { method: "POST", body: "あい" })

    expect(await readLimitedText(accepted, 3)).toEqual("あ")
    expect(await readLimitedText(rejected, 3)).toEqual(null)
  })
})
