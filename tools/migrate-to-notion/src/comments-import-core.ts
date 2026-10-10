import { createHash } from "node:crypto"
import type { CreatePageParameters, UpdatePageParameters } from "@notionhq/client"

import { normalizeCommentContent, splitNotionRichTextContent } from "shared/comments"
import {
  COMMENT_CONTENT_FORMAT_LABELS,
  COMMENT_PROPERTIES,
  COMMENT_SOURCE_LABELS,
  COMMENT_STATE_LABELS,
} from "shared/notion-comments"

// fetch-comments.ts が WordPress から取り出す承認済みコメント 1 件
export interface WordPressCommentRecord {
  id: number
  postId: number
  postSlug: string
  parentId: number | null
  isOwner: boolean
  author: string
  email: string
  // comment_date_gmt を ISO 8601（UTC）にしたもの
  createdAt: string
  content: string
}

export type CommentImportStatus = "pending" | "done" | "trashed"

export interface ImportedComment {
  // create の request を送る前に pending を書くため、応答を受け取る前に落ちると null のまま残る
  pageId: string | null
  sourceHash: string
  status: CommentImportStatus
}

// legacy-comment-id を key に、Notion の page ID と投入時の source hash を残す。
// 再実行は同じ row を作らず、hash が変わった row だけを更新する
export type CommentImportState = Record<string, ImportedComment>

export type CommentImportOperation =
  | {
      kind: "create"
      record: WordPressCommentRecord
      sourceHash: string
      // pending のまま page ID が無い row。Notion に作成済みの孤児がないか legacy ID で探してから作る
      resume: boolean
    }
  | { kind: "update"; record: WordPressCommentRecord; sourceHash: string; pageId: string }
  | { kind: "skip"; record: WordPressCommentRecord; pageId: string }
  | { kind: "trash"; legacyCommentId: number; pageId: string }

export interface CommentImportPlan {
  operations: Array<CommentImportOperation>
  counts: Record<CommentImportOperation["kind"], number>
}

// Notion の date property は秒を切り捨てて保存する（dev で実測）ため、照合は分の精度で行う
const truncateToMinute = (isoDate: string): string => {
  const date = new Date(isoDate)
  date.setUTCSeconds(0, 0)

  return date.toISOString()
}

// Notion は rich text の zero-width space（U+200B）と BOM を落として保存する（dev で実測、1 件）。
// 見た目に影響しないので照合からも外す。絵文字の結合に使う U+200D は落とさない
const stripInvisible = (content: string): string => {
  return content.replaceAll(/[\u200B\uFEFF]/g, "")
}

// 移行で保つと決めた項目だけを hash する。メールは WordPress の空文字と Notion の値なしを同値に扱う
export const createCommentSourceHash = (record: WordPressCommentRecord): string => {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: record.id,
        postId: record.postId,
        postSlug: record.postSlug,
        parentId: record.parentId,
        isOwner: record.isOwner,
        author: record.author,
        email: record.email || null,
        createdAt: truncateToMinute(record.createdAt),
        content: stripInvisible(normalizeCommentContent(record.content)),
      }),
    )
    .digest("hex")
}

// 親が先に来るよう並べる。WordPress では常に親 ID < 子 ID だが、ID 順に頼らず明示的に辿る
export const sortCommentsTopologically = (
  records: Array<WordPressCommentRecord>,
): Array<WordPressCommentRecord> => {
  const byId = new Map(records.map((record) => [record.id, record]))
  const ordered: Array<WordPressCommentRecord> = []
  const visited = new Set<number>()
  const visiting = new Set<number>()
  const visit = (record: WordPressCommentRecord) => {
    if (visited.has(record.id)) {
      return
    }
    if (visiting.has(record.id)) {
      throw Error(`親コメントが循環しています: ${record.id}`)
    }
    visiting.add(record.id)
    if (record.parentId !== null) {
      const parent = byId.get(record.parentId)
      if (!parent) {
        throw Error(`親コメントが承認済み一覧にありません: ${record.id} -> ${record.parentId}`)
      }
      if (parent.postId !== record.postId) {
        throw Error(`親コメントが別の記事を指しています: ${record.id} -> ${record.parentId}`)
      }
      visit(parent)
    }
    visiting.delete(record.id)
    visited.add(record.id)
    ordered.push(record)
  }
  for (const record of records.toSorted((left, right) => left.id - right.id)) {
    visit(record)
  }

  return ordered
}

