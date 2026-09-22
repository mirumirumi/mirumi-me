import { describe, expect, test, vi } from "vitest"

import type { SiteDeploymentState } from "../lib/publishing"
import type { DeploymentIndexRepository } from "../repositories/deployment-index"
import {
  type PublishedSlugCache,
  PublishedSlugResolver,
  SignedS3DeploymentIndexStore,
} from "./published-slugs"

describe("PublishedSlugResolver", () => {
  const state = (slugs: Array<string>): SiteDeploymentState => ({
    schemaVersion: 1,
    updatedAt: "2026-09-21T00:00:00.000Z",
    pages: Object.fromEntries(
      slugs.map((slug, index) => {
        const pageId = `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`

        return [
          pageId,
          {
            pageId,
            kind: "post" as const,
            status: slug.startsWith("hidden") ? ("unpublished" as const) : ("published" as const),
            route: `/${slug}/`,
            slug,
            title: slug,
            excerpt: null,
            category: { name: "技術", slug: "tech" },
            publishedAt: "2026-08-24T00:00:00.000Z",
            updatedAt: null,
            thumbnailUrls: null,
            ogImageUrl: "https://mirumi.media/og.webp",
            deployedNotionEdit: "2026-08-24T00:00:00.000Z",
            deployedAt: "2026-08-24T00:00:00.000Z",
            contentHash: "hash",
            sourceHash: null,
          },
        ]
      }),
    ),
    routeOwners: {},
  })
  class MemoryCache implements PublishedSlugCache {
    values = new Map<string, string>()
    puts = 0

    async get(key: string): Promise<string | null> {
      return this.values.get(key) ?? null
    }

    async put(key: string, value: string): Promise<void> {
      this.puts += 1
      this.values.set(key, value)
    }
  }
  const createRepository = (slugs: Array<string>) => {
    return {
      load: vi.fn(async () => ({ state: state(slugs), etag: '"etag"' })),
    } as unknown as Pick<DeploymentIndexRepository, "load"> & { load: ReturnType<typeof vi.fn> }
  }

  test("公開中の記事 slug だけを許可し、結果を cache する", async () => {
    const repository = createRepository(["article", "hidden-article"])
    const cache = new MemoryCache()
    const resolver = new PublishedSlugResolver({ repository, cache })

    expect(await resolver.isPublishedPostSlug("article")).toEqual(true)
    expect(await resolver.isPublishedPostSlug("article")).toEqual(true)
    expect(repository.load).toHaveBeenCalledTimes(1)
    expect(cache.puts).toEqual(1)
    expect(JSON.parse(cache.values.get("published-post-slugs:v1")!).slugs).toEqual(["article"])
  })

  test("cache に無い slug は 1 分に 1 回だけ index を読み直す", async () => {
    const repository = createRepository(["article"])
    const cache = new MemoryCache()
    let now = new Date("2026-09-21T00:00:00.000Z")
    const resolver = new PublishedSlugResolver({ repository, cache, now: () => now })

    expect(await resolver.isPublishedPostSlug("article")).toEqual(true)
    expect(await resolver.isPublishedPostSlug("unknown")).toEqual(false)
    expect(repository.load).toHaveBeenCalledTimes(1)
    now = new Date("2026-09-21T00:02:00.000Z")
    repository.load.mockResolvedValueOnce({ state: state(["article", "new-post"]), etag: '"e"' })
    expect(await resolver.isPublishedPostSlug("new-post")).toEqual(true)
    expect(repository.load).toHaveBeenCalledTimes(2)
  })

  test("index を読めなくても cache があれば受付を続ける", async () => {
    const repository = createRepository(["article"])
    const cache = new MemoryCache()
    let now = new Date("2026-09-21T00:00:00.000Z")
    const resolver = new PublishedSlugResolver({ repository, cache, now: () => now })
    await resolver.isPublishedPostSlug("article")
    now = new Date("2026-09-21T00:05:00.000Z")
    repository.load.mockRejectedValueOnce(Error("s3 down"))

    expect(await resolver.isPublishedPostSlug("unknown")).toEqual(false)
    expect(await resolver.isPublishedPostSlug("article")).toEqual(true)
  })

  test("cache も index も無ければ失敗する", async () => {
    const repository = createRepository([])
    repository.load.mockRejectedValueOnce(Error("s3 down"))
    const resolver = new PublishedSlugResolver({ repository, cache: null })

    await expect(resolver.isPublishedPostSlug("article")).rejects.toThrowError("s3 down")
  })
})

describe("SignedS3DeploymentIndexStore", () => {
  test("署名付き GET で index を読み、404 は null にする", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 200, headers: { ETag: '"abc"' } }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const store = new SignedS3DeploymentIndexStore({
      fetcher,
      region: "ap-northeast-1",
      bucket: "bucket",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
    })

    expect(await store.get("_internal/publish-index-v1.json")).toEqual({
      body: "{}",
      etag: '"abc"',
    })
    expect(await store.get("_internal/publish-index-v1.json")).toEqual(null)
    const [url, init] = fetcher.mock.calls[0]!
    expect(String(url)).toEqual(
      "https://bucket.s3.ap-northeast-1.amazonaws.com/_internal/publish-index-v1.json",
    )
    expect((init?.headers as Record<string, string>).authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/ap-northeast-1\/s3\/aws4_request, /,
    )
    await expect(store.put()).rejects.toThrowError()
  })
})
