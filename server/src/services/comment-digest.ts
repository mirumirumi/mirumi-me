import type { CommentRecord } from "shared/comments"
import { ANONYMOUS_AUTHOR_NAME } from "shared/comments"

import type { SesEmail } from "./ses"

export interface CommentDigestDependencies {
  loadUnnotifiedComments(): Promise<Array<CommentRecord>>
  sendEmail(email: SesEmail): Promise<void>
  // 送信成功後に 1 row ずつ 通知日時 を書く。失敗しても翌日に再送されるだけなので握りつぶさず投げる
  markNotified(pageId: string, notifiedAt: string): Promise<void>
  now(): Date
}

export interface CommentDigestOptions {
  from: string
  to: string
  siteName: string
}

export interface CommentDigestResult {
  count: number
  sent: boolean
  marked: number
}

const CONTENT_HEAD_CHARS = 120
const MARK_INTERVAL_MS = 350

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Notion の page URL。dash なしの page ID で開ける
export const createNotionPageUrl = (pageId: string): string => {
  return `https://www.notion.so/${pageId.replaceAll("-", "")}`
}

const formatJst = (value: string): string => {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

const contentHead = (content: string): string => {
  const flat = content.replaceAll(/\s+/g, " ").trim()

  return flat.length <= CONTENT_HEAD_CHARS ? flat : `${flat.slice(0, CONTENT_HEAD_CHARS)}…`
}

// 投稿者メールは載せない。件数、記事 slug、投稿者名、本文冒頭、Notion row link だけ
export const createCommentDigestEmail = (
  comments: Array<CommentRecord>,
  options: CommentDigestOptions,
): SesEmail => {
  const lines = comments.flatMap((comment, index) => {
    return [
      `${index + 1}. [${comment.slug || "(slug なし)"}] ${comment.authorName.trim() || ANONYMOUS_AUTHOR_NAME}（${formatJst(comment.createdAt)}）`,
      `   ${contentHead(comment.content)}`,
      `   ${createNotionPageUrl(comment.pageId)}`,
      "",
    ]
  })

  return {
    from: options.from,
    to: options.to,
    subject: `[${options.siteName}] 未確認のコメント ${comments.length} 件`,
    text: [
      `${options.siteName} に未確認のコメントが ${comments.length} 件あります。`,
      "Notion の comments で status を 承認済み にすると公開されます。",
      "",
      ...lines,
    ].join("\n"),
  }
}

export const runCommentDigest = async (
  dependencies: CommentDigestDependencies,
  options: CommentDigestOptions,
): Promise<CommentDigestResult> => {
  const comments = await dependencies.loadUnnotifiedComments()
  if (comments.length === 0) {
    return { count: 0, sent: false, marked: 0 }
  }
  await dependencies.sendEmail(createCommentDigestEmail(comments, options))
  const notifiedAt = dependencies.now().toISOString()
  let marked = 0
  for (const comment of comments) {
    if (0 < marked) {
      await sleep(MARK_INTERVAL_MS)
    }
    await dependencies.markNotified(comment.pageId, notifiedAt)
    marked += 1
  }

  return { count: comments.length, sent: true, marked }
}
