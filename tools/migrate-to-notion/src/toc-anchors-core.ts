import type { BlockObjectResponse, RichTextItemResponse } from "@notionhq/client"
import { parse } from "node-html-parser"

import type { NotionBlockNode } from "shared/notion"
import { headingId } from "shared/render"

import type { WordPressContentRecord } from "./types"

// Cocoon の目次は h2 / h3 / h4 を記事内の通し番号で `toc1`, `toc2`, … と振っていた。
// 本番が配信している HTML の `<span id="tocN">` と、この通し番号で解決した見出しが
// 対象 40 件すべてで一致することを確認済み
const TOC_HEADING_TAGS = ["h2", "h3", "h4"] as const
const SITE_ORIGIN = "https://mirumi.me"
const LEGACY_ANCHOR = /^#toc(\d+)$/

export type LegacyTocLinkKind = "inline" | "blogcard"

export interface LegacyTocLink {
  sourceSlug: string
  kind: LegacyTocLinkKind
  // 移行時に convert.ts が相対 URL を記事 URL 基準で絶対化するので、Notion 側にはこの形で入っている
  legacyUrl: string
  targetSlug: string | null
  anchorNumber: number
  linkText: string
}

export interface TocHeading {
  level: number
  text: string
}

export interface NotionTocHeading extends TocHeading {
  blockId: string
}

export type TocAnchorFixStatus =
  | "ready"
  | "external"
  | "blogcard"
  | "target-missing"
  | "heading-missing"
  | "heading-mismatch"

export interface TocAnchorFix {
  sourceSlug: string
  targetSlug: string | null
  anchorNumber: number
  kind: LegacyTocLinkKind
  legacyUrl: string
  linkText: string
  status: TocAnchorFixStatus
  wordPressHeading: string | null
  notionHeading: string | null
  newUrl: string | null
}

const normalizeText = (value: string): string => {
  return value.replaceAll(/\s+/g, " ").trim()
}

const resolveTargetSlug = (url: URL): string | null => {
  if (url.origin !== SITE_ORIGIN) {
    return null
  }
  const path = url.pathname.replace(/^\/+|\/+$/g, "")

  return path || null
}

export const collectWordPressTocHeadings = (html: string): Array<TocHeading> => {
  return parse(html)
    .querySelectorAll(TOC_HEADING_TAGS.join(", "))
    .map((element) => ({
      level: Number(element.rawTagName.slice(1)),
      text: normalizeText(element.text),
    }))
}

export const collectNotionTocHeadings = (
  nodes: Array<NotionBlockNode>,
): Array<NotionTocHeading> => {
  const headings: Array<NotionTocHeading> = []

  for (const { block, children } of nodes) {
    if ("type" in block) {
      if (block.type === "heading_2" || block.type === "heading_3" || block.type === "heading_4") {
        const richText =
          block.type === "heading_2"
            ? block.heading_2.rich_text
            : block.type === "heading_3"
              ? block.heading_3.rich_text
              : block.heading_4.rich_text
        headings.push({
          blockId: block.id,
          level: Number(block.type.slice("heading_".length)),
          text: normalizeText(richText.map((item) => item.plain_text).join("")),
        })
      }
    }
    headings.push(...collectNotionTocHeadings(children))
  }

  return headings
}

