import { describe, expect, test } from "vitest"

import type { BuildPage } from "shared/build-manifest"
import { parseBuildPage } from "shared/build-manifest"

import type { SiteObject, SiteObjectStore } from "./aws"
import {
  createBuildPageContentHash,
  PublishedPageSnapshotStore,
  publishedPageSnapshotKey,
} from "./published-pages"

describe("PublishedPageSnapshotStore", () => {
  class MemoryStore implements Pick<SiteObjectStore, "get" | "put"> {
    objects = new Map<string, SiteObject>()

    async get(key: string): Promise<Uint8Array | null> {
      return this.objects.get(key)?.body ?? null
    }

    async put(key: string, object: SiteObject): Promise<void> {
      this.objects.set(key, object)
    }
  }
  const page: BuildPage = parseBuildPage({
    schemaVersion: 1,
    pageId: "00000000-0000-0000-0000-000000000001",
    kind: "post",
    title: "記事",
    slug: "article",
    contentHtml: "<p>本文</p>",
    excerpt: "本文",
    thumbnailUrls: null,
    ogImageUrl: "https://mirumi.media/og.webp",
    publishedAt: "2026-08-24T01:00:00.000Z",
    updatedAt: null,
    category: { name: "技術", slug: "tech" },
    customCss: "",
    warnings: [],
    comments: [
      {
        id: "123",
        parentId: null,
        authorName: "読者",
        createdAt: "2026-08-25T00:00:00.000Z",
        contentHtml: "<p>コメント</p>",
        isOwner: false,
      },
    ],
  })

  describe("publishedPageSnapshotKey", () => {
    test("page ID と content hash から `_internal` 配下の key を作る", () => {
      expect(publishedPageSnapshotKey(page.pageId, "abc123")).toEqual(
        "_internal/published-pages-v1/00000000-0000-0000-0000-000000000001/abc123.json",
      )
      expect(() => publishedPageSnapshotKey("../x", "abc")).toThrowError()
      expect(() => publishedPageSnapshotKey(page.pageId, "a/b")).toThrowError()
    })
  })

  describe("save / load", () => {
    test("保存した BuildPage を content hash で取り出せる", async () => {
      const store = new MemoryStore()
      const snapshots = new PublishedPageSnapshotStore(store)
      const hash = createBuildPageContentHash(page)
      await snapshots.save(page, hash)

      expect([...store.objects.keys()]).toEqual([publishedPageSnapshotKey(page.pageId, hash)])
      expect(store.objects.get(publishedPageSnapshotKey(page.pageId, hash))?.cacheControl).toEqual(
        "no-store",
      )
      expect(await snapshots.load(page.pageId, hash)).toEqual(page)
      expect(await snapshots.load(page.pageId, "0000")).toEqual(null)
    })

    test("key と内容が食い違う snapshot は使わない", async () => {
      const store = new MemoryStore()
      const snapshots = new PublishedPageSnapshotStore(store)
      await snapshots.save(page, "dead")

      await expect(snapshots.load(page.pageId, "dead")).rejects.toThrowError(
        "内容が key と一致しません",
      )
    })
  })
})
