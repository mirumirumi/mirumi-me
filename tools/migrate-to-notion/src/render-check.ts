import type { BlockObjectRequest, BlockObjectResponse } from "@notionhq/client"

import { collectAmazonAsins } from "shared/amazon"
import type { AppStoreApp } from "shared/app-store"
import type { BookmarkCardData } from "shared/bookmark"
import type { ArticleContent } from "shared/content"
import { createInternalBookmarkLookup, resolveArticleEnrichment } from "shared/enrichment"
import { type NotionBlockNode, normalizeNotionBlockTree } from "shared/notion"
import { renderArticleContent } from "shared/render"
import { resolvePublicRoute } from "shared/site-routes"
import type { StaticXPostData } from "shared/x-post"

import type { NotionPageInput } from "./types"

// 変換したリクエストを、Notion が返す形にそろえて公開と同じ render に通す。prd では render warning が
// 1 件でもあると公開が止まるので、本番の import の前に手元で洗い出す。
// 外部のブログカード、X ポスト、App Store から引くアプリカードは外部を見ないと決まらないので、解決できたものとして扱う

export interface RenderCheckTarget {
  kind: "post" | "page"
  page: NotionPageInput
}

export interface RenderWarningRecord {
  sourceId: number
  slug: string
  warnings: Array<string>
}

interface RequestRichText {
  type?: string
  text?: { content?: string; link?: { url?: string } | null }
  equation?: { expression?: string }
  annotations?: Record<string, unknown>
}

const toResponseRichText = (items: unknown): unknown => {
  if (!Array.isArray(items)) {
    return items
  }

  return items.map((item: RequestRichText) => ({
    ...item,
    plain_text:
      item.type === "equation" ? (item.equation?.expression ?? "") : (item.text?.content ?? ""),
    href: item.type === "text" ? (item.text?.link?.url ?? null) : null,
    annotations: {
      bold: false,
      italic: false,
      strikethrough: false,
      underline: false,
      code: false,
      color: "default",
      ...item.annotations,
    },
  }))
}

const toResponseBody = (body: Record<string, unknown>): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      if (key === "rich_text" || key === "caption") {
        return [key, toResponseRichText(value ?? [])]
      }
      if (key === "cells" && Array.isArray(value)) {
        return [key, value.map(toResponseRichText)]
      }

      return [key, value]
    }),
  )
}

// headingId は block ID の末尾の bytes から作るので、ページの中で重ならない 16 進の ID にする
const createBlockIdFactory = (): (() => string) => {
  let count = 0

  return () => {
    count += 1

    return `00000000-0000-4000-8000-${count.toString(16).padStart(12, "0")}`
  }
}

const toBlockNodes = (
  blocks: Array<BlockObjectRequest>,
  nextId: () => string,
): Array<NotionBlockNode> => {
  return blocks.map((request) => {
    const { type } = request as { type: string }
    const { children, ...body } =
      ((request as Record<string, unknown>)[type] as Record<string, unknown> | undefined) ?? {}
    const childRequests = Array.isArray(children) ? (children as Array<BlockObjectRequest>) : []
    const block = {
      object: "block",
      id: nextId(),
      type,
      in_trash: false,
      has_children: 0 < childRequests.length,
      [type]: { caption: [], ...toResponseBody(body) },
    } as unknown as BlockObjectResponse

    return { block, children: toBlockNodes(childRequests, nextId) }
  })
}

const toArticleContent = (page: NotionPageInput): ArticleContent => {
  return {
    id: `00000000-0000-4000-8000-${page.sourceId.toString(16).padStart(12, "0")}`,
    title: page.slug,
    slug: page.slug,
    thumbnailUrl: null,
    thumbnailName: null,
    publishedAt: null,
    updatedAt: null,
    category: null,
    customCss: "",
    toc: { hidden: false, closed: false },
    blocks: normalizeNotionBlockTree(toBlockNodes(page.children, createBlockIdFactory())),
  }
}

const assumeExternalBookmark = async (url: string): Promise<BookmarkCardData> => {
  return {
    kind: "external",
    url,
    title: url,
    description: null,
    imageUrl: null,
    faviconUrl: null,
    label: new URL(url).hostname,
  }
}

const assumeXPost = async (postId: string): Promise<StaticXPostData> => {
  return {
    postId,
    url: `https://x.com/i/status/${postId}`,
    text: "",
    authorName: "",
    authorHandle: "",
    avatarUrl: null,
    mediaUrls: [],
    replyCount: null,
    repostCount: null,
    likeCount: null,
    linkCard: null,
    createdAt: null,
  }
}

const assumeAppStoreApp = async (url: string): Promise<AppStoreApp> => {
  return {
    id: "0",
    name: url,
    developer: "",
    price: "",
    artworkUrl: "https://mirumi.media/dry-run.webp",
  }
}

export const checkConvertedRender = async (
  targets: Array<RenderCheckTarget>,
): Promise<Array<RenderWarningRecord>> => {
  // bootstrap では投入した記事と固定ページがすべて公開されるので、それを内部ブログカードの行き先にする
  const internalBookmarks = createInternalBookmarkLookup(
    targets.flatMap(({ kind, page }) => {
      const route = resolvePublicRoute(kind, page.slug)

      return route ? [{ route, title: page.slug, description: null, label: "" }] : []
    }),
  )
  const records: Array<RenderWarningRecord> = []
  for (const { page } of targets) {
    const article = toArticleContent(page)
    const enrichment = await resolveArticleEnrichment(article, internalBookmarks, {
      externalBookmark: assumeExternalBookmark,
      xPost: assumeXPost,
      appStore: assumeAppStoreApp,
    })
    const rendered = renderArticleContent(article, {
      amazonCardSignatures: Object.fromEntries(
        collectAmazonAsins(article.blocks).map((asin) => [asin, "dry-run"]),
      ),
      bookmarks: enrichment.bookmarks,
      xPosts: enrichment.xPosts,
      apps: enrichment.apps,
    })
    if (0 < rendered.warnings.length) {
      records.push({ sourceId: page.sourceId, slug: page.slug, warnings: rendered.warnings })
    }
  }

  return records
}