export const planCommentImport = (
  records: Array<WordPressCommentRecord>,
  state: CommentImportState,
): CommentImportPlan => {
  const operations: Array<CommentImportOperation> = []
  const present = new Set<string>()
  for (const record of sortCommentsTopologically(records)) {
    const key = String(record.id)
    present.add(key)
    const sourceHash = createCommentSourceHash(record)
    const previous = state[key]
    if (!previous) {
      operations.push({ kind: "create", record, sourceHash, resume: false })
    } else if (previous.pageId === null) {
      operations.push({ kind: "create", record, sourceHash, resume: true })
    } else if (previous.status === "done" && previous.sourceHash === sourceHash) {
      operations.push({ kind: "skip", record, pageId: previous.pageId })
    } else {
      // pending（作成後に state を書けなかった）、hash 違い、trash 済みの復活はすべて上書きで揃える
      operations.push({ kind: "update", record, sourceHash, pageId: previous.pageId })
    }
  }
  for (const [key, imported] of Object.entries(state)) {
    if (!present.has(key) && imported.status !== "trashed" && imported.pageId !== null) {
      operations.push({ kind: "trash", legacyCommentId: Number(key), pageId: imported.pageId })
    }
  }
  const counts = { create: 0, update: 0, skip: 0, trash: 0 }
  for (const operation of operations) {
    counts[operation.kind] += 1
  }

  return { operations, counts }
}

const richText = (content: string): Array<{ type: "text"; text: { content: string } }> => {
  return splitNotionRichTextContent(content).map((chunk) => ({
    type: "text" as const,
    text: { content: chunk },
  }))
}

type CommentProperties = NonNullable<CreatePageParameters["properties"]>

// 承認済みの row として作る。移行行は import 時点で通知済みにする
export const createCommentProperties = (
  record: WordPressCommentRecord,
  parentPageId: string | null,
  notifiedAt: string,
): CommentProperties => {
  if (record.parentId !== null && parentPageId === null) {
    throw Error(`親コメントの page ID がありません: ${record.id}`)
  }

  return {
    [COMMENT_PROPERTIES.authorName]: { type: "title", title: richText(record.author) },
    [COMMENT_PROPERTIES.slug]: { type: "rich_text", rich_text: richText(record.postSlug) },
    [COMMENT_PROPERTIES.legacyPostId]: { type: "number", number: record.postId },
    [COMMENT_PROPERTIES.parent]: {
      type: "relation",
      relation: parentPageId ? [{ id: parentPageId }] : [],
    },
    [COMMENT_PROPERTIES.content]: {
      type: "rich_text",
      rich_text: richText(normalizeCommentContent(record.content)),
    },
    [COMMENT_PROPERTIES.contentFormat]: {
      type: "select",
      select: { name: COMMENT_CONTENT_FORMAT_LABELS["wordpress-html"] },
    },
    [COMMENT_PROPERTIES.createdAt]: { type: "date", date: { start: record.createdAt } },
    [COMMENT_PROPERTIES.email]: { type: "email", email: record.email || null },
    [COMMENT_PROPERTIES.state]: { type: "select", select: { name: COMMENT_STATE_LABELS.approved } },
    [COMMENT_PROPERTIES.isOwner]: { type: "checkbox", checkbox: record.isOwner },
    [COMMENT_PROPERTIES.source]: {
      type: "select",
      select: { name: COMMENT_SOURCE_LABELS.wordpress },
    },
    [COMMENT_PROPERTIES.legacyCommentId]: { type: "number", number: record.id },
    [COMMENT_PROPERTIES.notifiedAt]: { type: "date", date: { start: notifiedAt } },
  }
}

export const createCommentPageParameters = (
  dataSourceId: string,
  record: WordPressCommentRecord,
  parentPageId: string | null,
  notifiedAt: string,
): CreatePageParameters => {
  return {
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties: createCommentProperties(record, parentPageId, notifiedAt),
  }
}

export const createCommentUpdateParameters = (
  pageId: string,
  record: WordPressCommentRecord,
  parentPageId: string | null,
  notifiedAt: string,
): UpdatePageParameters => {
  return { page_id: pageId, properties: createCommentProperties(record, parentPageId, notifiedAt) }
}

// 承認済みから外れた row は hard delete せず trash にする
export const createCommentTrashParameters = (pageId: string): UpdatePageParameters => {
  return {
    page_id: pageId,
    properties: {
      [COMMENT_PROPERTIES.state]: { type: "select", select: { name: COMMENT_STATE_LABELS.trash } },
    },
  }
}
