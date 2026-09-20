import { describe, expect, test } from "vitest"

import {
  createBuildPage,
  createCategoriesManifest,
  createPageSummariesManifest,
  parseBuildPage,
  parseBuildPlan,
  parsePageSummariesManifest,
} from "./build-manifest"
import type { ArticleContent, RenderedContent } from "./content"

describe("build manifest", () => {
  const article: ArticleContent = {
    id: "00000000-0000-0000-0000-000000000001",
    title: "記事タイトル",
    slug: "article-slug",
    thumbnailUrl: "https://mirumi.media/source.webp",
    thumbnailName: "source.webp",
    publishedAt: "2026-08-24T00:00:00.000Z",
    updatedAt: "2026-08-24T01:00:00.000Z",
    category: { name: "tech", slug: "tech" },
    customCss: ".sample {}",
    toc: { hidden: false, closed: false },
    blocks: [],
  }
  const rendered: RenderedContent = {
    html: "<p>本文</p>",
    warnings: ["warning"],
  }

  describe("createBuildPage", () => {
    test("ArticleContent と render 結果を frontend view model に分離する", () => {
      expect(
        createBuildPage({
          kind: "post",
          article,
          rendered,
          thumbnailUrls: {
            article: "https://mirumi.media/hash-thumbnail-1200x630.webp",
            mobile: "https://mirumi.media/hash-thumbnail-600x315.webp",
            card: "https://mirumi.media/hash-thumbnail-412x216.webp",
          },
          ogImageUrl: "https://mirumi.media/hash-thumbnail-1200x630.webp",
        }),
      ).toEqual({
        schemaVersion: 1,
        pageId: "00000000-0000-0000-0000-000000000001",
        kind: "post",
        title: "記事タイトル",
        slug: "article-slug",
        contentHtml: "<p>本文</p>",
        excerpt: "",
        thumbnailUrls: {
          article: "https://mirumi.media/hash-thumbnail-1200x630.webp",
          mobile: "https://mirumi.media/hash-thumbnail-600x315.webp",
          card: "https://mirumi.media/hash-thumbnail-412x216.webp",
        },
        ogImageUrl: "https://mirumi.media/hash-thumbnail-1200x630.webp",
        publishedAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T01:00:00.000Z",
        category: { name: "tech", slug: "tech" },
        customCss: ".sample {}",
        warnings: ["warning"],
      })
    })

    test("公開日なしと post の category なしを拒否する", () => {
      expect(() =>
        createBuildPage({
          kind: "post",
          article: { ...article, publishedAt: null },
          rendered,
          thumbnailUrls: null,
          ogImageUrl: "https://mirumi.media/og.webp",
        }),
      ).toThrowError("公開日")
      expect(() =>
        createBuildPage({
          kind: "post",
          article: { ...article, category: null },
          rendered,
          thumbnailUrls: null,
          ogImageUrl: "https://mirumi.media/og.webp",
        }),
      ).toThrowError("category")
    })
  })

  describe("parseBuildPage", () => {
    test("thumbnail が空でも OGP URL を必須にする", () => {
      const page = createBuildPage({
        kind: "post",
        article,
        rendered,
        thumbnailUrls: null,
        ogImageUrl: "https://mirumi.media/generated-og.webp",
      })

      expect(parseBuildPage(page)).toEqual(page)
      expect(() => parseBuildPage({ ...page, ogImageUrl: "" })).toThrowError()
    })
  })

  describe("parseBuildPlan", () => {
    test("route と page ID の対応を検証する", () => {
      expect(
        parseBuildPlan({
          schemaVersion: 1,
          workflowId: "workflow-id",
          mode: "partial",
          generatedAt: "2026-08-24T00:00:00.000Z",
          routes: ["/article-slug/", "/entries/"],
          pageIdsByRoute: {
            "/article-slug/": "00000000-0000-0000-0000-000000000001",
          },
        }),
      ).toEqual({
        schemaVersion: 1,
        workflowId: "workflow-id",
        mode: "partial",
        generatedAt: "2026-08-24T00:00:00.000Z",
        routes: ["/article-slug/", "/entries/"],
        pageIdsByRoute: {
          "/article-slug/": "00000000-0000-0000-0000-000000000001",
        },
      })
      expect(() =>
        parseBuildPlan({
          schemaVersion: 1,
          workflowId: "workflow-id",
          mode: "full",
          generatedAt: "invalid",
          routes: ["invalid"],
          pageIdsByRoute: {},
        }),
      ).toThrowError()
    })
  })

  describe("parsePageSummariesManifest", () => {
    test("記事一覧用 metadata を検証する", () => {
      const manifest = {
        schemaVersion: 1 as const,
        pages: [
          {
            pageId: article.id,
            slug: article.slug,
            title: article.title,
            excerpt: "",
            publishedAt: article.publishedAt!,
            updatedAt: article.updatedAt,
            category: article.category!,
            thumbnailUrls: null,
            cardImageUrl: null,
          },
        ],
      }

      expect(parsePageSummariesManifest(manifest)).toEqual(manifest)
    })
  })

  describe("createPageSummariesManifest", () => {
    test("記事を公開日の新しい順に並べ、slug 重複を拒否する", () => {
      const page = createBuildPage({
        kind: "post",
        article,
        rendered,
        thumbnailUrls: null,
        ogImageUrl: "https://mirumi.media/og.webp",
      })
      const summary = {
        pageId: page.pageId,
        slug: page.slug,
        title: page.title,
        excerpt: page.excerpt,
        publishedAt: page.publishedAt,
        updatedAt: page.updatedAt,
        category: page.category!,
        thumbnailUrls: page.thumbnailUrls,
        cardImageUrl: null,
      }
      const newer = {
        ...summary,
        pageId: "00000000-0000-0000-0000-000000000002",
        slug: "newer-article",
        publishedAt: "2026-08-25T00:00:00.000Z",
      }

      expect(createPageSummariesManifest([summary, newer]).pages.map(({ slug }) => slug)).toEqual([
        "newer-article",
        "article-slug",
      ])
      expect(() =>
        createPageSummariesManifest([summary, { ...newer, slug: summary.slug }]),
      ).toThrowError("slug")
    })
  })

  describe("createCategoriesManifest", () => {
    test("記事に登場する category を重複なしでつくる", () => {
      expect(
        createCategoriesManifest([
          { name: "tech", slug: "tech" },
          { name: "技術", slug: "tech" },
          { name: "くらし", slug: "life" },
        ]),
      ).toEqual({
        schemaVersion: 1,
        categories: [
          { name: "tech", slug: "tech" },
          { name: "くらし", slug: "life" },
        ],
      })
    })
  })
})
