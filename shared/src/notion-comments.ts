import {
  APIErrorCode,
  type Client,
  type CreatePageParameters,
  isFullDataSource,
  isFullPage,
  type PageObjectResponse,
  type QueryDataSourceParameters,
  type QueryDataSourceResponse,
  type UpdatePageParameters,
} from "@notionhq/client"

import {
  ANONYMOUS_AUTHOR_NAME,
  type CommentContentFormat,
  type CommentRecord,
  type CommentSource,
  type CommentState,
  type ParsedCommentPublicId,
  splitNotionRichTextContent,
} from "./comments"
import { isNotionAPIResponseError, isNotionClientError } from "./notion"

// comments データソースの property 名。posts と同じ意味のものは posts の表記（`slug`、`status`、`公開エラー`）に
// 揃える。Notion 側の表示名だけをここで持ち、コード内の値（CommentState など）は英語のまま
export const COMMENT_PROPERTIES = {
  authorName: "投稿者名",
  slug: "slug",
  legacyPostId: "legacy-post-id",
  parent: "親コメント",
  content: "本文",
  contentFormat: "本文形式",
  createdAt: "投稿日",
  email: "email",
  state: "status",
  isOwner: "管理者コメント",
  source: "from",
  legacyCommentId: "legacy-comment-id",
  publicId: "id",
  requestId: "request-id",
  notifiedAt: "通知日",
  refreshError: "公開エラー",
} as const

// select の option 名（Notion 上の表示）。posts の internal-state と同じく日本語にする
export const COMMENT_STATE_LABELS: Record<CommentState, string> = {
  pending: "承認待ち",
  approved: "承認済み",
  spam: "スパム",
  trash: "ゴミ箱",
}
export const COMMENT_CONTENT_FORMAT_LABELS: Record<CommentContentFormat, string> = {
  "wordpress-html": "WordPress HTML",
  "plain-text": "プレーンテキスト",
}
export const COMMENT_SOURCE_LABELS: Record<CommentSource, string> = {
  wordpress: "WordPress",
  "public-form": "公開フォーム",
  owner: "管理者",
}

export type CommentPropertyKey = keyof typeof COMMENT_PROPERTIES

const COMMENT_PROPERTY_TYPES: Record<CommentPropertyKey, string> = {
  authorName: "title",
  slug: "rich_text",
  legacyPostId: "number",
  parent: "relation",
  content: "rich_text",
  contentFormat: "select",
  createdAt: "date",
  email: "email",
  state: "select",
  isOwner: "checkbox",
  source: "select",
  legacyCommentId: "number",
  publicId: "unique_id",
  requestId: "rich_text",
  notifiedAt: "date",
  refreshError: "rich_text",
}

// メールアドレスは公開・通知・API のどこでも読まないため、取得する property から常に外す
const READ_PROPERTY_KEYS = (Object.keys(COMMENT_PROPERTIES) as Array<CommentPropertyKey>).filter(
  (key) => key !== "email",
)

export interface CommentDataSourceSchema {
  dataSourceId: string
  propertyIds: Record<CommentPropertyKey, string>
}

export class InvalidCommentSchemaError extends Error {}

export const resolveCommentDataSourceSchema = async (
  client: Client,
  dataSourceId: string,
): Promise<CommentDataSourceSchema> => {
  const response = await client.dataSources.retrieve({ data_source_id: dataSourceId })
  if (!isFullDataSource(response)) {
    throw new InvalidCommentSchemaError("comments データソースを取得できませんでした")
  }
  const propertyIds = {} as Record<CommentPropertyKey, string>
  const problems: Array<string> = []
  for (const key of Object.keys(COMMENT_PROPERTIES) as Array<CommentPropertyKey>) {
    const name = COMMENT_PROPERTIES[key]
    const property = response.properties[name]
    if (!property) {
      problems.push(`${name} がありません`)
      continue
    }
    if (property.type !== COMMENT_PROPERTY_TYPES[key]) {
      problems.push(`${name} の型が ${COMMENT_PROPERTY_TYPES[key]} ではありません`)
      continue
    }
    propertyIds[key] = property.id
  }
  if (0 < problems.length) {
    throw new InvalidCommentSchemaError(`comments の schema が不正です: ${problems.join(" / ")}`)
  }

  return { dataSourceId: response.id, propertyIds }
}

export const readCommentPropertyIds = (schema: CommentDataSourceSchema): Array<string> => {
  return READ_PROPERTY_KEYS.map((key) => schema.propertyIds[key])
}

