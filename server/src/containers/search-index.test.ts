import { describe, expect, test } from "vitest"

import type { BuildPage } from "shared/build-manifest"
import { SEARCH_INDEX_KEY, type SearchIndex } from "shared/search"

import type { DeployedPage, SiteDeploymentState } from "../lib/publishing"
import type { SiteObject, SiteObjectStore } from "./aws"
import { refreshSearchIndex, updateSearchIndex } from "./search-index"

describe("search index", () => {
  const ids = {
    rebuilt: "00000000-0000-0000-0000-000000000001",
    kept: "00000000-0000-0000-0000-000000000002",
    unpublished: "00000000-0000-0000-0000-000000000003",
    fixedPage: "00000000-0000-0000-0000-000000000004",
    removed: "00000000-0000-0000-0000-000000000005",
  }

  const makeDeployedPage = (
    pageId: string,
    slug: string,
    overrides: Partial<DeployedPage> = {},
  ): DeployedPage => {
    return {
      pageId,
      kind: "post",
      status: "published",
      route: `/${slug}/`,
      slug,
      title: `${slug} の記事`,
      excerpt: null,
      category: { name: "技術", slug: "tech" },
      publishedAt: "2026-08-20T00:00:00.000Z",
      updatedAt: null,
      thumbnailUrls: null,
      ogImageUrl: "https://mirumi.media/og.webp",
      deployedNotionEdit: "2026-08-20T00:00:00.000Z",
      deployedAt: "2026-08-20T00:00:00.000Z",
      contentHash: `hash-${slug}`,
      sourceHash: null,
      ...overrides,
    }
  }

  const makeState = (pages: Array<DeployedPage>): SiteDeploymentState => {
    return {
      schemaVersion: 1,
      updatedAt: "2026-08-24T00:00:00.000Z",
      pages: Object.fromEntries(pages.map((page) => [page.pageId, page])),
      routeOwners: Object.fromEntries(pages.map((page) => [page.route, page.pageId])),
    }
  }

  const makeBuildPage = (pageId: string, contentHtml: string): BuildPage => {
    return {
      schemaVersion: 1,
      pageId,
      kind: "post",
      title: "記事",
      slug: "article",
      contentHtml,
      excerpt: "",
      thumbnailUrls: null,
      ogImageUrl: "https://mirumi.media/og.webp",
      publishedAt: "2026-08-20T00:00:00.000Z",
      updatedAt: null,
      category: { name: "技術", slug: "tech" },
      customCss: "",
      warnings: [],
      comments: [],
    }
  }

  const state = makeState([
    makeDeployedPage(ids.rebuilt, "rebuilt", {
      title: "新しい題名",
      updatedAt: "2026-08-24T00:00:00.000Z",
    }),
    makeDeployedPage(ids.kept, "kept"),
    makeDeployedPage(ids.unpublished, "hidden", { status: "unpublished" }),
    makeDeployedPage(ids.fixedPage, "profile", { kind: "page", category: null }),
  ])

  const current: SearchIndex = {
    schemaVersion: 1,
    updatedAt: "2026-08-20T00:00:00.000Z",
    posts: [
      {
        pageId: ids.rebuilt,
        slug: "rebuilt",
        title: "古い題名",
        publishedAt: "2026-08-20T00:00:00.000Z",
        updatedAt: null,
        text: "古い本文",
      },
      {
        pageId: ids.kept,
        slug: "kept",
        title: "kept の記事",
        publishedAt: "2026-08-20T00:00:00.000Z",
        updatedAt: null,
        text: "残す本文",
      },
      {
        pageId: ids.removed,
        slug: "removed",
        title: "消した記事",
        publishedAt: "2026-08-20T00:00:00.000Z",
        updatedAt: null,
        text: "消える本文",
      },
    ],
  }

  describe("updateSearchIndex", () => {
    test("作り直した記事は新しい本文と index の値で差し替え、作り直さなかった公開中の記事は前の値を引き継ぐ", () => {
      expect(
        updateSearchIndex(
          current,
          [
            makeBuildPage(ids.rebuilt, "<p>新しい本文</p>"),
            makeBuildPage(ids.unpublished, "<p>非公開</p>"),
            makeBuildPage(ids.fixedPage, "<p>固定ページ</p>"),
          ],
          state,
          "2026-08-24T00:00:00.000Z",
        ),
      ).toEqual({
        schemaVersion: 1,
        updatedAt: "2026-08-24T00:00:00.000Z",
        posts: [
          {
            pageId: ids.rebuilt,
            slug: "rebuilt",
            title: "新しい題名",
            publishedAt: "2026-08-20T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
            text: "新しい本文",
          },
          current.posts[1],
        ],
      })
    })
  })

  describe("refreshSearchIndex", () => {
    class MemoryStore implements Pick<SiteObjectStore, "get" | "put"> {
      objects = new Map<string, SiteObject>()

      async get(key: string): Promise<Uint8Array | null> {
        return this.objects.get(key)?.body ?? null
      }

      async put(key: string, object: SiteObject): Promise<void> {
        this.objects.set(key, object)
      }
    }

    const storeWith = (body: string | null): MemoryStore => {
      const store = new MemoryStore()
      if (body !== null) {
        store.objects.set(SEARCH_INDEX_KEY, {
          body: new TextEncoder().encode(body),
          contentType: "application/json; charset=utf-8",
          cacheControl: "no-store",
        })
      }

      return store
    }

    const read = (store: MemoryStore): SearchIndex => {
      return JSON.parse(new TextDecoder().decode(store.objects.get(SEARCH_INDEX_KEY)!.body))
    }

    const builtPages = [makeBuildPage(ids.rebuilt, "<p>新しい本文</p>")]

    test("公開ボタンでは、今ある索引の該当する記事だけを差し替える", async () => {
      const store = storeWith(JSON.stringify(current))

      await refreshSearchIndex({
        mode: "partial",
        store,
        builtPages,
        state,
        updatedAt: "2026-08-24T00:00:00.000Z",
      })

      expect(read(store).posts.map((post) => post.slug)).toEqual(["rebuilt", "kept"])
      expect(store.objects.get(SEARCH_INDEX_KEY)?.cacheControl).toEqual("no-store")
    })

    test("索引がまだないときは、公開ボタンでは作らない（1 件だけの索引にしない）", async () => {
      const store = storeWith(null)

      await refreshSearchIndex({
        mode: "partial",
        store,
        builtPages,
        state,
        updatedAt: "2026-08-24T00:00:00.000Z",
      })

      expect(store.objects.has(SEARCH_INDEX_KEY)).toEqual(false)
    })

    test("壊れた索引は、公開ボタンでは触らず、generate では作り直した記事から作り直す", async () => {
      const partial = storeWith("{")
      await refreshSearchIndex({
        mode: "partial",
        store: partial,
        builtPages,
        state,
        updatedAt: "2026-08-24T00:00:00.000Z",
      })
      expect(new TextDecoder().decode(partial.objects.get(SEARCH_INDEX_KEY)!.body)).toEqual("{")

      const full = storeWith("{")
      await refreshSearchIndex({
        mode: "full",
        store: full,
        builtPages,
        state,
        updatedAt: "2026-08-24T00:00:00.000Z",
      })
      expect(read(full).posts.map((post) => post.slug)).toEqual(["rebuilt"])
    })
  })
})
