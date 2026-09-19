import {
  APIErrorCode,
  APIResponseError,
  type BlockObjectResponse,
  Client,
  collectPaginatedAPI,
  isFullBlock,
  isFullPage,
  isNotionClientError,
  type PageObjectResponse,
  type RichTextItemResponse,
  type UpdatePageParameters,
} from "@notionhq/client"
import { z } from "zod"

import type { ArticleCategory, ArticleContent, ContentBlock, RichText } from "./content"

const NOTION_API_VERSION = "2026-03-11"
const NOTION_MAX_RETRIES = 5

type PageProperty = PageObjectResponse["properties"][string]

export const INTERNAL_STATES = ["下書き", "公開待ち", "公開中", "非公開待ち", "非公開"] as const

export type InternalState = (typeof INTERNAL_STATES)[number]
export type PageKind = "post" | "page"

export interface PageRevision {
  pageId: string
  kind: PageKind
  title: string
  slug: string
  internalState: InternalState | null
  lastEditedTime: string
  lastDeploy: string | null
  lastNotionEdit: string | null
  publishedAt: string | null
  updatedAt: string | null
  category: ArticleCategory | null
}

export interface NotionPageIndexItem {
  revision: PageRevision
  thumbnailUrl: string | null
  thumbnailName: string | null
}

const notionDateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
const notionCategorySchema = z.strictObject({
  name: z.string().min(1),
  slug: z.string().min(1),
})
const pageRevisionSchema: z.ZodType<PageRevision> = z.strictObject({
  pageId: z.string().min(1),
  kind: z.enum(["post", "page"]),
  title: z.string(),
  slug: z.string(),
  internalState: z.enum(INTERNAL_STATES).nullable(),
  lastEditedTime: notionDateSchema,
  lastDeploy: notionDateSchema.nullable(),
  lastNotionEdit: notionDateSchema.nullable(),
  publishedAt: notionDateSchema.nullable(),
  updatedAt: notionDateSchema.nullable(),
  category: notionCategorySchema.nullable(),
})
const notionPageIndexSchema: z.ZodType<Array<NotionPageIndexItem>> = z.array(
  z.strictObject({
    revision: pageRevisionSchema,
    thumbnailUrl: z.url().nullable(),
    thumbnailName: z.string().nullable(),
  }),
)

export const parseNotionPageIndex = (value: unknown): Array<NotionPageIndexItem> => {
  return notionPageIndexSchema.parse(value)
}

export const createNotionClient = (auth: string): Client => {
  return new Client({
    auth,
    notionVersion: NOTION_API_VERSION,
    retry: { maxRetries: NOTION_MAX_RETRIES },
  })
}

export const isNotionObjectNotFound = (err: unknown): boolean => {
  return isNotionClientError(err) && err.code === APIErrorCode.ObjectNotFound
}

export { isNotionClientError }

export const isNotionValidationError = (err: unknown): boolean => {
  return isNotionClientError(err) && err.code === APIErrorCode.ValidationError
}

// ネットワーク断やクライアント側タイムアウトは API からの応答がないため、これに当たらない
export const isNotionAPIResponseError = (err: unknown): boolean => {
  return APIResponseError.isAPIResponseError(err)
}

export class InvalidNotionPageRevisionError extends Error {}

const normalizeRichText = (richText: Array<RichTextItemResponse>): Array<RichText> => {
  return richText.map((item) => ({
    type: item.type,
    content: item.plain_text,
    href: item.href,
    annotations: {
      bold: item.annotations.bold,
      italic: item.annotations.italic,
      strikethrough: item.annotations.strikethrough,
      underline: item.annotations.underline,
      code: item.annotations.code,
      color: item.annotations.color,
    },
  }))
}

const getRichTextProperty = (property: PageProperty | undefined): Array<RichText> => {
  if (!property) {
    return []
  }
  if (property.type === "rich_text") {
    return normalizeRichText(property.rich_text)
  }
  if (property.type === "title") {
    return normalizeRichText(property.title)
  }

  return []
}

const getPlainTextProperty = (property: PageProperty | undefined): string => {
  return getRichTextProperty(property)
    .map((item) => item.content)
    .join("")
}

const getCheckboxProperty = (property: PageProperty | undefined): boolean => {
  if (!property || property.type !== "checkbox") {
    return false
  }

  return property.checkbox
}

const getDateProperty = (property: PageProperty | undefined): string | null => {
  if (!property || property.type !== "date") {
    return null
  }

  return property.date?.start ?? null
}

const getLastEditedTimeProperty = (property: PageProperty | undefined): string | null => {
  if (!property || property.type !== "last_edited_time") {
    return null
  }

  return property.last_edited_time
}

