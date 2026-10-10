export type CommentRefreshSource = "notion-webhook" | "admin"

export interface CommentRefreshWorkflowParams {
  source: CommentRefreshSource
  requestId: string
  requestedAt: string
  // 承認・非表示・返信・編集があった comment row。slug はこの row から Notion で解決する
  commentPageId: string
}

export interface CommentRefreshJobRequest {
  workflowId: string
  requestedAt: string
  slug: string
}

export type CommentRefreshJobStatus = "refreshed" | "unchanged" | "skipped"

export interface CommentRefreshJobSummary {
  workflowId: string
  slug: string
  status: CommentRefreshJobStatus
  // skipped の理由。非公開記事のコメントなど、失敗ではないが何もしなかったとき
  reason: string | null
  pageId: string | null
  contentHash: string | null
  buildHash: string
  updatedPaths: Array<string>
}

export interface CommentRefreshWorkflowResult {
  workflowId: string
  commentPageId: string
  slug: string
  status: CommentRefreshJobStatus
}
