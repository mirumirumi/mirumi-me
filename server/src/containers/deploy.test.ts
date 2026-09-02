import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import type { BuildPlan } from "shared/build-manifest"

import type { SiteObject, SiteObjectStore } from "./aws"
import {
  cacheControlForKey,
  contentTypeForKey,
  createInvalidationPaths,
  routeOutputKeys,
  SiteDeployer,
  selectDeployKeys,
} from "./deploy"

describe("site deploy", () => {
  const temporaryDirectories: Array<string> = []

  class MemoryStore implements SiteObjectStore {
    calls: Array<string> = []
    deleted: Array<string> = []
    failAt: string | null = null

    async put(key: string, _object: SiteObject) {
      this.calls.push(key)
      if (key === this.failAt) {
        throw Error(`put failed: ${key}`)
      }
    }

    async delete(key: string) {
      this.deleted.push(key)
    }
  }

  const createOutput = async (files: Array<string>): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), "mirumi-deploy-"))
    temporaryDirectories.push(directory)
    for (const file of files) {
      const path = join(directory, file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, file)
    }

    return directory
  }

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory) => {
        await rm(directory, { recursive: true, force: true })
      }),
    )
  })

  const plan: BuildPlan = {
    schemaVersion: 1,
    workflowId: "workflow-id",
    mode: "partial",
    generatedAt: "2026-08-24T00:00:00.000Z",
    routes: ["/", "/article/", "/entries/page/2/"],
    pageIdsByRoute: {
      "/article/": "00000000-0000-0000-0000-000000000001",
    },
  }

  describe("routeOutputKeys", () => {
    test("public route を Nuxt の HTML と payload key に対応づける", () => {
      expect(routeOutputKeys("/")).toEqual(["index.html", "_payload.json"])
      expect(routeOutputKeys("/article/")).toEqual(["article/index.html", "article/_payload.json"])
    })
  })

  describe("selectDeployKeys", () => {
    test("partial では指定 route と _nuxt だけを選ぶ", () => {
      expect(
        selectDeployKeys(
          [
            "index.html",
            "_payload.json",
            "article/index.html",
            "article/_payload.json",
            "entries/page/2/index.html",
            "other/index.html",
            "assets/favicon.png",
            "_nuxt/app.abc.js",
            "_nuxt/builds/latest.json",
            "feed.xml",
          ],
          plan,
        ),
      ).toEqual([
        "index.html",
        "_payload.json",
        "article/index.html",
        "article/_payload.json",
        "entries/page/2/index.html",
        "_nuxt/app.abc.js",
        "_nuxt/builds/latest.json",
        "feed.xml",
      ])
    })

    test("full では job output を削除せずすべて選ぶ", () => {
      expect(
        selectDeployKeys(["index.html", "assets/favicon.png"], { ...plan, mode: "full" }),
      ).toEqual(["index.html", "assets/favicon.png"])
    })
  })

  describe("object metadata", () => {
    test("hash asset だけ immutable にする", () => {
      expect(cacheControlForKey("_nuxt/app.abc.js")).toEqual("public,max-age=31536000,immutable")
      expect(cacheControlForKey("_nuxt/builds/latest.json")).toEqual("no-cache")
      expect(cacheControlForKey("article/index.html")).toEqual("no-cache")
      expect(contentTypeForKey("feed.xml")).toEqual("application/rss+xml; charset=utf-8")
      expect(contentTypeForKey("article/_payload.json")).toEqual("application/json; charset=utf-8")
      expect(contentTypeForKey("assets/font.woff2")).toEqual("font/woff2")
      expect(contentTypeForKey("manifest.webmanifest")).toEqual("application/manifest+json")
    })
  })

  describe("SiteDeployer", () => {
    test("不変 asset、本文 payload、本文 HTML、一覧、build metadata、XML の順で更新する", async () => {
      const store = new MemoryStore()
      const directory = await createOutput([
        "_nuxt/app.abc.js",
        "_nuxt/builds/latest.json",
        "article/_payload.json",
        "article/index.html",
        "_payload.json",
        "index.html",
        "feed.xml",
      ])

      await new SiteDeployer(store).deploy(directory, plan, [])

      expect(store.calls).toEqual([
        "_nuxt/app.abc.js",
        "article/_payload.json",
        "article/index.html",
        "_payload.json",
        "index.html",
        "_nuxt/builds/latest.json",
        "feed.xml",
      ])
    })

    test("upload 途中で失敗したら unpublish の削除へ進まない", async () => {
      const store = new MemoryStore()
      store.failAt = "article/index.html"
      const directory = await createOutput([
        "_nuxt/app.abc.js",
        "article/_payload.json",
        "article/index.html",
        "index.html",
      ])

      await expect(new SiteDeployer(store).deploy(directory, plan, ["/removed/"])).rejects.toThrow(
        "put failed: article/index.html",
      )
      expect(store.calls).toEqual([
        "_nuxt/app.abc.js",
        "article/_payload.json",
        "article/index.html",
      ])
      expect(store.deleted).toEqual([])
    })
  })

  describe("createInvalidationPaths", () => {
    test("partial は route、payload、XML を絞り、full は全体にする", () => {
      expect(createInvalidationPaths(plan, ["article/", "/removed/"], true)).toEqual([
        "/",
        "/_payload.json",
        "/article",
        "/article/*",
        "/entries/page/2",
        "/entries/page/2/*",
        "/removed",
        "/removed/*",
        "/feed.xml",
        "/sitemap.xml",
        "/sitemap-misc.xml",
        "/post-sitemap.xml",
        "/page-sitemap.xml",
      ])
      expect(createInvalidationPaths({ ...plan, mode: "full" }, [], true)).toEqual(["/*"])
    })
  })
})
