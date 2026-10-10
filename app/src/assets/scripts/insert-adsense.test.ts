import { afterEach, describe, expect, test, vi } from "vitest"

import { insertAdSense } from "./insert-adsense"

describe("insertAdSense", () => {
  // 先頭と末尾の h2 は対象外なので、h2 が 3 つあると挿入は真ん中の 1 箇所だけになる
  const contentHtml = "<h2>1</h2><p>a</p><h2>2</h2><p>b</p><h2>3</h2>"
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("prd では本番の client ID で広告枠を挿入する", () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    const result = insertAdSense(contentHtml, true)
    expect(result.includes('data-ad-client="ca-pub-2873410957106428"')).toEqual(true)
    expect(result.includes("ca-google")).toEqual(false)
  })

  test("prd 以外ではテスト用の client ID へ差し替える", () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    const result = insertAdSense(contentHtml, false)
    expect(result.includes('data-ad-client="ca-google"')).toEqual(true)
    expect(result.includes("ca-pub-2873410957106428")).toEqual(false)
  })

  test("h2 がなければ何も挿入しない", () => {
    expect(insertAdSense("<p>a</p>", false)).toEqual("<p>a</p>")
  })
})
