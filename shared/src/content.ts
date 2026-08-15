export interface RichTextAnnotations {
  bold: boolean
  italic: boolean
  strikethrough: boolean
  underline: boolean
  code: boolean
  color: string
}

export interface RichText {
  type: "text" | "mention" | "equation"
  content: string
  href: string | null
  annotations: RichTextAnnotations
}

interface ContentBlockBase {
  id: string
  children: Array<ContentBlock>
}

export interface RichTextBlock extends ContentBlockBase {
  type: "paragraph" | "quote" | "bulleted_list_item" | "numbered_list_item"
  richText: Array<RichText>
}

export interface HeadingBlock extends ContentBlockBase {
  type: "heading"
  level: 1 | 2 | 3 | 4
  richText: Array<RichText>
}

export interface CalloutBlock extends ContentBlockBase {
  type: "callout"
  icon: string | null
  richText: Array<RichText>
}

export interface CodeBlock extends ContentBlockBase {
  type: "code"
  language: string
  caption: Array<RichText>
  richText: Array<RichText>
}

export interface ImageBlock extends ContentBlockBase {
  type: "image"
  url: string
  caption: Array<RichText>
}

export interface MediaBlock extends ContentBlockBase {
  type: "audio" | "video" | "embed" | "bookmark"
  url: string
  caption: Array<RichText>
}

export interface DividerBlock extends ContentBlockBase {
  type: "divider"
}

export interface TableBlock extends ContentBlockBase {
  type: "table"
  hasColumnHeader: boolean
  hasRowHeader: boolean
}

export interface TableRowBlock extends ContentBlockBase {
  type: "table_row"
  cells: Array<Array<RichText>>
}

export interface ContainerBlock extends ContentBlockBase {
  type: "container"
}

export interface UnsupportedBlock extends ContentBlockBase {
  type: "unsupported"
  originalType: string
  richText: Array<RichText>
}

export type ContentBlock =
  | RichTextBlock
  | HeadingBlock
  | CalloutBlock
  | CodeBlock
  | ImageBlock
  | MediaBlock
  | DividerBlock
  | TableBlock
  | TableRowBlock
  | ContainerBlock
  | UnsupportedBlock

export interface ArticleCategory {
  name: string
  slug: string
}

export interface ArticleContent {
  id: string
  title: string
  slug: string
  thumbnailUrl: string | null
  publishedAt: string
  updatedAt: string | null
  category: ArticleCategory | null
  customCss: string
  toc: {
    hidden: boolean
    closed: boolean
  }
  blocks: Array<ContentBlock>
}

export interface RenderedContent {
  html: string
  warnings: Array<string>
}
