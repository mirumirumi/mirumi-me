import type { Client, DataSourceObjectResponse } from "@notionhq/client"
import { isFullDataSource } from "@notionhq/client"

import {
  fetchNotionBlockTree,
  forEachNotionDataSourcePage,
  isNotionObjectNotFound,
  NOTION_API_VERSION,
} from "shared/notion"

import { sha256Hex } from "../lib/aws-signature"
import {
  BACKUP_FILES,
  type BackupFileName,
  type BackupFileRecord,
  type BackupManifest,
  type BackupWorkflowParams,
  type BackupWorkflowResult,
} from "../lib/backup"
import { publishedPageSnapshotKey } from "../lib/published-pages"
import type { SiteDeploymentState } from "../lib/publishing"
import { DEPLOYMENT_INDEX_KEY, parseDeploymentState } from "../repositories/deployment-index"
import type { WorkflowStepExecutor } from "./publish-workflow"
import type { S3StorageClass } from "./s3-object-store"

export const BACKUP_WORKFLOW_STEP_CONFIGS = {
  // 全記事のブロック取得は Notion の rate limit に律速されて 10 分前後かかる。
  // 途中失敗の再試行は取り直しになるが、夜間 batch なので時間で解決する
  notion: {
    retries: { limit: 3, delay: "1 minute", backoff: "exponential" },
    timeout: "1 hour",
  },
  site: {
    retries: { limit: 3, delay: "30 seconds", backoff: "exponential" },
    timeout: "30 minutes",
  },
  store: {
    retries: { limit: 5, delay: "10 seconds", backoff: "exponential" },
    timeout: "10 minutes",
  },
} as const

const SNAPSHOT_READ_CONCURRENCY = 10

export interface BackupPutOptions {
  contentType: string
  // hex。store 側でも body と照合させる
  sha256: string
}

// R2。取得した内容を最初に置く staging を兼ねる
export interface BackupStore {
  get(key: string): Promise<Uint8Array | null>
  put(key: string, body: Uint8Array, options: BackupPutOptions): Promise<void>
}

// S3。R2 に置けた object を Deep Archive へ複製する。Deep Archive は即時に読み戻せないため、
// こちらを起点にした処理は組まない
export interface ArchiveStore {
  put(
    key: string,
    body: Uint8Array,
    options: BackupPutOptions & { storageClass: S3StorageClass },
  ): Promise<void>
}

export interface BackupDependencies {
  notion: Client
  dataSourceIds: { posts: string; pages: string; comments: string }
  // 配信用 site bucket。publish index と published-pages snapshot を読む
  readSiteObject(key: string): Promise<Uint8Array | null>
  backup: BackupStore
  archive: ArchiveStore
  now(): Date
}

interface RunBackupWorkflowOptions {
  workflowId: string
  params: BackupWorkflowParams
  step: WorkflowStepExecutor
  dependencies: BackupDependencies
}

interface BackupWorkflowInstance {
  id: string
}

export interface BackupWorkflowBinding {
  createBatch(
    options: Array<{ id: string; params: BackupWorkflowParams }>,
  ): Promise<Array<BackupWorkflowInstance>>
}

export interface StartedBackupWorkflow {
  workflowId: string
  created: boolean
}

const encoder = new TextEncoder()

// `2026-09-22T19:00:00.000Z` → `2026-09-22T19-00-00Z`。object key と instance ID の両方で使う
export const formatBackupTimestamp = (value: string): string => {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    throw Error(`日時として解釈できません: ${value}`)
  }

  return new Date(parsed)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(":", "-")
}

export const createBackupPrefix = (requestedAt: string): string => {
  return `v1/${formatBackupTimestamp(requestedAt)}`
}

export const createBackupInstanceId = (scheduledTime: number): string => {
  return `backup-${formatBackupTimestamp(new Date(scheduledTime).toISOString())}`
}