type PageProperty = PageObjectResponse["properties"][string]

const getPlainText = (property: PageProperty | undefined): string => {
  if (!property) {
    return ""
  }
  if (property.type === "rich_text") {
    return property.rich_text.map((item) => item.plain_text).join("")
  }
  if (property.type === "title") {
    return property.title.map((item) => item.plain_text).join("")
  }

  return ""
}

const getNumber = (property: PageProperty | undefined): number | null => {
  return property?.type === "number" ? property.number : null
}

// option 名（日本語）から内部値へ戻す。知らない option は null
const getSelect = <T extends string>(
  property: PageProperty | undefined,
  labels: Record<T, string>,
): T | null => {
  if (property?.type !== "select") {
    return null
  }
  const name = property.select?.name

  return (Object.keys(labels) as Array<T>).find((value) => labels[value] === name) ?? null
}

const getDate = (property: PageProperty | undefined): string | null => {
  return property?.type === "date" ? (property.date?.start ?? null) : null
}

const getCheckbox = (property: PageProperty | undefined): boolean => {
  return property?.type === "checkbox" ? property.checkbox : false
}

const getRelationPageId = (property: PageProperty | undefined): string | null => {
  return property?.type === "relation" ? (property.relation.at(0)?.id ?? null) : null
}

const getUniqueId = (property: PageProperty | undefined): number | null => {
  return property?.type === "unique_id" ? property.unique_id.number : null
}

export const parseCommentPage = (page: PageObjectResponse): CommentRecord => {
  const properties = page.properties
  const state: CommentState | null = getSelect(
    properties[COMMENT_PROPERTIES.state],
    COMMENT_STATE_LABELS,
  )
  // Notion UI で作った owner reply は 本文形式 や 投稿日時 が空になりやすいので、それぞれ既定へ倒す
  const contentFormat: CommentContentFormat =
    getSelect(properties[COMMENT_PROPERTIES.contentFormat], COMMENT_CONTENT_FORMAT_LABELS) ??
    "plain-text"
  const source: CommentSource | null = getSelect(
    properties[COMMENT_PROPERTIES.source],
    COMMENT_SOURCE_LABELS,
  )

  return {
    pageId: page.id,
    slug: getPlainText(properties[COMMENT_PROPERTIES.slug]).trim(),
    parentPageId: getRelationPageId(properties[COMMENT_PROPERTIES.parent]),
    authorName: getPlainText(properties[COMMENT_PROPERTIES.authorName]),
    content: getPlainText(properties[COMMENT_PROPERTIES.content]),
    contentFormat,
    createdAt: getDate(properties[COMMENT_PROPERTIES.createdAt]) ?? page.created_time,
    state,
    isOwner: getCheckbox(properties[COMMENT_PROPERTIES.isOwner]),
    source,
    legacyCommentId: getNumber(properties[COMMENT_PROPERTIES.legacyCommentId]),
    uniqueId: getUniqueId(properties[COMMENT_PROPERTIES.publicId]),
    requestId: getPlainText(properties[COMMENT_PROPERTIES.requestId]).trim() || null,
    notifiedAt: getDate(properties[COMMENT_PROPERTIES.notifiedAt]),
    refreshError: getPlainText(properties[COMMENT_PROPERTIES.refreshError]) || null,
    lastEditedTime: page.last_edited_time,
  }
}

export const isCommentPage = (page: PageObjectResponse, dataSourceId: string): boolean => {
  return page.parent.type === "data_source_id" && page.parent.data_source_id === dataSourceId
}

export interface CommentStateSummary {
  pageId: string
  state: CommentState | null
}

// Webhook が「comments の row か」「承認済みか」だけを見るための軽い取得。schema の解決を挟まず、
// env に持つ status の property ID だけを filter_properties に渡す
export const fetchCommentState = async (
  client: Client,
  dataSourceId: string,
  statePropertyId: string,
  pageId: string,
): Promise<CommentStateSummary | null> => {
  const response = await client.pages.retrieve({
    page_id: pageId,
    filter_properties: [statePropertyId],
  })
  if (!isFullPage(response) || !isCommentPage(response, dataSourceId)) {
    return null
  }

  return {
    pageId: response.id,
    state: getSelect(response.properties[COMMENT_PROPERTIES.state], COMMENT_STATE_LABELS),
  }
}