const getSelectProperty = (property: PageProperty | undefined): string | null => {
  if (!property || property.type !== "select") {
    return null
  }

  return property.select?.name ?? null
}

const getInternalStateProperty = (property: PageProperty | undefined): InternalState | null => {
  const value = getSelectProperty(property)

  return INTERNAL_STATES.find((state) => state === value) ?? null
}

const getRelationPageId = (property: PageProperty | undefined): string | null => {
  if (!property || property.type !== "relation") {
    return null
  }

  return property.relation.at(0)?.id ?? null
}

const getFile = (property: PageProperty | undefined): { url: string; name: string } | null => {
  if (!property || property.type !== "files") {
    return null
  }

  const file = property.files.at(0)
  if (!file) {
    return null
  }

  return {
    url: file.type === "external" ? file.external.url : file.file.url,
    name: file.name,
  }
}

const getCalloutIcon = (block: BlockObjectResponse): string | null => {
  if (block.type !== "callout" || !block.callout.icon || block.callout.icon.type !== "emoji") {
    return null
  }

  return block.callout.icon.emoji
}

const normalizeBlock = (
  block: BlockObjectResponse,
  children: Array<ContentBlock>,
): ContentBlock => {
  switch (block.type) {
    case "paragraph":
      return {
        id: block.id,
        type: "paragraph",
        richText: normalizeRichText(block.paragraph.rich_text),
        children,
      }
    case "quote":
      return {
        id: block.id,
        type: "quote",
        richText: normalizeRichText(block.quote.rich_text),
        children,
      }
    case "bulleted_list_item":
      return {
        id: block.id,
        type: "bulleted_list_item",
        richText: normalizeRichText(block.bulleted_list_item.rich_text),
        children,
      }
    case "numbered_list_item":
      return {
        id: block.id,
        type: "numbered_list_item",
        richText: normalizeRichText(block.numbered_list_item.rich_text),
        children,
      }
    case "heading_1":
      return {
        id: block.id,
        type: "heading",
        level: 1,
        richText: normalizeRichText(block.heading_1.rich_text),
        children,
      }
    case "heading_2":
      return {
        id: block.id,
        type: "heading",
        level: 2,
        richText: normalizeRichText(block.heading_2.rich_text),
        children,
      }
    case "heading_3":
      return {
        id: block.id,
        type: "heading",
        level: 3,
        richText: normalizeRichText(block.heading_3.rich_text),
        children,
      }
    case "heading_4":
      return {
        id: block.id,
        type: "heading",
        level: 4,
        richText: normalizeRichText(block.heading_4.rich_text),
        children,
      }
    case "callout":
      return {
        id: block.id,
        type: "callout",
        icon: getCalloutIcon(block),
        richText: normalizeRichText(block.callout.rich_text),
        children,
      }
    case "code":
      return {
        id: block.id,
        type: "code",
        language: block.code.language,
        caption: normalizeRichText(block.code.caption),
        richText: normalizeRichText(block.code.rich_text),
        children,
      }
    case "image":
      return {
        id: block.id,
        type: "image",
        url: block.image.type === "external" ? block.image.external.url : block.image.file.url,
        caption: normalizeRichText(block.image.caption),
        children,
      }
    case "audio":
      return {
        id: block.id,
        type: "audio",
        url: block.audio.type === "external" ? block.audio.external.url : block.audio.file.url,
        caption: normalizeRichText(block.audio.caption),
        children,
      }
    case "video":
      return {
        id: block.id,
        type: "video",
        url: block.video.type === "external" ? block.video.external.url : block.video.file.url,
        caption: normalizeRichText(block.video.caption),
        children,
      }
    case "embed":
      return {
        id: block.id,
        type: "embed",
        url: block.embed.url,
        caption: normalizeRichText(block.embed.caption),
        children,
      }
    case "bookmark":
      return {
        id: block.id,
        type: "bookmark",
        url: block.bookmark.url,
        caption: normalizeRichText(block.bookmark.caption),
        children,
      }
    case "divider":
      return { id: block.id, type: "divider", children }
    case "table":
      return {
        id: block.id,
        type: "table",
        hasColumnHeader: block.table.has_column_header,
        hasRowHeader: block.table.has_row_header,
        children,
      }
    case "table_row":
      return {
        id: block.id,
        type: "table_row",
        cells: block.table_row.cells.map(normalizeRichText),
        children,
      }
    case "column_list":
    case "column":
    case "synced_block":
      return { id: block.id, type: "container", children }
    case "toggle":
      return {
        id: block.id,
        type: "unsupported",
        originalType: block.type,
        richText: normalizeRichText(block.toggle.rich_text),
        children,
      }
    case "to_do":
      return {
        id: block.id,
        type: "unsupported",
        originalType: block.type,
        richText: normalizeRichText(block.to_do.rich_text),
        children,
      }
    default:
      return {
        id: block.id,
        type: "unsupported",
        originalType: block.type,
        richText: [],
        children,
      }
  }
}

