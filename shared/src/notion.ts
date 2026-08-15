import {
  APIErrorCode,
  type BlockObjectResponse,
  Client,
  collectPaginatedAPI,
  isFullBlock,
  isFullPage,
  isNotionClientError,
  type PageObjectResponse,
  type RichTextItemResponse,
} from "@notionhq/client"

import type { ArticleCategory, ArticleContent, ContentBlock, RichText } from "./content"

const NOTION_API_VERSION = "2026-03-11"

type PageProperty = PageObjectResponse["properties"][string]

export const createNotionClient = (auth: string): Client => {
  return new Client({ auth, notionVersion: NOTION_API_VERSION })
}

export const isNotionObjectNotFound = (err: unknown): boolean => {
  return isNotionClientError(err) && err.code === APIErrorCode.ObjectNotFound
}

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

const getRelationPageId = (property: PageProperty | undefined): string | null => {
  if (!property || property.type !== "relation") {
    return null
  }

  return property.relation.at(0)?.id ?? null
}

const getFileUrl = (property: PageProperty | undefined): string | null => {
  if (!property || property.type !== "files") {
    return null
  }

  const file = property.files.at(0)
  if (!file) {
    return null
  }

  return file.type === "external" ? file.external.url : file.file.url
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
  now: Date = new Date(),
): Promise<ArticleContent> => {
  const response = await client.pages.retrieve({ page_id: pageId })
  if (!isFullPage(response)) {
    throw new TypeError("Notion から完全な記事ページを取得できませんでした")
  }

  const properties = response.properties
  const categoryPageId = getRelationPageId(properties.category)

  return {
    id: response.id,
    title: getPlainTextProperty(properties.title) || "無題",
    slug: getPlainTextProperty(properties.slug),
    thumbnailUrl: getFileUrl(properties.thumbnail),
    publishedAt: getDateProperty(properties.公開日) ?? now.toISOString(),
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