// comments 行でなければ null。メールアドレスは filter_properties で最初から受け取らない
export const fetchCommentPage = async (
  client: Client,
  schema: CommentDataSourceSchema,
  pageId: string,
): Promise<CommentRecord | null> => {
  const response = await client.pages.retrieve({
    page_id: pageId,
    filter_properties: readCommentPropertyIds(schema),
  })
  if (!isFullPage(response) || !isCommentPage(response, schema.dataSourceId)) {
    return null
  }

  return parseCommentPage(response)
}

// 返信の返信くらいまでを想定。これより深く slug の無い row が続くのは運用ミスなので空にして気づかせる
export const MAX_COMMENT_SLUG_INHERITANCE_DEPTH = 5

// Notion UI で親から作った owner reply は slug が空なので、親を順に取得して最初の slug を継ぐ。
// 決められなければ空を返す（呼び出し側が 公開エラー にする）
export const resolveInheritedCommentSlug = async (
  client: Client,
  schema: CommentDataSourceSchema,
  record: Pick<CommentRecord, "slug" | "parentPageId">,
): Promise<string> => {
  let current = record
  for (let depth = 0; depth < MAX_COMMENT_SLUG_INHERITANCE_DEPTH; depth++) {
    if (current.slug) {
      return current.slug
    }
    if (!current.parentPageId) {
      return ""
    }
    const parent = await fetchCommentPage(client, schema, current.parentPageId)
    if (!parent) {
      return ""
    }
    current = parent
  }

  return current.slug
}

type CommentQueryFilter = NonNullable<QueryDataSourceParameters["filter"]>
// SDK は個別 property filter の型を export していないため、query の filter 型から取り出す
type PropertyFilter = Extract<CommentQueryFilter, { property: string }>

const stateFilter = (state: CommentState): PropertyFilter => {
  return { property: COMMENT_PROPERTIES.state, select: { equals: COMMENT_STATE_LABELS[state] } }
}

const slugFilter = (slug: string): PropertyFilter => {
  return { property: COMMENT_PROPERTIES.slug, rich_text: { equals: slug } }
}

// 公開 build 用。非表示の親につなぎ直すため approved 以外も読む。null なら全記事
export const createArticleCommentsFilter = (slug: string | null): CommentQueryFilter | null => {
  return slug ? slugFilter(slug) : null
}

export const createRequestIdFilter = (requestId: string): CommentQueryFilter => {
  return { property: COMMENT_PROPERTIES.requestId, rich_text: { equals: requestId } }
}

export const createApprovedCommentByPublicIdFilter = (
  slug: string,
  publicId: ParsedCommentPublicId,
): CommentQueryFilter => {
  const idFilter: PropertyFilter =
    publicId.kind === "legacy"
      ? { property: COMMENT_PROPERTIES.legacyCommentId, number: { equals: publicId.number } }
      : { property: COMMENT_PROPERTIES.publicId, unique_id: { equals: publicId.number } }

  return { and: [stateFilter("approved"), slugFilter(slug), idFilter] }
}

export const createUnnotifiedPublicFormCommentsFilter = (): CommentQueryFilter => {
  return {
    and: [
      {
        property: COMMENT_PROPERTIES.source,
        select: { equals: COMMENT_SOURCE_LABELS["public-form"] },
      },
      { property: COMMENT_PROPERTIES.notifiedAt, date: { is_empty: true } },
    ],
  }
}

export class IncompleteCommentQueryError extends Error {}

// SDK は POST の query を 429 / 529 でしか再試行しないので、一時的な 5xx はここで exponential backoff する
const QUERY_RETRY_ERROR_CODES: ReadonlySet<string> = new Set([
  APIErrorCode.InternalServerError,
  APIErrorCode.ServiceUnavailable,
  APIErrorCode.GatewayTimeout,
  "bad_gateway",
])
const QUERY_MAX_ATTEMPTS = 4
const QUERY_RETRY_BASE_DELAY_MS = 1_000

const isRetriableQueryError = (err: unknown): boolean => {
  return (
    isNotionClientError(err) &&
    isNotionAPIResponseError(err) &&
    QUERY_RETRY_ERROR_CODES.has(err.code)
  )
}

const queryWithRetry = async <T>(
  send: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send()
    } catch (err) {
      if (QUERY_MAX_ATTEMPTS <= attempt || !isRetriableQueryError(err)) {
        throw err
      }
      await sleep(QUERY_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
    }
  }
}

