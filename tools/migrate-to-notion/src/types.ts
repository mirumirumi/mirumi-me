import type { BlockObjectRequest, CreatePageParameters } from "@notionhq/client"

export interface WordPressCategory {
  name: string
  slug: string
}

export interface WordPressContentRecord {
  id: number
  postType: "page" | "post"
  postDate: string
  postModified: string
  slug: string
  title: string
  excerpt: string
  content: string
  categories: Array<WordPressCategory>
  thumbnailUrl: string | null
  showThumbnailOnFrontend: boolean
  tocHidden: boolean
  tocClosed: boolean
}

export interface WordPressAttachmentRecord {
  id: number
  mimeType: string
  originalUrl: string
  sourceUrls: Array<string>
}

export type MigrationWarningCode =
  | "anchor_dropped"
  | "empty_element"
  | "font_size_dropped"
  | "invalid_url"
  | "multiple_categories"
  | "unknown_category"
  | "unsupported_block"
  | "unsupported_inline"
  | "unsupported_shortcode"
  | "table_normalized"

export interface MigrationWarning {
  code: MigrationWarningCode
  message: string
  source: string
}

export interface UploadedPage {
  pageId: string
  slug: string
  status: "pending" | "done"
}

// 途中で落ちても作り直せるように、WordPress の投稿 ID をキーとして投入結果を残す
export type UploadState = Record<string, UploadedPage>

export interface NotionPageInput {
  sourceId: number
  slug: string
  parent: NonNullable<CreatePageParameters["parent"]>
  properties: NonNullable<CreatePageParameters["properties"]>
  children: Array<BlockObjectRequest>
  warnings: Array<MigrationWarning>
}