// Cron の発火時刻を instance ID にして、同じ発火の重複を idempotent に捨てる
export const startScheduledBackup = async (
  workflow: BackupWorkflowBinding,
  scheduledTime: number,
): Promise<StartedBackupWorkflow> => {
  const workflowId = createBackupInstanceId(scheduledTime)
  const instances = await workflow.createBatch([
    {
      id: workflowId,
      params: { source: "cron", requestedAt: new Date(scheduledTime).toISOString() },
    },
  ])

  return { workflowId, created: 0 < instances.length }
}

export const backupContentType = (file: BackupFileName): string => {
  return file.endsWith(".gz") ? "application/gzip" : "application/json; charset=utf-8"
}

const concatChunks = (chunks: Array<Uint8Array>): Uint8Array => {
  const merged = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  return merged
}

const collectStream = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const reader = stream.getReader()
  const chunks: Array<Uint8Array> = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(value)
  }

  return concatChunks(chunks)
}

// 1 行ずつ gzip に流し、圧縮後の bytes だけを溜める。Worker のメモリに raw を全件載せないため
export class GzipNdjsonWriter {
  readonly #writer: WritableStreamDefaultWriter<BufferSource>
  readonly #collected: Promise<Uint8Array>
  #lines = 0

  constructor() {
    const stream = new CompressionStream("gzip")
    this.#writer = stream.writable.getWriter()
    this.#collected = collectStream(stream.readable)
  }

  async write(value: unknown): Promise<void> {
    await this.#writer.write(encoder.encode(`${JSON.stringify(value)}\n`))
    this.#lines += 1
  }

  async finish(): Promise<{ bytes: Uint8Array; lines: number }> {
    await this.#writer.close()

    return { bytes: await this.#collected, lines: this.#lines }
  }
}

const storeBytes = async (
  dependencies: BackupDependencies,
  key: string,
  file: BackupFileName,
  bytes: Uint8Array,
  count: number,
  skipped = 0,
): Promise<BackupFileRecord> => {
  const sha256 = await sha256Hex(bytes)
  await dependencies.backup.put(key, bytes, { contentType: backupContentType(file), sha256 })

  return { file, key, bytes: bytes.byteLength, sha256, count, skipped }
}

const storeJson = async (
  dependencies: BackupDependencies,
  key: string,
  file: BackupFileName,
  value: unknown,
  count: number,
): Promise<BackupFileRecord> => {
  return storeBytes(dependencies, key, file, encoder.encode(JSON.stringify(value)), count)
}

const storeNdjson = async (
  dependencies: BackupDependencies,
  key: string,
  file: BackupFileName,
  writer: GzipNdjsonWriter,
  skipped = 0,
): Promise<BackupFileRecord> => {
  const { bytes, lines } = await writer.finish()

  return storeBytes(dependencies, key, file, bytes, lines, skipped)
}

const retrieveDataSource = async (
  client: Client,
  dataSourceId: string,
): Promise<DataSourceObjectResponse> => {
  const response = await client.dataSources.retrieve({ data_source_id: dataSourceId })
  if (!isFullDataSource(response)) {
    throw Error(`data source の schema を取得できませんでした: ${dataSourceId}`)
  }

  return response
}

export const resolveRelationDataSourceId = (
  schema: DataSourceObjectResponse,
  propertyName: string,
): string | null => {
  const property = schema.properties[propertyName]
  if (!property || property.type !== "relation") {
    return null
  }

  return property.relation.data_source_id
}

interface BackedUpDataSources {
  record: BackupFileRecord
  categoriesDataSourceId: string | null
}

// schema（property ID、select の option、formula）は復元時に row だけでは再現できないので row とは別に残す
export const backupNotionDataSources = async (
  dependencies: BackupDependencies,
  key: string,
): Promise<BackedUpDataSources> => {
  const { notion, dataSourceIds } = dependencies
  const posts = await retrieveDataSource(notion, dataSourceIds.posts)
  const pages = await retrieveDataSource(notion, dataSourceIds.pages)
  const comments = await retrieveDataSource(notion, dataSourceIds.comments)
  const categoriesDataSourceId = resolveRelationDataSourceId(posts, "category")
  let categories: DataSourceObjectResponse | null = null
  if (categoriesDataSourceId) {
    try {
      categories = await retrieveDataSource(notion, categoriesDataSourceId)
    } catch (err) {
      // integration が categories に接続されていなければ API からは存在ごと見えない。
      // 記事本体のバックアップは止めず、manifest の null で気づけるようにする
      if (!isNotionObjectNotFound(err)) {
        throw err
      }
      console.warn(
        JSON.stringify({
          event: "notion_backup_categories_unreachable",
          dataSourceId: categoriesDataSourceId,
        }),
      )
    }
  }
  const schemas = { posts, pages, categories, comments }

  return {
    record: await storeJson(
      dependencies,
      key,
      BACKUP_FILES.dataSources,
      schemas,
      Object.values(schemas).filter((schema) => schema !== null).length,
    ),
    categoriesDataSourceId: categories ? categoriesDataSourceId : null,
  }
}

// 1 行 = data source の 1 row。本文を持つ posts / pages は Block API の応答の木も一緒に置く
export const backupNotionRows = async (
  dependencies: BackupDependencies,
  key: string,
  file: BackupFileName,
  dataSourceId: string,
  withBlocks: boolean,
): Promise<BackupFileRecord> => {
  const writer = new GzipNdjsonWriter()
  await forEachNotionDataSourcePage(dependencies.notion, dataSourceId, async (page) => {
    if (withBlocks) {
      await writer.write({ page, blocks: await fetchNotionBlockTree(dependencies.notion, page.id) })
    } else {
      await writer.write({ page })
    }
  })

  return storeNdjson(dependencies, key, file, writer)
}

const readPublishIndex = async (
  dependencies: BackupDependencies,
): Promise<{ bytes: Uint8Array; state: SiteDeploymentState } | null> => {
  const bytes = await dependencies.readSiteObject(DEPLOYMENT_INDEX_KEY)
  if (!bytes) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw Error("publish index の JSON が壊れています")
  }

