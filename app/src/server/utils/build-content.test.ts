import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { BUILD_MANIFEST_FILES } from "shared/build-manifest"

import { BuildManifestReader } from "./build-content"

describe("BuildManifestReader", () => {
  const directories: Array<string> = []
  const createManifest = async (): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), "mirumi-build-reader-"))
    directories.push(directory)
    await mkdir(join(directory, BUILD_MANIFEST_FILES.articles))
    await writeFile(
      join(directory, BUILD_MANIFEST_FILES.plan),
      JSON.stringify({
        schemaVersion: 1,
        workflowId: "workflow-id",
        mode: "full",
        generatedAt: "2026-08-24T00:00:00.000Z",
        routes: ["/article-slug/"],
        pageIdsByRoute: {
          "/article-slug/": "00000000-0000-0000-0000-000000000001",
        },
      }),
    )
    await writeFile(
      join(directory, BUILD_MANIFEST_FILES.articles, "00000000-0000-0000-0000-000000000001.json"),
      JSON.stringify({
        schemaVersion: 1,
        pageId: "00000000-0000-0000-0000-000000000001",
        kind: "post",
        title: "記事タイトル",
        slug: "article-slug",
        contentHtml: "<p>本文</p>",
        excerpt: "本文",
        thumbnailUrls: null,
        ogImageUrl: "https://mirumi.media/og.webp",
        publishedAt: "2026-08-24T00:00:00.000Z",
        updatedAt: null,
        category: { name: "tech", slug: "tech" },
        customCss: "",
        warnings: [],
      }),
    )
    await writeFile(
      join(directory, BUILD_MANIFEST_FILES.pageSummaries),
      JSON.stringify({
        schemaVersion: 1,
        pages: [
          {
            pageId: "00000000-0000-0000-0000-000000000001",
            slug: "article-slug",
            title: "記事タイトル",
            excerpt: "本文",
            publishedAt: "2026-08-24T00:00:00.000Z",
            updatedAt: null,
            category: { name: "tech", slug: "tech" },
            thumbnailUrls: null,
            cardImageUrl: null,
          },
        ],
      }),
    )
    await writeFile(
      join(directory, BUILD_MANIFEST_FILES.categories),
      JSON.stringify({
        schemaVersion: 1,
        categories: [{ name: "tech", slug: "tech" }],
      }),
    )

    return directory
  }

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
  })

  describe("readBuildPlan", () => {
    test("build plan を schema 検証して読む", async () => {
      const reader = new BuildManifestReader(await createManifest())

      expect(await reader.readBuildPlan()).toEqual({
        schemaVersion: 1,
        workflowId: "workflow-id",
        mode: "full",
        generatedAt: "2026-08-24T00:00:00.000Z",
        routes: ["/article-slug/"],
        pageIdsByRoute: {
          "/article-slug/": "00000000-0000-0000-0000-000000000001",
        },
      })
    })
  })

  describe("readPageByRoute", () => {
    test("build plan の対応だけを使って記事 JSON を読む", async () => {
      const reader = new BuildManifestReader(await createManifest())

      expect((await reader.readPageByRoute("/article-slug/")).slug).toEqual("article-slug")
      await expect(reader.readPageByRoute("/unknown")).rejects.toThrowError("build 対象")
    })
  })

  describe("readPageSummaries", () => {
    test("一覧用 manifest を読む", async () => {
      const reader = new BuildManifestReader(await createManifest())

      expect((await reader.readPageSummaries()).pages.map(({ slug }) => slug)).toEqual([
        "article-slug",
      ])
    })
  })

  describe("readCategories", () => {
    test("category manifest を読む", async () => {
      const reader = new BuildManifestReader(await createManifest())

      expect(await reader.readCategories()).toEqual({
        schemaVersion: 1,
        categories: [{ name: "tech", slug: "tech" }],
      })
    })
  })
})
