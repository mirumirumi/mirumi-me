import { APIErrorCode, APIResponseError, type Client } from "@notionhq/client"
import { describe, expect, test, vi } from "vitest"

import { BACKUP_FILES, type BackupWorkflowParams } from "../lib/backup"
import type { SiteDeploymentState } from "../lib/publishing"
import {
  type ArchiveStore,
  BACKUP_WORKFLOW_STEP_CONFIGS,
  type BackupDependencies,
  type BackupStore,
  backupContentType,
  backupNotionDataSources,
  backupNotionRows,
  backupSite,
  copyToArchive,
  createBackupInstanceId,
  createBackupManifest,
  createBackupPrefix,
  formatBackupTimestamp,
  GzipNdjsonWriter,
  resolveRelationDataSourceId,
  runBackupWorkflow,
  startScheduledBackup,
} from "./backup"
import type { WorkflowStepExecutor } from "./publish-workflow"
import type { S3StorageClass } from "./s3-object-store"

describe("backup", () => {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const POST_ID = "00000000-0000-0000-0000-000000000001"
  const PAGE_ID = "00000000-0000-0000-0000-000000000002"

  interface StoredObject {
    body: Uint8Array
    contentType: string
    sha256: string
    storageClass: S3StorageClass | null
  }

  class MemoryStore implements BackupStore, ArchiveStore {
    objects = new Map<string, StoredObject>()

    async get(key: string): Promise<Uint8Array | null> {
      return this.objects.get(key)?.body ?? null
    }

    async put(
      key: string,
      body: Uint8Array,
      options: { contentType: string; sha256: string; storageClass?: S3StorageClass },
    ): Promise<void> {
      this.objects.set(key, {
        body,
        contentType: options.contentType,
        sha256: options.sha256,
        storageClass: options.storageClass ?? null,
      })
    }
  }

  class MemoryStep implements WorkflowStepExecutor {
    calls: Array<{ name: string; config: unknown }> = []

    async do<T>(name: string, config: unknown, callback: () => Promise<T>): Promise<T> {
      this.calls.push({ name, config })

      return callback()
    }
  }

  const gunzipLines = async (bytes: Uint8Array): Promise<Array<unknown>> => {
    const stream = new Blob([bytes as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
    const text = await new Response(stream).text()

    return text
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line))
  }
  const sha256 = async (bytes: Uint8Array): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)

    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  }
  const schema = (id: string, properties: Record<string, unknown> = {}) => ({
    object: "data_source",
    id,
    title: [],
    properties,
    in_trash: false,
  })
  const page = (id: string) => ({ object: "page", id, properties: {}, url: `https://n/${id}` })
  const listResponse = (results: Array<unknown>) => ({
    object: "list",
    results,
    next_cursor: null,
    has_more: false,
  })
  const notFound = () =>
    new APIResponseError({
      code: APIErrorCode.ObjectNotFound,
      message: "not found",
      status: 404,
      headers: {},
      rawBodyText: "",
      additional_data: undefined,
      request_id: undefined,
    })
  interface FakeNotion {
    schemas: Record<string, unknown>
    rows: Record<string, Array<unknown>>
    blocks: Record<string, Array<unknown>>
  }
  const createClient = (fake: Partial<FakeNotion> = {}): Client => {
    const { schemas = {}, rows = {}, blocks = {} } = fake

    return {
      dataSources: {
        retrieve: vi.fn(async ({ data_source_id }: { data_source_id: string }) => {
          const found = schemas[data_source_id]
          if (!found) {
            throw notFound()
          }

          return found
        }),
        query: vi.fn(async ({ data_source_id }: { data_source_id: string }) => {
          return listResponse(rows[data_source_id] ?? [])
        }),
      },
      blocks: {
        children: {
          list: vi.fn(async ({ block_id }: { block_id: string }) => {
            return { ...listResponse(blocks[block_id] ?? []), type: "block", block: {} }
          }),
        },
      },
    } as unknown as Client
  }
  const deploymentState = (
    pages: Array<{ pageId: string; contentHash: string; status: "published" | "unpublished" }>,
  ): SiteDeploymentState => ({
    schemaVersion: 1,
    updatedAt: "2026-09-22T00:00:00.000Z",
    pages: Object.fromEntries(
      pages.map(({ pageId, contentHash, status }) => [
        pageId,
        {
          pageId,
          kind: "post",
          status,
          route: `/${pageId}/`,
          slug: pageId,
          title: "記事",
          excerpt: "",
          category: { name: "雑記", slug: "misc" },
          publishedAt: "2026-09-01T00:00:00.000Z",
          updatedAt: null,
          thumbnailUrls: null,
          ogImageUrl: "https://mirumi.media/og.webp",
          deployedNotionEdit: "2026-09-01T00:00:00.000Z",
          deployedAt: "2026-09-01T00:00:00.000Z",
          contentHash,
          sourceHash: null,
        },
      ]),
    ),
    routeOwners: Object.fromEntries(pages.map(({ pageId }) => [`/${pageId}/`, pageId])),
  })
  const createDependencies = (
    overrides: Partial<Omit<BackupDependencies, "backup" | "archive">> & {
      siteObjects?: Record<string, unknown>
    } = {},
  ): BackupDependencies & { backup: MemoryStore; archive: MemoryStore } => {
    const { siteObjects = {}, ...rest } = overrides

    return {
      notion: createClient(),
      dataSourceIds: { posts: "posts-source", pages: "pages-source", comments: "comments-source" },
      readSiteObject: async (key) => {
        const value = siteObjects[key]

        return value === undefined ? null : encoder.encode(JSON.stringify(value))
      },
      backup: new MemoryStore(),
      archive: new MemoryStore(),
      now: () => new Date("2026-09-22T19:12:00.000Z"),
      ...rest,
    }
  }

  describe("formatBackupTimestamp", () => {
    test("ミリ秒を落として `:` を `-` にし、UTC に揃える", () => {
      expect(formatBackupTimestamp("2026-09-22T19:00:00.000Z")).toEqual("2026-09-22T19-00-00Z")
      expect(formatBackupTimestamp("2026-09-23T04:00:00+09:00")).toEqual("2026-09-22T19-00-00Z")
      expect(() => formatBackupTimestamp("yesterday")).toThrowError()
    })
  })

  describe("createBackupPrefix", () => {
    test("形式 version を先頭に付ける", () => {
      expect(createBackupPrefix("2026-09-22T19:00:00.000Z")).toEqual("v1/2026-09-22T19-00-00Z")
    })
  })

  describe("createBackupInstanceId", () => {
    test("Cron の発火時刻から Workflow の instance ID を決める", () => {
      expect(createBackupInstanceId(Date.parse("2026-09-22T19:00:00.000Z"))).toEqual(
        "backup-2026-09-22T19-00-00Z",
      )
    })
  })

  describe("startScheduledBackup", () => {
    test("発火時刻を ID と requestedAt にして createBatch で起動する", async () => {
      const createBatch = vi.fn(async () => [{ id: "backup-2026-09-22T19-00-00Z" }])

      expect(
        await startScheduledBackup({ createBatch }, Date.parse("2026-09-22T19:00:00.000Z")),
      ).toEqual({ workflowId: "backup-2026-09-22T19-00-00Z", created: true })
      expect(createBatch).toHaveBeenCalledWith([
        {
          id: "backup-2026-09-22T19-00-00Z",
          params: { source: "cron", requestedAt: "2026-09-22T19:00:00.000Z" },
        },
      ])
    })

    test("同じ発火の重複は作成済みとして捨てる", async () => {
      const createBatch = vi.fn(async () => [])

      expect(
        await startScheduledBackup({ createBatch }, Date.parse("2026-09-22T19:00:00.000Z")),
      ).toEqual({ workflowId: "backup-2026-09-22T19-00-00Z", created: false })
    })
  })

  describe("backupContentType", () => {
    test("gzip と JSON で分ける", () => {
      expect(backupContentType(BACKUP_FILES.posts)).toEqual("application/gzip")
      expect(backupContentType(BACKUP_FILES.manifest)).toEqual("application/json; charset=utf-8")
    })
  })

  describe("GzipNdjsonWriter", () => {
    test("1 行 1 JSON を gzip にまとめ、行数を返す", async () => {
      const writer = new GzipNdjsonWriter()
      await writer.write({ id: 1, text: "あ" })
      await writer.write({ id: 2 })
      const { bytes, lines } = await writer.finish()

      expect(lines).toEqual(2)
      expect(await gunzipLines(bytes)).toEqual([{ id: 1, text: "あ" }, { id: 2 }])
    })

    test("何も書かなくても空の gzip になる", async () => {
      const { bytes, lines } = await new GzipNdjsonWriter().finish()

      expect(lines).toEqual(0)
      expect(await gunzipLines(bytes)).toEqual([])
    })
  })

  describe("resolveRelationDataSourceId", () => {
    test("relation property の接続先 data source を返し、無ければ null", () => {
      const found = schema("posts", {
        category: { type: "relation", relation: { data_source_id: "categories-source" } },
        title: { type: "title", title: {} },
      })

      expect(resolveRelationDataSourceId(found as never, "category")).toEqual("categories-source")
      expect(resolveRelationDataSourceId(found as never, "title")).toEqual(null)
      expect(resolveRelationDataSourceId(found as never, "missing")).toEqual(null)
    })
  })

  describe("backupNotionDataSources", () => {
    const schemas = {
      "posts-source": schema("posts-source", {
        category: { type: "relation", relation: { data_source_id: "categories-source" } },
      }),
      "pages-source": schema("pages-source"),
      "comments-source": schema("comments-source"),
    }

    test("4 つの schema を 1 つの JSON に置き、categories の ID を返す", async () => {
      const dependencies = createDependencies({
        notion: createClient({
          schemas: { ...schemas, "categories-source": schema("categories-source") },
        }),
      })

      const result = await backupNotionDataSources(dependencies, "v1/x/notion-data-sources.json")

      expect(result.categoriesDataSourceId).toEqual("categories-source")
      expect(result.record).toEqual({
        file: BACKUP_FILES.dataSources,
        key: "v1/x/notion-data-sources.json",
        bytes: expect.any(Number),
        sha256: expect.any(String),
        count: 4,
        skipped: 0,
      })
      const stored = dependencies.backup.objects.get("v1/x/notion-data-sources.json")!
      expect(JSON.parse(decoder.decode(stored.body))).toEqual({
        posts: schemas["posts-source"],
        pages: schemas["pages-source"],
        categories: schema("categories-source"),
        comments: schemas["comments-source"],
      })
      expect(stored.sha256).toEqual(await sha256(stored.body))
      expect(stored.contentType).toEqual("application/json; charset=utf-8")
    })

    test("integration が categories に届かなければ null にして続行する", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const dependencies = createDependencies({ notion: createClient({ schemas }) })

      const result = await backupNotionDataSources(dependencies, "v1/x/notion-data-sources.json")

      expect(result.categoriesDataSourceId).toEqual(null)
      expect(result.record.count).toEqual(3)
      expect(
        JSON.parse(decoder.decode(dependencies.backup.objects.get(result.record.key)!.body))
          .categories,
      ).toEqual(null)
    })

    test("categories 以外の schema が取れなければ失敗する", async () => {
      const dependencies = createDependencies({
        notion: createClient({ schemas: { "posts-source": schemas["posts-source"] } }),
      })

      await expect(backupNotionDataSources(dependencies, "v1/x/a.json")).rejects.toThrowError()
    })
  })

  describe("backupNotionRows", () => {
    test("row と Block API の木を 1 行にまとめて gzip で置く", async () => {
      const block = { object: "block", id: "b1", type: "paragraph", has_children: false }
      const dependencies = createDependencies({
        notion: createClient({
          rows: { "posts-source": [page(POST_ID), page(PAGE_ID)] },
          blocks: { [POST_ID]: [block] },
        }),
      })

      const record = await backupNotionRows(
        dependencies,
        "v1/x/notion-posts.ndjson.gz",
        BACKUP_FILES.posts,
        "posts-source",
        true,
      )

      expect(record).toEqual(
        expect.objectContaining({ file: BACKUP_FILES.posts, count: 2, skipped: 0 }),
      )
      const stored = dependencies.backup.objects.get("v1/x/notion-posts.ndjson.gz")!
      expect(stored.contentType).toEqual("application/gzip")
      expect(await gunzipLines(stored.body)).toEqual([
        { page: page(POST_ID), blocks: [{ block, children: [] }] },
        { page: page(PAGE_ID), blocks: [] },
      ])
    })

    test("本文を持たない data source は row だけを置き、Block API を呼ばない", async () => {
      const notion = createClient({ rows: { "comments-source": [page("c1")] } })
      const dependencies = createDependencies({ notion })

      await backupNotionRows(
        dependencies,
        "v1/x/notion-comments.ndjson.gz",
        BACKUP_FILES.comments,
        "comments-source",
        false,
      )

      expect(
        await gunzipLines(dependencies.backup.objects.get("v1/x/notion-comments.ndjson.gz")!.body),
      ).toEqual([{ page: page("c1") }])
      expect(notion.blocks.children.list).not.toHaveBeenCalled()
    })
  })

  describe("backupSite", () => {
    const state = deploymentState([
      { pageId: PAGE_ID, contentHash: "bbb", status: "unpublished" },
      { pageId: POST_ID, contentHash: "aaa", status: "published" },
    ])
    const snapshot = (pageId: string) => ({ schemaVersion: 1, pageId, contentHtml: "<p>本文</p>" })

    test("publish index をそのまま置き、index が指す snapshot を page ID 順に集める", async () => {
      const dependencies = createDependencies({
        siteObjects: {
          "_internal/publish-index-v1.json": state,
          [`_internal/published-pages-v1/${POST_ID}/aaa.json`]: snapshot(POST_ID),
          [`_internal/published-pages-v1/${PAGE_ID}/bbb.json`]: snapshot(PAGE_ID),
        },
      })

      const records = await backupSite(dependencies, "v1/x")

      expect(records).toEqual([
        expect.objectContaining({
          file: BACKUP_FILES.publishIndex,
          key: "v1/x/publish-index.json",
          count: 2,
        }),
        expect.objectContaining({
          file: BACKUP_FILES.publishedPages,
          key: "v1/x/published-pages.ndjson.gz",
          count: 2,
          skipped: 0,
        }),
      ])
      expect(
        JSON.parse(
          decoder.decode(dependencies.backup.objects.get("v1/x/publish-index.json")!.body),
        ),
      ).toEqual(state)
      expect(
        await gunzipLines(dependencies.backup.objects.get("v1/x/published-pages.ndjson.gz")!.body),
      ).toEqual([
        {
          pageId: POST_ID,
          status: "published",
          contentHash: "aaa",
          deployedAt: "2026-09-01T00:00:00.000Z",
          page: snapshot(POST_ID),
        },
        {
          pageId: PAGE_ID,
          status: "unpublished",
          contentHash: "bbb",
          deployedAt: "2026-09-01T00:00:00.000Z",
          page: snapshot(PAGE_ID),
        },
      ])
    })

    test("snapshot が無い page は件数だけ残して飛ばす", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const dependencies = createDependencies({
        siteObjects: {
          "_internal/publish-index-v1.json": state,
          [`_internal/published-pages-v1/${POST_ID}/aaa.json`]: snapshot(POST_ID),
        },
      })

      const records = await backupSite(dependencies, "v1/x")

      expect(records[1]).toEqual(expect.objectContaining({ count: 1, skipped: 1 }))
    })

    test("publish index が無い環境では何も置かない", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const dependencies = createDependencies()

      expect(await backupSite(dependencies, "v1/x")).toEqual([])
      expect(dependencies.backup.objects.size).toEqual(0)
    })

    test("壊れた publish index は失敗にする", async () => {
      const dependencies = createDependencies({
        readSiteObject: async () => encoder.encode("{not json"),
      })

      await expect(backupSite(dependencies, "v1/x")).rejects.toThrowError(
        "publish index の JSON が壊れています",
      )
    })
  })

  describe("createBackupManifest", () => {
    test("Notion の API version と data source ID を添える", () => {
      const manifest = createBackupManifest({
        workflowId: "backup-1",
        source: "cron",
        requestedAt: "2026-09-22T19:00:00.000Z",
        completedAt: "2026-09-22T19:12:00.000Z",
        categoriesDataSourceId: null,
        dataSourceIds: { posts: "p", pages: "g", comments: "c" },
        files: [],
      })

      expect(manifest).toEqual({
        schemaVersion: 1,
        workflowId: "backup-1",
        source: "cron",
        requestedAt: "2026-09-22T19:00:00.000Z",
        completedAt: "2026-09-22T19:12:00.000Z",
        notion: {
          apiVersion: "2026-03-11",
          dataSourceIds: { posts: "p", pages: "g", categories: null, comments: "c" },
        },
        files: [],
      })
    })
  })

  describe("copyToArchive", () => {
    const record = async (dependencies: BackupDependencies, body: string) => {
      const bytes = encoder.encode(body)
      const digest = await sha256(bytes)
      await dependencies.backup.put("v1/x/publish-index.json", bytes, {
        contentType: "application/json; charset=utf-8",
        sha256: digest,
      })

      return {
        file: BACKUP_FILES.publishIndex,
        key: "v1/x/publish-index.json",
        bytes: bytes.byteLength,
        sha256: digest,
        count: 1,
        skipped: 0,
      }
    }

    test("R2 の内容を hash 照合してから指定の storage class で S3 に置く", async () => {
      const dependencies = createDependencies()

      await copyToArchive(dependencies, await record(dependencies, "{}"), "DEEP_ARCHIVE")

      expect(dependencies.archive.objects.get("v1/x/publish-index.json")).toEqual({
        body: encoder.encode("{}"),
        contentType: "application/json; charset=utf-8",
        sha256: await sha256(encoder.encode("{}")),
        storageClass: "DEEP_ARCHIVE",
      })
    })

    test("R2 に無い、または hash が違う object は S3 へ広めない", async () => {
      const dependencies = createDependencies()
      const stored = await record(dependencies, "{}")

      await expect(
        copyToArchive(dependencies, { ...stored, key: "v1/x/missing.json" }, "DEEP_ARCHIVE"),
      ).rejects.toThrowError("R2 にバックアップ object がありません")
      await expect(
        copyToArchive(dependencies, { ...stored, sha256: "0".repeat(64) }, "DEEP_ARCHIVE"),
      ).rejects.toThrowError("記録と一致しません")
      expect(dependencies.archive.objects.size).toEqual(0)
    })
  })

  describe("runBackupWorkflow", () => {
    const params: BackupWorkflowParams = { source: "cron", requestedAt: "2026-09-22T19:00:00.000Z" }
    const schemas = {
      "posts-source": schema("posts-source", {
        category: { type: "relation", relation: { data_source_id: "categories-source" } },
      }),
      "pages-source": schema("pages-source"),
      "comments-source": schema("comments-source"),
    }

    test("Notion → site → manifest の順に R2 へ置き、その後ファイルごとに S3 へ複製する", async () => {
      const step = new MemoryStep()
      const dependencies = createDependencies({
        notion: createClient({
          schemas: { ...schemas, "categories-source": schema("categories-source") },
          rows: {
            "posts-source": [page(POST_ID)],
            "pages-source": [page(PAGE_ID)],
            "categories-source": [page("cat")],
            "comments-source": [page("c1"), page("c2")],
          },
        }),
        siteObjects: {
          "_internal/publish-index-v1.json": deploymentState([
            { pageId: POST_ID, contentHash: "aaa", status: "published" },
          ]),
          [`_internal/published-pages-v1/${POST_ID}/aaa.json`]: { pageId: POST_ID },
        },
      })

      const result = await runBackupWorkflow({ workflowId: "backup-1", params, step, dependencies })

      expect(result.prefix).toEqual("v1/2026-09-22T19-00-00Z")
      expect(result.files.map(({ file, count }) => [file, count])).toEqual([
        [BACKUP_FILES.dataSources, 4],
        [BACKUP_FILES.posts, 1],
        [BACKUP_FILES.pages, 1],
        [BACKUP_FILES.categories, 1],
        [BACKUP_FILES.comments, 2],
        [BACKUP_FILES.publishIndex, 1],
        [BACKUP_FILES.publishedPages, 1],
        [BACKUP_FILES.manifest, 7],
      ])
      const configs = BACKUP_WORKFLOW_STEP_CONFIGS
      expect(step.calls).toEqual([
        { name: "backup-notion-data-sources", config: configs.notion },
        { name: "backup-notion-posts", config: configs.notion },
        { name: "backup-notion-pages", config: configs.notion },
        { name: "backup-notion-categories", config: configs.notion },
        { name: "backup-notion-comments", config: configs.notion },
        { name: "backup-site", config: configs.site },
        { name: "write-manifest", config: configs.store },
        { name: "archive-notion-data-sources.json", config: configs.store },
        { name: "archive-notion-posts.ndjson.gz", config: configs.store },
        { name: "archive-notion-pages.ndjson.gz", config: configs.store },
        { name: "archive-notion-categories.ndjson.gz", config: configs.store },
        { name: "archive-notion-comments.ndjson.gz", config: configs.store },
        { name: "archive-publish-index.json", config: configs.store },
        { name: "archive-published-pages.ndjson.gz", config: configs.store },
        { name: "archive-manifest.json", config: configs.store },
      ])
      // R2 と S3 に同じ key で同じ bytes が並ぶ。manifest だけ Standard、それ以外は Deep Archive
      expect([...dependencies.archive.objects.keys()]).toEqual([
        ...dependencies.backup.objects.keys(),
      ])
      for (const [key, archived] of dependencies.archive.objects) {
        expect(archived.body).toEqual(dependencies.backup.objects.get(key)!.body)
        expect(archived.storageClass).toEqual(
          key.endsWith("/manifest.json") ? "STANDARD" : "DEEP_ARCHIVE",
        )
      }
      const manifest = JSON.parse(
        decoder.decode(
          dependencies.backup.objects.get("v1/2026-09-22T19-00-00Z/manifest.json")!.body,
        ),
      )
      expect(manifest).toEqual({
        schemaVersion: 1,
        workflowId: "backup-1",
        source: "cron",
        requestedAt: "2026-09-22T19:00:00.000Z",
        completedAt: "2026-09-22T19:12:00.000Z",
        notion: {
          apiVersion: "2026-03-11",
          dataSourceIds: {
            posts: "posts-source",
            pages: "pages-source",
            categories: "categories-source",
            comments: "comments-source",
          },
        },
        files: result.files.slice(0, -1),
      })
    })

    test("categories に届かない・publish index が無いときはその step と file を省く", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const step = new MemoryStep()
      const dependencies = createDependencies({ notion: createClient({ schemas }) })

      const result = await runBackupWorkflow({ workflowId: "backup-1", params, step, dependencies })

      expect(result.files.map(({ file }) => file)).toEqual([
        BACKUP_FILES.dataSources,
        BACKUP_FILES.posts,
        BACKUP_FILES.pages,
        BACKUP_FILES.comments,
        BACKUP_FILES.manifest,
      ])
      expect(step.calls.map(({ name }) => name)).not.toContain("backup-notion-categories")
      expect(dependencies.archive.objects.size).toEqual(5)
    })

    test("S3 への複製に失敗しても R2 の object は残り、例外はそのまま上がる", async () => {
      const step = new MemoryStep()
      const dependencies = createDependencies({ notion: createClient({ schemas }) })
      vi.spyOn(console, "warn").mockImplementation(() => undefined)
      vi.spyOn(dependencies.archive, "put").mockRejectedValue(Error("S3 down"))

      await expect(
        runBackupWorkflow({ workflowId: "backup-1", params, step, dependencies }),
      ).rejects.toThrowError("S3 down")
      expect(dependencies.backup.objects.size).toEqual(5)
    })
  })
})