  return { bytes, state: parseDeploymentState(parsed) }
}

// 配信中の BuildPage（HTML 込み）は Container が publish のたびに snapshot として site bucket へ
// 置いている。再レンダリングはせず、publish index が指す版をそのまま集める。
// index が無い環境（bootstrap 前）では何も書かない
export const backupSite = async (
  dependencies: BackupDependencies,
  prefix: string,
): Promise<Array<BackupFileRecord>> => {
  const index = await readPublishIndex(dependencies)
  if (!index) {
    console.warn(JSON.stringify({ event: "notion_backup_publish_index_missing" }))

    return []
  }
  const pages = Object.values(index.state.pages).sort((left, right) => {
    return left.pageId.localeCompare(right.pageId)
  })
  const indexRecord = await storeBytes(
    dependencies,
    `${prefix}/${BACKUP_FILES.publishIndex}`,
    BACKUP_FILES.publishIndex,
    index.bytes,
    pages.length,
  )

  const writer = new GzipNdjsonWriter()
  let skipped = 0
  for (let offset = 0; offset < pages.length; offset += SNAPSHOT_READ_CONCURRENCY) {
    const chunk = pages.slice(offset, offset + SNAPSHOT_READ_CONCURRENCY)
    const bodies = await Promise.all(
      chunk.map((page) => {
        return dependencies.readSiteObject(publishedPageSnapshotKey(page.pageId, page.contentHash))
      }),
    )
    for (const [position, page] of chunk.entries()) {
      const body = bodies[position]
      if (!body) {
        // 非公開後に手で消した snapshot などは復元対象にならない。件数だけ manifest に残す
        skipped += 1
        console.warn(
          JSON.stringify({
            event: "notion_backup_snapshot_missing",
            pageId: page.pageId,
            contentHash: page.contentHash,
          }),
        )
        continue
      }
      await writer.write({
        pageId: page.pageId,
        status: page.status,
        contentHash: page.contentHash,
        deployedAt: page.deployedAt,
        page: JSON.parse(new TextDecoder().decode(body)),
      })
    }
  }

  return [
    indexRecord,
    await storeNdjson(
      dependencies,
      `${prefix}/${BACKUP_FILES.publishedPages}`,
      BACKUP_FILES.publishedPages,
      writer,
      skipped,
    ),
  ]
}

