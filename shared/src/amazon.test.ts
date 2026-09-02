import { describe, expect, test } from "vitest"

import {
  canonicalizeAmazonShortcode,
  collectAmazonAsins,
  createAmazonCardSignature,
  createAmazonFallbackLinks,
  parseAmazonShortcode,
  verifyAmazonCardSignature,
} from "./amazon"
import { createAmazonHydrationScript } from "./amazon-browser"
import type { ContentBlock } from "./content"

describe("amazon", () => {
  test("legacy size を捨てて canonical attribute 順へ揃える", () => {
    expect(
      canonicalizeAmazonShortcode(
        '[amazon title="商品名" size="l" asin="b000000000" kw="検索 語"]',
      ),
    ).toEqual('[amazon asin="B000000000" kw="検索 語" title="商品名"]')
    expect(canonicalizeAmazonShortcode("[button]")).toEqual(null)
    expect(canonicalizeAmazonShortcode('[amazon asin="invalid"]')).toEqual(null)
    expect(canonicalizeAmazonShortcode('[amazon asin="B000000000"]')).toEqual(null)
  })

  test("asin、kw、title がすべて揃った shortcode だけを読む", () => {
    expect(parseAmazonShortcode('[amazon asin="B000000000" kw="検索語" title="商品名"]')).toEqual({
      asin: "B000000000",
      keyword: "検索語",
      fallbackTitle: "商品名",
    })
    expect(parseAmazonShortcode('[amazon asin="invalid"]')).toEqual(null)
    expect(parseAmazonShortcode('[amazon title="商品名"]')).toEqual(null)
    expect(parseAmazonShortcode('[amazon asin="B000000000" title="商品名"]')).toEqual(null)
    expect(parseAmazonShortcode('[amazon asin="B000000000" kw="検索語"]')).toEqual(null)
  })

  test("Amazon、楽天、Yahoo の fallback link に検索語を安全に埋め込む", () => {
    const links = createAmazonFallbackLinks({
      asin: "B000000000",
      keyword: "猫 & 犬",
      fallbackTitle: "商品名",
    })

    expect(links.amazon).toEqual("https://www.amazon.co.jp/dp/B000000000?tag=milmemo-22")
    const rakutenSearch = new URL(new URL(links.rakuten).searchParams.get("url") ?? "")
    const yahooSearch = new URL(new URL(links.yahoo).searchParams.get("vc_url") ?? "")
    expect(decodeURIComponent(rakutenSearch.pathname)).toEqual("/search/mall/猫 & 犬/")
    expect(yahooSearch.searchParams.get("p")).toEqual("猫 & 犬")
  })

  test("preview 用に同じ browser hydrator を起動する script を生成する", () => {
    const script = createAmazonHydrationScript()

    expect(script).toContain("data-preview-amazon")
    expect(script).toContain("window.location.origin")
    expect(script).toContain("DOMContentLoaded")
    expect(script).toContain("data-amazon-asin")
    expect(script).not.toContain(": string")
  })

  test("ASIN ごとの署名を作り、改変と別 ASIN への流用を拒否する", async () => {
    const signature = await createAmazonCardSignature("B000000000", "secret")

    expect(await verifyAmazonCardSignature("B000000000", signature, "secret")).toEqual(true)
    expect(await verifyAmazonCardSignature("B000000001", signature, "secret")).toEqual(false)
    expect(await verifyAmazonCardSignature("B000000000", `${signature}x`, "secret")).toEqual(false)
  })

  test("記事の入れ子 block から Amazon ASIN を重複なしで集める", () => {
    const blocks: Array<ContentBlock> = [
      {
        id: "first",
        type: "paragraph",
        richText: [
          {
            type: "text",
            content: '[amazon asin="B000000000" kw="検索語" title="商品名"]',
            href: null,
            annotations: {
              bold: false,
              italic: false,
              strikethrough: false,
              underline: false,
              code: false,
              color: "default",
            },
          },
        ],
        children: [
          {
            id: "duplicate",
            type: "paragraph",
            richText: [
              {
                type: "text",
                content: '[amazon asin="B000000000" kw="検索語" title="商品名" size="l"]',
                href: null,
                annotations: {
                  bold: false,
                  italic: false,
                  strikethrough: false,
                  underline: false,
                  code: false,
                  color: "default",
                },
              },
            ],
            children: [],
          },
        ],
      },
    ]

    expect(collectAmazonAsins(blocks)).toEqual(["B000000000"])
  })
})