const defaultSleep = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// cursor を取り切れなかった query を「コメントが少ない」と誤認しないよう、必ず全 page を読む
export const fetchCommentRecords = async (
  client: Client,
  schema: CommentDataSourceSchema,
  filter: CommentQueryFilter | null,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<Array<CommentRecord>> => {
  const records: Array<CommentRecord> = []
  let cursor: string | null = null
  while (true) {
    const startCursor: string | null = cursor
    const response: QueryDataSourceResponse = await queryWithRetry(
      () =>
        client.dataSources.query({
          data_source_id: schema.dataSourceId,
          filter_properties: readCommentPropertyIds(schema),
          ...(filter ? { filter } : {}),
          sorts: [{ property: COMMENT_PROPERTIES.createdAt, direction: "ascending" }],
          page_size: 100,
          result_type: "page",
          ...(startCursor ? { start_cursor: startCursor } : {}),
        }),
      sleep,
    )
    if (response.request_status?.type === "incomplete") {
      throw new IncompleteCommentQueryError("comments の query が途中で打ち切られました")
    }
    for (const result of response.results) {
      if (isFullPage(result) && !result.in_trash) {
        records.push(parseCommentPage(result))
      }
    }
    if (!response.has_more) {
      return records
    }
    if (!response.next_cursor) {
      throw new IncompleteCommentQueryError("comments の query の next_cursor がありません")
    }
    cursor = response.next_cursor
  }
}

const richText = (content: string): Array<{ type: "text"; text: { content: string } }> => {
  return splitNotionRichTextContent(content).map((chunk) => ({
    type: "text" as const,
    text: { content: chunk },
  }))
}

export interface PublicCommentInput {
  slug: string
  parentPageId: string | null
  authorName: string
  authorEmail: string | null
  content: string
  requestId: string
  createdAt: string
}

export const createPublicCommentParameters = (
  dataSourceId: string,
  input: PublicCommentInput,
): CreatePageParameters => {
  const properties: NonNullable<CreatePageParameters["properties"]> = {
    [COMMENT_PROPERTIES.authorName]: {
      type: "title",
      title: richText(input.authorName.trim() || ANONYMOUS_AUTHOR_NAME),
    },
    [COMMENT_PROPERTIES.slug]: { type: "rich_text", rich_text: richText(input.slug) },
    [COMMENT_PROPERTIES.parent]: {
      type: "relation",
      relation: input.parentPageId ? [{ id: input.parentPageId }] : [],
    },
    [COMMENT_PROPERTIES.content]: { type: "rich_text", rich_text: richText(input.content) },
    [COMMENT_PROPERTIES.contentFormat]: {
      type: "select",
      select: { name: COMMENT_CONTENT_FORMAT_LABELS["plain-text"] },
    },
    [COMMENT_PROPERTIES.createdAt]: { type: "date", date: { start: input.createdAt } },
    [COMMENT_PROPERTIES.email]: { type: "email", email: input.authorEmail },
    [COMMENT_PROPERTIES.state]: { type: "select", select: { name: COMMENT_STATE_LABELS.pending } },
    [COMMENT_PROPERTIES.isOwner]: { type: "checkbox", checkbox: false },
    [COMMENT_PROPERTIES.source]: {
      type: "select",
      select: { name: COMMENT_SOURCE_LABELS["public-form"] },
    },
    [COMMENT_PROPERTIES.requestId]: { type: "rich_text", rich_text: richText(input.requestId) },
  }

  return { parent: { type: "data_source_id", data_source_id: dataSourceId }, properties }
}

export const createCommentRefreshErrorUpdate = (
  pageId: string,
  error: string | null,
): UpdatePageParameters => {
  return {
    page_id: pageId,
    properties: {
      [COMMENT_PROPERTIES.refreshError]: {
        type: "rich_text",
        rich_text: error ? richText(error.slice(0, 2_000)) : [],
      },
    },
  }
}

export const createCommentSlugUpdate = (pageId: string, slug: string): UpdatePageParameters => {
  return {
    page_id: pageId,
    properties: {
      [COMMENT_PROPERTIES.slug]: { type: "rich_text", rich_text: richText(slug) },
    },
  }
}

export const createCommentNotifiedUpdate = (
  pageId: string,
  notifiedAt: string,
): UpdatePageParameters => {
  return {
    page_id: pageId,
    properties: {
      [COMMENT_PROPERTIES.notifiedAt]: { type: "date", date: { start: notifiedAt } },
    },
  }
}