export const createBackupManifest = (
  input: Omit<BackupManifest, "schemaVersion" | "notion"> & {
    categoriesDataSourceId: string | null
    dataSourceIds: BackupDependencies["dataSourceIds"]
  },
): BackupManifest => {
  return {
    schemaVersion: 1,
    workflowId: input.workflowId,
    source: input.source,
    requestedAt: input.requestedAt,
    completedAt: input.completedAt,
    notion: {
      apiVersion: NOTION_API_VERSION,
      dataSourceIds: { ...input.dataSourceIds, categories: input.categoriesDataSourceId },
    },
    files: input.files,
  }
}

// R2 の内容を S3 へ複製する。R2 に置いたときの sha256 と一致しなければ壊れた object を広めない
export const copyToArchive = async (
  dependencies: BackupDependencies,
  record: BackupFileRecord,
  storageClass: S3StorageClass,
): Promise<void> => {
  const body = await dependencies.backup.get(record.key)
  if (!body) {
    throw Error(`R2 にバックアップ object がありません: ${record.key}`)
  }
  const sha256 = await sha256Hex(body)
  if (sha256 !== record.sha256) {
    throw Error(`R2 のバックアップ object が記録と一致しません: ${record.key}`)
  }
  await dependencies.archive.put(record.key, body, {
    contentType: backupContentType(record.file),
    sha256,
    storageClass,
  })
}

export const runBackupWorkflow = async ({
  workflowId,
  params,
  step,
  dependencies,
}: RunBackupWorkflowOptions): Promise<BackupWorkflowResult> => {
  const prefix = createBackupPrefix(params.requestedAt)
  const keyOf = (file: BackupFileName): string => `${prefix}/${file}`
  const { dataSourceIds } = dependencies
  const configs = BACKUP_WORKFLOW_STEP_CONFIGS

  const dataSources = await step.do("backup-notion-data-sources", configs.notion, async () => {
    return backupNotionDataSources(dependencies, keyOf(BACKUP_FILES.dataSources))
  })
  const rowFiles: Array<[string, BackupFileName, string | null, boolean]> = [
    ["backup-notion-posts", BACKUP_FILES.posts, dataSourceIds.posts, true],
    ["backup-notion-pages", BACKUP_FILES.pages, dataSourceIds.pages, true],
    [
      "backup-notion-categories",
      BACKUP_FILES.categories,
      dataSources.categoriesDataSourceId,
      false,
    ],
    ["backup-notion-comments", BACKUP_FILES.comments, dataSourceIds.comments, false],
  ]
  const files: Array<BackupFileRecord> = [dataSources.record]
  for (const [name, file, dataSourceId, withBlocks] of rowFiles) {
    if (!dataSourceId) {
      continue
    }
    files.push(
      await step.do(name, configs.notion, async () => {
        return backupNotionRows(dependencies, keyOf(file), file, dataSourceId, withBlocks)
      }),
    )
  }
  files.push(
    ...(await step.do("backup-site", configs.site, async () => backupSite(dependencies, prefix))),
  )

  const manifest = await step.do("write-manifest", configs.store, async () => {
    return storeJson(
      dependencies,
      keyOf(BACKUP_FILES.manifest),
      BACKUP_FILES.manifest,
      createBackupManifest({
        workflowId,
        source: params.source,
        requestedAt: params.requestedAt,
        completedAt: dependencies.now().toISOString(),
        categoriesDataSourceId: dataSources.categoriesDataSourceId,
        dataSourceIds,
        files,
      }),
      files.length,
    )
  })
  // manifest だけは Standard に置き、Deep Archive を復元しなくても中身を確認できるようにする。
  // 最後に書くので、manifest の存在がその回の完了を意味する
  for (const record of files) {
    await step.do(`archive-${record.file}`, configs.store, async () => {
      await copyToArchive(dependencies, record, "DEEP_ARCHIVE")
    })
  }
  await step.do(`archive-${manifest.file}`, configs.store, async () => {
    await copyToArchive(dependencies, manifest, "STANDARD")
  })

  return { workflowId, prefix, files: [...files, manifest] }
}
