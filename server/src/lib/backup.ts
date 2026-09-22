export type BackupSource = "cron" | "admin"

export interface BackupWorkflowParams {
  source: BackupSource
  // この時刻で保存先 prefix が決まる。同じ requestedAt の再実行は同じ object を上書きする
  requestedAt: string
}

// 1 回分のバックアップを構成する object。R2 と S3 で同じ key を使う
export const BACKUP_FILES = {
  manifest: "manifest.json",
  dataSources: "notion-data-sources.json",
  posts: "notion-posts.ndjson.gz",
  pages: "notion-pages.ndjson.gz",
  categories: "notion-categories.ndjson.gz",
  comments: "notion-comments.ndjson.gz",
  publishIndex: "publish-index.json",
  publishedPages: "published-pages.ndjson.gz",
} as const

export type BackupFileName = (typeof BACKUP_FILES)[keyof typeof BACKUP_FILES]

export interface BackupFileRecord {
  file: BackupFileName
  key: string
  bytes: number
  sha256: string
  // NDJSON は行数、JSON は含まれる件数（schema 数や index の page 数）
  count: number
  // 読めずに書かなかった件数。published-pages の snapshot 欠損など
  skipped: number
}

export interface BackupManifest {
  schemaVersion: 1
  workflowId: string
  source: BackupSource
  requestedAt: string
  completedAt: string
  notion: {
    apiVersion: string
    dataSourceIds: {
      posts: string
      pages: string
      // posts の category relation から解決する。integration が届かなければ null
      categories: string | null
      comments: string
    }
  }
  files: Array<BackupFileRecord>
}

export interface BackupWorkflowResult {
  workflowId: string
  prefix: string
  files: Array<BackupFileRecord>
}