const fetchBlockChildren = async (
  client: Client,
  blockId: string,
): Promise<Array<ContentBlock>> => {
  const response = await collectPaginatedAPI(client.blocks.children.list, {
    block_id: blockId,
    page_size: 100,
  })
  const blocks: Array<ContentBlock> = []

  for (const block of response) {
    if (!isFullBlock(block)) {
      blocks.push({
        id: block.id,
        type: "unsupported",
        originalType: "partial",
        richText: [],
        children: [],
      })
      continue
    }

    if (block.in_trash) {
      continue
    }

    const children = block.has_children ? await fetchBlockChildren(client, block.id) : []
    blocks.push(normalizeBlock(block, children))
  }

  return blocks
}

const fetchCategory = async (
  client: Client,
  pageId: string | null,
): Promise<ArticleCategory | null> => {
  if (!pageId) {
    return null
  }

  const response = await client.pages.retrieve({ page_id: pageId })
  if (!isFullPage(response)) {
    return null
  }

  const name = getPlainTextProperty(response.properties.title)
  const slug = getPlainTextProperty(response.properties.slug)
  if (!name || !slug) {
    return null
  }

  return { name, slug }
}

export const fetchNotionArticle = async (
  client: Client,
  pageId: string,
): Promise<ArticleContent> => {
  const response = await client.pages.retrieve({ page_id: pageId })
  if (!isFullPage(response)) {
    throw new TypeError("Notion から完全な記事ページを取得できませんでした")
  }

  const properties = response.properties
  const categoryPageId = getRelationPageId(properties.category)
  const thumbnail = getFile(properties.thumbnail)

  return {
    id: response.id,
    title: getPlainTextProperty(properties.title) || "無題",
    slug: getPlainTextProperty(properties.slug),
    thumbnailUrl: thumbnail?.url ?? null,
    thumbnailName: thumbnail?.name ?? null,
    publishedAt: getDateProperty(properties.公開日),
    updatedAt: getDateProperty(properties.更新日),
    category: await fetchCategory(client, categoryPageId),
    customCss: getPlainTextProperty(properties["カスタム CSS"]),
    toc: {
      hidden: getCheckboxProperty(properties.もくじ非表示),
      closed: getCheckboxProperty(properties.もくじ閉じる),
    },
    blocks: await fetchBlockChildren(client, response.id),
  }
}

export interface NotionDataSourceIds {
  posts: string
  pages: string
}

export const resolveNotionPageKind = (
  page: PageObjectResponse,
  dataSources: NotionDataSourceIds,
): PageKind | null => {
  if (page.parent.type !== "data_source_id") {
    return null
  }
  if (page.parent.data_source_id === dataSources.posts) {
    return "post"
  }
  if (page.parent.data_source_id === dataSources.pages) {
    return "page"
  }

  return null
}

const normalizePageIndexItem = async (
  client: Client,
  page: PageObjectResponse,
  kind: PageKind,
  categoryCache?: Map<string, ArticleCategory | null>,
): Promise<NotionPageIndexItem> => {
  const properties = page.properties
  const categoryPageId = getRelationPageId(properties.category)
  const thumbnail = getFile(properties.thumbnail)
  let category: ArticleCategory | null = null
  if (categoryPageId) {
    const cached = categoryCache?.get(categoryPageId)
    if (cached !== undefined) {
      category = cached
    } else {
      category = await fetchCategory(client, categoryPageId)
      categoryCache?.set(categoryPageId, category)
    }
  }

  return {
    revision: {
      pageId: page.id,
      kind,
      title: getPlainTextProperty(properties.title),
      slug: getPlainTextProperty(properties.slug),
      internalState: getInternalStateProperty(properties["internal-state"]),
      lastEditedTime: page.last_edited_time,
      lastDeploy: getDateProperty(properties["last-deploy"]),
      lastNotionEdit: getLastEditedTimeProperty(properties["last-notion-edit"]),
      publishedAt: getDateProperty(properties.公開日),
      updatedAt: getDateProperty(properties.更新日),
      category,
    },
    thumbnailUrl: thumbnail?.url ?? null,
    thumbnailName: thumbnail?.name ?? null,
  }
}

export const fetchNotionPageRevision = async (
  client: Client,
  pageId: string,
  dataSources: NotionDataSourceIds,
): Promise<PageRevision> => {
  const response = await client.pages.retrieve({ page_id: pageId })
  if (!isFullPage(response)) {
    throw new InvalidNotionPageRevisionError(
      "Notion から完全な page revision を取得できませんでした",
    )
  }

  const kind = resolveNotionPageKind(response, dataSources)
  if (!kind) {
    throw new InvalidNotionPageRevisionError("page が公開対象の data source に属していません")
  }

  return (await normalizePageIndexItem(client, response, kind)).revision
}

