import type { BlockObjectResponse, RichTextItemResponse } from "@notionhq/client"
import { describe, expect, test } from "vitest"

import type { NotionBlockNode } from "shared/notion"

import {
  buildTocAnchorBlockUpdate,
  collectLegacyTocLinks,
  collectNotionTocHeadings,
  collectWordPressTocHeadings,
  planTocAnchorFix,
} from "./toc-anchors-core"
import type { WordPressContentRecord } from "./types"

describe("toc anchors core", () => {
  const record = (slug: string, content: string): WordPressContentRecord => ({
    id: 1,
    postType: "post",
    postDate: "2024-01-01 00:00:00",
    postModified: "2024-01-01 00:00:00",
    slug,
    title: "記事",
    excerpt: "",
    content,
    categories: [],
    thumbnailUrl: null,
    showThumbnailOnFrontend: false,
    tocHidden: false,
    tocClosed: false,
  })
  const text = (content: string, link: string | null): RichTextItemResponse =>
    ({
      type: "text",
      text: { content, link: link ? { url: link } : null },
      annotations: {
        bold: false,
        italic: false,
        strikethrough: false,
        underline: false,
        code: false,
        color: "default",
      },
      plain_text: content,
      href: link,
    }) as RichTextItemResponse
  const headingNode = (
    id: string,
    type: "heading_2" | "heading_3" | "heading_4",
    content: string,
  ) =>
    ({
      block: { id, type, [type]: { rich_text: [text(content, null)] } },
      children: [],
    }) as unknown as NotionBlockNode

  describe("collectLegacyTocLinks", () => {
    test("相対 href を記事 URL 基準で絶対化し、対象 slug と番号を取り出す", () => {
      expect(
        collectLegacyTocLinks([
          record("noxplayer", '<p>飛ばす方は<a href="/noxplayer#toc5">こちら</a>から</p>'),
        ]),
      ).toEqual([
        {
          sourceSlug: "noxplayer",
          kind: "inline",
          legacyUrl: "https://mirumi.me/noxplayer#toc5",
          targetSlug: "noxplayer",
          anchorNumber: 5,
          linkText: "こちら",
        },
      ])
    })

    test("外部サイトのアンカーは対象 slug を持たない", () => {
      expect(
        collectLegacyTocLinks([
          record("cocoon-merit", '<p><a href="https://wp-cocoon.com/manual/#toc16">公式</a></p>'),
        ])[0],
      ).toEqual(expect.objectContaining({ targetSlug: null, anchorNumber: 16 }))
    })

    test("ブログカードのショートコードは blogcard として拾う", () => {
      expect(collectLegacyTocLinks([record("vivaldi", "<p>[/pc-freesoft#toc7]</p>")])).toEqual([
        {
          sourceSlug: "vivaldi",
          kind: "blogcard",
          legacyUrl: "https://mirumi.me/pc-freesoft/#toc7",
          targetSlug: "pc-freesoft",
          anchorNumber: 7,
          linkText: "",
        },
      ])
    })

    test("#toc を持たないリンクは対象にしない", () => {
      expect(collectLegacyTocLinks([record("a", '<p><a href="/other">別記事</a></p>')])).toEqual([])
    })
  })

  describe("collectWordPressTocHeadings", () => {
    test("h2 / h3 / h4 だけを本文の順で集める", () => {
      expect(
        collectWordPressTocHeadings(
          "<h2>ひとつめ</h2><p>本文</p><h3>ふたつめ</h3><h4>みっつめ</h4>",
        ),
      ).toEqual([
        { level: 2, text: "ひとつめ" },
        { level: 3, text: "ふたつめ" },
        { level: 4, text: "みっつめ" },
      ])
    })

    test("入れ子のタグと連続する空白をならす", () => {
      expect(
        collectWordPressTocHeadings('<h2>１．<span class="color-red">強調</span>\n した</h2>'),
      ).toEqual([{ level: 2, text: "１．強調 した" }])
    })
  })

  describe("collectNotionTocHeadings", () => {
    test("子ブロックの見出しも本文の順で集める", () => {
      const nodes: Array<NotionBlockNode> = [
        headingNode("1e2d5425-ad40-8012-9f3a-c1d4e5f60789", "heading_2", "親"),
        {
          block: { id: "callout", type: "callout", callout: { rich_text: [] } },
          children: [headingNode("2a3b4c5d-6e7f-8091-a2b3-c4d5e6f70811", "heading_3", "子")],
        } as unknown as NotionBlockNode,
      ]

      expect(collectNotionTocHeadings(nodes)).toEqual([
        { blockId: "1e2d5425-ad40-8012-9f3a-c1d4e5f60789", level: 2, text: "親" },
        { blockId: "2a3b4c5d-6e7f-8091-a2b3-c4d5e6f70811", level: 3, text: "子" },
      ])
    })
  })

  describe("planTocAnchorFix", () => {
    const link = {
      sourceSlug: "noxplayer",
      kind: "inline" as const,
      legacyUrl: "https://mirumi.me/noxplayer#toc2",
      targetSlug: "noxplayer",
      anchorNumber: 2,
      linkText: "こちら",
    }
    const wordPressHeadings = [
      { level: 2, text: "ひとつめ" },
      { level: 3, text: "ふたつめ" },
    ]
    const notionHeadings = [
      { blockId: "1e2d5425-ad40-8012-9f3a-c1d4e5f60789", level: 2, text: "ひとつめ" },
      { blockId: "2a3b4c5d-6e7f-8091-a2b3-c4d5e6f70811", level: 3, text: "ふたつめ" },
    ]

    test("Notion が受け付けるよう、同じ記事内のリンクもフル URL にする", () => {
      expect(planTocAnchorFix(link, wordPressHeadings, notionHeadings)).toEqual(
        expect.objectContaining({
          status: "ready",
          newUrl: "https://mirumi.me/noxplayer/#h-V5vcIEQ",
        }),
      )
    })

    test("別記事へのリンクも同じ形にする", () => {
      expect(
        planTocAnchorFix(
          { ...link, sourceSlug: "smartphone-battery", targetSlug: "noxplayer" },
          wordPressHeadings,
          notionHeadings,
        ),
      ).toEqual(expect.objectContaining({ newUrl: "https://mirumi.me/noxplayer/#h-V5vcIEQ" }))
    })

    test("見出しの本文が Notion と食い違うときは置換しない", () => {
      expect(
        planTocAnchorFix(link, wordPressHeadings, [
          notionHeadings[0]!,
          { ...notionHeadings[1]!, text: "書き換えられた見出し" },
        ]),
      ).toEqual(
        expect.objectContaining({
          status: "heading-mismatch",
          newUrl: null,
          wordPressHeading: "ふたつめ",
          notionHeading: "書き換えられた見出し",
        }),
      )
    })

    test("番号が見出し数を超えるときは置換しない", () => {
      expect(
        planTocAnchorFix({ ...link, anchorNumber: 9 }, wordPressHeadings, notionHeadings),
      ).toEqual(expect.objectContaining({ status: "heading-missing", newUrl: null }))
    })

    test("外部リンクとブログカードはそのまま報告する", () => {
      expect(
        planTocAnchorFix({ ...link, targetSlug: null }, wordPressHeadings, notionHeadings).status,
      ).toEqual("external")
      expect(
        planTocAnchorFix({ ...link, kind: "blogcard" }, wordPressHeadings, notionHeadings).status,
      ).toEqual("blogcard")
    })
  })

  describe("buildTocAnchorBlockUpdate", () => {
    const replacements = new Map([["https://mirumi.me/noxplayer#toc5", "#h-V5vcIEQ"]])

    test("段落の該当リンクだけ差し替え、読み取り専用の field は送らない", () => {
      const block = {
        id: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [
            text("飛ばす方は", null),
            text("こちら", "https://mirumi.me/noxplayer#toc5"),
            text("と", "https://example.com/"),
          ],
        },
      } as unknown as BlockObjectResponse

      expect(buildTocAnchorBlockUpdate(block, replacements)).toEqual({
        replacedUrls: ["https://mirumi.me/noxplayer#toc5"],
        payload: {
          paragraph: {
            rich_text: [
              expect.objectContaining({ text: { content: "飛ばす方は", link: null } }),
              expect.objectContaining({ text: { content: "こちら", link: { url: "#h-V5vcIEQ" } } }),
              expect.objectContaining({
                text: { content: "と", link: { url: "https://example.com/" } },
              }),
            ],
          },
        },
      })
      expect(JSON.stringify(buildTocAnchorBlockUpdate(block, replacements)?.payload)).not.toContain(
        "plain_text",
      )
    })

    test("table_row は置換のないセルも含めて cells 全体を組み立てる", () => {
      const block = {
        id: "row",
        type: "table_row",
        table_row: {
          cells: [[text("項目", null)], [text("JUMP!", "https://mirumi.me/noxplayer#toc5")]],
        },
      } as unknown as BlockObjectResponse
      const update = buildTocAnchorBlockUpdate(block, replacements)

      expect(update?.replacedUrls).toEqual(["https://mirumi.me/noxplayer#toc5"])
      expect((update?.payload.table_row as { cells: Array<Array<unknown>> }).cells).toHaveLength(2)
    })

    test("image の caption 内のリンクも差し替える", () => {
      const block = {
        id: "image",
        type: "image",
        image: {
          type: "external",
          external: { url: "https://mirumi.media/sample.webp" },
          caption: [text("前回", "https://mirumi.me/noxplayer#toc5"), text("の恨み", null)],
        },
      } as unknown as BlockObjectResponse
      const update = buildTocAnchorBlockUpdate(block, replacements)

      expect(update?.replacedUrls).toEqual(["https://mirumi.me/noxplayer#toc5"])
      expect(update?.payload).toEqual({
        image: {
          caption: [
            expect.objectContaining({ text: { content: "前回", link: { url: "#h-V5vcIEQ" } } }),
            expect.objectContaining({ text: { content: "の恨み", link: null } }),
          ],
        },
      })
    })

    test("置換対象がなければ null を返す", () => {
      const block = {
        id: "block",
        type: "paragraph",
        paragraph: { rich_text: [text("本文", null)] },
      } as unknown as BlockObjectResponse

      expect(buildTocAnchorBlockUpdate(block, replacements)).toEqual(null)
    })
  })
})
