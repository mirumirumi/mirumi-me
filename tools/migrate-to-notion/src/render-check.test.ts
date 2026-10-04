import type { BlockObjectRequest } from "@notionhq/client"
import { describe, expect, test, vi } from "vitest"

import { checkConvertedRender } from "./render-check"
import type { NotionPageInput } from "./types"

describe("checkConvertedRender", () => {
  const page = (
    sourceId: number,
    slug: string,
    children: Array<BlockObjectRequest>,
  ): NotionPageInput => {
    return {
      sourceId,
      slug,
      parent: { type: "data_source_id", data_source_id: "posts" },
      properties: {},
      children,
      warnings: [],
    }
  }

  const bookmark = (url: string): BlockObjectRequest => {
    return { object: "block", type: "bookmark", bookmark: { url, caption: [] } }
  }

  test("内部ブログカードは、投入する記事と固定ページの route で照合し、ないものだけを warning にする", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const result = await checkConvertedRender([
      {
        kind: "post",
        page: page(1, "referrer", [
          bookmark("https://mirumi.me/exists/"),
          bookmark("https://mirumi.me/profile/"),
          bookmark("https://mirumi.me/missing/"),
        ]),
      },
      { kind: "post", page: page(2, "exists", []) },
      { kind: "page", page: page(3, "profile", []) },
    ])
    warn.mockRestore()

    expect(result).toEqual([
      {
        sourceId: 1,
        slug: "referrer",
        warnings: [expect.stringContaining("ブックマークを解決できませんでした")],
      },
    ])
  })

  test("外部のブログカードと X ポストは、外を見ずに解決できたものとして扱う", async () => {
    expect(
      await checkConvertedRender([
        {
          kind: "post",
          page: page(1, "external", [
            bookmark("https://example.com/article"),
            {
              object: "block",
              type: "embed",
              embed: { url: "https://x.com/mirumi/status/1234567890", caption: [] },
            },
          ]),
        },
      ]),
    ).toEqual([])
  })

  test("入れ子の子やリッチテキストも Notion が返す形にそろえて描き、render の warning をそのまま返す", async () => {
    expect(
      await checkConvertedRender([
        {
          kind: "post",
          page: page(1, "nested", [
            {
              object: "block",
              type: "callout",
              callout: {
                rich_text: [
                  {
                    type: "text",
                    text: { content: "リンク", link: { url: "https://mirumi.me/" } },
                    annotations: { bold: true },
                  },
                ],
                icon: { type: "emoji", emoji: "💡" },
                children: [
                  {
                    object: "block",
                    type: "to_do",
                    to_do: { rich_text: [{ type: "text", text: { content: "未対応" } }] },
                  },
                ],
              },
            },
          ]),
        },
      ]),
    ).toEqual([
      {
        sourceId: 1,
        slug: "nested",
        warnings: [expect.stringContaining("未対応の Notion ブロックです: to_do")],
      },
    ])
  })
})