export const fetchNotionPageIndex = async (
  client: Client,
  dataSources: NotionDataSourceIds,
): Promise<Array<NotionPageIndexItem>> => {
  const pages: Array<NotionPageIndexItem> = []
  const categoryCache = new Map<string, ArticleCategory | null>()

  for (const [kind, dataSourceId] of [
    ["post", dataSources.posts],
    ["page", dataSources.pages],
  ] as const) {
    const responses = await collectPaginatedAPI(client.dataSources.query, {
      data_source_id: dataSourceId,
      page_size: 100,
      result_type: "page",
    })
    for (const response of responses) {
      if (!isFullPage(response) || response.in_trash) {
        continue
      }

      pages.push(await normalizePageIndexItem(client, response, kind, categoryCache))
    }
  }

  return pages
}

export const fetchNotionPageRevisions = async (
  client: Client,
  dataSources: NotionDataSourceIds,
): Promise<Array<PageRevision>> => {
  return (await fetchNotionPageIndex(client, dataSources)).map(({ revision }) => revision)
}

export type NotionPublishResult =
  | {
      status: "published"
      pageId: string
      deployedAt: string
      publishedAt: string
      updatedAt: string | null
    }
  | {
      status: "unpublished"
      pageId: string
    }
  | {
      status: "failed"
      pageId: string
      internalState: "下書き" | "公開中" | "非公開" | null
      deployedAt: string | null
      publishedAt: string | null
      error: string
    }

const richTextProperty = (content: string) => {
  return {
    type: "rich_text" as const,
    rich_text: content
      ? [{ type: "text" as const, text: { content: content.slice(0, 2_000) } }]
      : [],
  }
}

export const createNotionPublishUpdate = (result: NotionPublishResult): UpdatePageParameters => {
  const properties: NonNullable<UpdatePageParameters["properties"]> = {
    公開エラー: richTextProperty(result.status === "failed" ? result.error : ""),
  }

  if (result.status === "published") {
    properties["internal-state"] = { type: "select", select: { name: "公開中" } }
    properties["last-deploy"] = {
      type: "date",
      date: { start: result.deployedAt },
    }
    properties.公開日 = {
      type: "date",
      date: { start: result.publishedAt },
    }
    if (result.updatedAt) {
      properties.更新日 = {
        type: "date",
        date: { start: result.updatedAt },
      }
    }
  } else if (result.status === "unpublished") {
    properties["internal-state"] = { type: "select", select: { name: "非公開" } }
  } else if (result.internalState) {
    properties["internal-state"] = {
      type: "select",
      select: { name: result.internalState },
    }
    if (result.internalState === "公開中" && result.deployedAt && result.publishedAt) {
      properties["last-deploy"] = {
        type: "date",
        date: { start: result.deployedAt },
      }
      properties.公開日 = {
        type: "date",
        date: { start: result.publishedAt },
      }
    }
  }

  return { page_id: result.pageId, properties }
}

export const isNotionPublishResultApplied = (
  page: PageObjectResponse,
  result: NotionPublishResult,
): boolean => {
  const properties = page.properties
  const state = getInternalStateProperty(properties["internal-state"])
  const error = getPlainTextProperty(properties.公開エラー)
  if (result.status === "published") {
    return (
      state === "公開中" &&
      getDateProperty(properties["last-deploy"]) === result.deployedAt &&
      getDateProperty(properties.公開日) === result.publishedAt &&
      (!result.updatedAt || getDateProperty(properties.更新日) === result.updatedAt) &&
      error === ""
    )
  }
  if (result.status === "unpublished") {
    return state === "非公開" && error === ""
  }

  return (
    (!result.internalState || state === result.internalState) &&
    (!result.deployedAt || getDateProperty(properties["last-deploy"]) === result.deployedAt) &&
    (!result.publishedAt || getDateProperty(properties.公開日) === result.publishedAt) &&
    error === result.error.slice(0, 2_000)
  )
}

export const writeNotionPublishResult = async (
  client: Client,
  result: NotionPublishResult,
): Promise<PageObjectResponse> => {
  try {
    const response = await client.pages.update(createNotionPublishUpdate(result))
    if (!isFullPage(response)) {
      throw new TypeError("Notion へ公開結果を書き戻せませんでした")
    }

    return response
  } catch (err) {
    try {
      const current = await client.pages.retrieve({ page_id: result.pageId })
      if (isFullPage(current) && isNotionPublishResultApplied(current, result)) {
        return current
      }
    } catch {
      // 元の更新エラーが retry 分類の情報を持つため、再取得エラーで上書きしない
    }

    throw err
  }
}
