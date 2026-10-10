import { describe, expect, test } from "vitest"

import { createEmptyDeploymentState } from "../lib/publishing"
import {
  DeploymentIndexRepository,
  type DeploymentIndexStore,
  type DeploymentIndexStoredObject,
  type DeploymentIndexWriteCondition,
} from "./deployment-index"

describe("DeploymentIndexRepository", () => {
  class MemoryStore implements DeploymentIndexStore {
    object: DeploymentIndexStoredObject | null
    writes: Array<{
      key: string
      body: string
      condition: DeploymentIndexWriteCondition
    }> = []

    constructor(object: DeploymentIndexStoredObject | null) {
      this.object = object
    }

    async get(): Promise<DeploymentIndexStoredObject | null> {
      return this.object
    }

    async put(
      key: string,
      body: string,
      condition: DeploymentIndexWriteCondition,
    ): Promise<string> {
      this.writes.push({ key, body, condition })
      this.object = { body, etag: "next-etag" }

      return "next-etag"
    }
  }

  const validState = {
    schemaVersion: 1,
    updatedAt: "2026-08-24T00:00:00.000Z",
    pages: {},
    routeOwners: {},
  } as const

  test("通常 load では index 不存在を許可しない", async () => {
    const repository = new DeploymentIndexRepository(new MemoryStore(null))

    await expect(repository.load(false, "2026-08-24T00:00:00.000Z")).rejects.toThrow(
      "publish index が存在しません",
    )
  })

  test("bootstrap だけ空の index と If-None-Match 用 version を返す", async () => {
    const repository = new DeploymentIndexRepository(new MemoryStore(null))

    expect(await repository.load(true, "2026-08-24T00:00:00.000Z")).toEqual({
      state: createEmptyDeploymentState("2026-08-24T00:00:00.000Z"),
      etag: null,
    })
  })

  test("schema を検証して ETag と一緒に返す", async () => {
    const repository = new DeploymentIndexRepository(
      new MemoryStore({ body: JSON.stringify(validState), etag: '"etag-1"' }),
    )

    expect(await repository.load(false, "ignored")).toEqual({
      state: validState,
      etag: '"etag-1"',
    })
  })

  test("sourceHash を持たない旧 index は null として読む", async () => {
    const pageId = "3c065425-ad40-811a-b50b-000b9271df2c"
    const legacyPage = {
      pageId,
      kind: "post",
      status: "published",
      route: "/article/",
      slug: "article",
      title: "記事",
      excerpt: "概要",
      category: { name: "技術", slug: "tech" },
      publishedAt: "2026-08-20T00:00:00.000Z",
      updatedAt: null,
      thumbnailUrls: null,
      ogImageUrl: "https://mirumi.media/og.webp",
      deployedNotionEdit: "2026-08-24T00:00:00.000Z",
      deployedAt: "2026-08-24T00:00:00.000Z",
      contentHash: "hash",
    }
    const repository = new DeploymentIndexRepository(
      new MemoryStore({
        body: JSON.stringify({
          ...validState,
          pages: { [pageId]: legacyPage },
          routeOwners: { "/article/": pageId },
        }),
        etag: '"etag-1"',
      }),
    )
    expect((await repository.load(false, "ignored")).state.pages[pageId]?.sourceHash).toEqual(null)
  })

  test("既存 ETag は If-Match、bootstrap は If-None-Match で保存する", async () => {
    const existingStore = new MemoryStore(null)
    const bootstrapStore = new MemoryStore(null)
    const existingRepository = new DeploymentIndexRepository(existingStore)
    const bootstrapRepository = new DeploymentIndexRepository(bootstrapStore)

    expect(await existingRepository.save(validState, '"etag-1"')).toEqual("next-etag")
    expect(await bootstrapRepository.save(validState, null)).toEqual("next-etag")
    expect(existingStore.writes.at(0)?.condition).toEqual({
      ifMatch: '"etag-1"',
      ifNoneMatch: false,
    })
    expect(bootstrapStore.writes.at(0)?.condition).toEqual({
      ifMatch: null,
      ifNoneMatch: true,
    })
  })

  test("壊れた JSON と未知の schema version を拒否する", async () => {
    const invalidJson = new DeploymentIndexRepository(
      new MemoryStore({ body: "{", etag: '"etag"' }),
    )
    const unknownVersion = new DeploymentIndexRepository(
      new MemoryStore({
        body: JSON.stringify({ ...validState, schemaVersion: 2 }),
        etag: '"etag"',
      }),
    )

    await expect(invalidJson.load(false, "ignored")).rejects.toThrow(
      "publish index の JSON が壊れています",
    )
    await expect(unknownVersion.load(false, "ignored")).rejects.toThrow(
      "publish index の schema が不正です",
    )
  })

  test("page と route ownership が食い違う index を拒否する", async () => {
    const pageId = "3c065425-ad40-811a-b50b-000b9271df2c"
    const invalidOwnership = new DeploymentIndexRepository(
      new MemoryStore({
        body: JSON.stringify({
          ...validState,
          pages: {
            [pageId]: {
              pageId,
              kind: "post",
              status: "published",
              route: "/article/",
              slug: "article",
              title: "記事",
              excerpt: "概要",
              category: { name: "技術", slug: "tech" },
              publishedAt: "2026-08-20T00:00:00.000Z",
              updatedAt: null,
              thumbnailUrls: null,
              ogImageUrl: "https://mirumi.media/og.webp",
              deployedNotionEdit: "2026-08-24T00:00:00.000Z",
              deployedAt: "2026-08-24T00:00:00.000Z",
              contentHash: "hash",
              sourceHash: null,
            },
          },
          routeOwners: {},
        }),
        etag: '"etag"',
      }),
    )

    await expect(invalidOwnership.load(false, "ignored")).rejects.toThrow(
      "publish index の schema が不正です",
    )
  })
})