export const collectLegacyTocLinks = (
  records: Array<WordPressContentRecord>,
): Array<LegacyTocLink> => {
  const links: Array<LegacyTocLink> = []

  for (const record of records) {
    const articleUrl = `${SITE_ORIGIN}/${record.slug}/`
    const document = parse(record.content)

    for (const anchor of document.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href")
      if (!href?.includes("#toc")) {
        continue
      }
      let url: URL
      try {
        url = new URL(href, articleUrl)
      } catch {
        continue
      }
      const anchorNumber = url.hash.match(LEGACY_ANCHOR)?.[1]
      if (!anchorNumber) {
        continue
      }
      links.push({
        sourceSlug: record.slug,
        kind: "inline",
        legacyUrl: url.href,
        targetSlug: resolveTargetSlug(url),
        anchorNumber: Number(anchorNumber),
        linkText: normalizeText(anchor.text),
      })
    }

    // ブログカードのショートコードは convert.ts が anchor を落として記事トップの bookmark にするため、
    // Notion 側に直せるリンクが残らない。報告だけして手当ては圭くんの判断に委ねる
    for (const match of record.content.matchAll(
      /<p>\[\/([a-z0-9][a-z0-9/_-]*?)\/?#toc(\d+)]<\/p>/gi,
    )) {
      links.push({
        sourceSlug: record.slug,
        kind: "blogcard",
        legacyUrl: `${SITE_ORIGIN}/${match[1]}/#toc${match[2]}`,
        targetSlug: match[1] ?? null,
        anchorNumber: Number(match[2]),
        linkText: "",
      })
    }
  }

  return links
}

export const planTocAnchorFix = (
  link: LegacyTocLink,
  wordPressHeadings: Array<TocHeading> | null,
  notionHeadings: Array<NotionTocHeading> | null,
): TocAnchorFix => {
  const base: TocAnchorFix = {
    sourceSlug: link.sourceSlug,
    targetSlug: link.targetSlug,
    anchorNumber: link.anchorNumber,
    kind: link.kind,
    legacyUrl: link.legacyUrl,
    linkText: link.linkText,
    status: "ready",
    wordPressHeading: null,
    notionHeading: null,
    newUrl: null,
  }
  if (!link.targetSlug) {
    return { ...base, status: "external" }
  }
  if (link.kind === "blogcard") {
    return { ...base, status: "blogcard" }
  }
  if (!wordPressHeadings || !notionHeadings) {
    return { ...base, status: "target-missing" }
  }
  const wordPressHeading = wordPressHeadings[link.anchorNumber - 1]
  const notionHeading = notionHeadings[link.anchorNumber - 1]
  if (!wordPressHeading || !notionHeading) {
    return {
      ...base,
      status: "heading-missing",
      wordPressHeading: wordPressHeading?.text ?? null,
      notionHeading: notionHeading?.text ?? null,
    }
  }
  if (wordPressHeading.text !== notionHeading.text) {
    return {
      ...base,
      status: "heading-mismatch",
      wordPressHeading: wordPressHeading.text,
      notionHeading: notionHeading.text,
    }
  }
  return {
    ...base,
    wordPressHeading: wordPressHeading.text,
    notionHeading: notionHeading.text,
    // Notion の link は絶対 URL しか受け付けない（`#h-xxxxxxx` だけだと `Invalid URL for link.`）。
    // 同じ記事内のリンクも移行前と同じくフル URL にする
    newUrl: `${SITE_ORIGIN}/${link.targetSlug}/#${headingId(notionHeading.blockId)}`,
  }
}

const rewriteRichText = (
  richText: Array<RichTextItemResponse>,
  replacements: ReadonlyMap<string, string>,
): { richText: Array<unknown>; replacedUrls: Array<string> } => {
  const replacedUrls: Array<string> = []
  const rewritten = richText.map((item) => {
    // plain_text と href は読み取り専用なので送り返さない
    const { plain_text, href, ...rest } = item
    if (item.type !== "text") {
      return rest
    }
    const url = item.text.link?.url ?? null
    const next = url ? replacements.get(url) : undefined
    if (next === undefined || !url) {
      return rest
    }
    replacedUrls.push(url)

    return {
      ...rest,
      type: "text" as const,
      text: { content: item.text.content, link: { url: next } },
    }
  })

  return { richText: rewritten, replacedUrls }
}

// caption を見落とすと `[caption]` ショートコード由来の image block 内のリンクを取りこぼす
const RICH_TEXT_FIELDS = ["rich_text", "caption"] as const

const blockPayload = (
  block: BlockObjectResponse,
): Record<string, Array<RichTextItemResponse> | undefined> => {
  return (
    (block as unknown as Record<string, Record<string, Array<RichTextItemResponse> | undefined>>)[
      block.type
    ] ?? {}
  )
}

// 対象ブロックの rich_text と caption を差し替えた PATCH payload を作る。置換が無ければ null を返す。
// table_row は cells 全体を送り直す必要があるため、置換のないセルも含めて組み立てる
export const buildTocAnchorBlockUpdate = (
  block: BlockObjectResponse,
  replacements: ReadonlyMap<string, string>,
): { payload: Record<string, unknown>; replacedUrls: Array<string> } | null => {
  if (block.type === "table_row") {
    const cells = block.table_row.cells.map((cell) => rewriteRichText(cell, replacements))
    const replacedUrls = cells.flatMap((cell) => cell.replacedUrls)

    return 0 < replacedUrls.length
      ? { payload: { table_row: { cells: cells.map((cell) => cell.richText) } }, replacedUrls }
      : null
  }
  const payload = blockPayload(block)
  const rewritten: Record<string, Array<unknown>> = {}
  const replacedUrls: Array<string> = []
  for (const field of RICH_TEXT_FIELDS) {
    const value = payload[field]
    if (!Array.isArray(value)) {
      continue
    }
    const result = rewriteRichText(value, replacements)
    if (0 < result.replacedUrls.length) {
      rewritten[field] = result.richText
      replacedUrls.push(...result.replacedUrls)
    }
  }

  return 0 < replacedUrls.length ? { payload: { [block.type]: rewritten }, replacedUrls } : null
}

// 2 回目以降の実行で「すでに置換済み」と「本文が編集されて見つからない」を区別するために使う
export const collectLinkUrls = (blocks: Array<BlockObjectResponse>): Set<string> => {
  const urls = new Set<string>()
  for (const block of blocks) {
    const payload = blockPayload(block)
    const arrays =
      block.type === "table_row"
        ? block.table_row.cells
        : [payload.rich_text, payload.caption].filter(
            (value): value is Array<RichTextItemResponse> => Array.isArray(value),
          )
    for (const richText of arrays) {
      for (const item of richText) {
        if (item.type === "text" && item.text.link?.url) {
          urls.add(item.text.link.url)
        }
      }
    }
  }

  return urls
}

export const flattenNotionBlocks = (nodes: Array<NotionBlockNode>): Array<BlockObjectResponse> => {
  const blocks: Array<BlockObjectResponse> = []

  for (const { block, children } of nodes) {
    if ("type" in block) {
      blocks.push(block)
    }
    blocks.push(...flattenNotionBlocks(children))
  }

  return blocks
}
