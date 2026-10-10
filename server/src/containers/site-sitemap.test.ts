import { describe, expect, test } from "vitest"

import type { DeployedPage } from "../lib/publishing"
import { generateSiteSitemaps } from "./site-sitemap"

describe("generateSiteSitemaps", () => {
  const page = (overrides: Partial<DeployedPage>): DeployedPage => {
    return {
      pageId: "00000000-0000-0000-0000-000000000001",
      kind: "post",
      status: "published",
      route: "/article-slug/",
      slug: "article-slug",
      title: "記事 & タイトル",
      excerpt: "概要",
      category: { name: "tech", slug: "tech" },
      publishedAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-24T00:00:00.000Z",
      thumbnailUrls: null,
      ogImageUrl: "https://mirumi.media/og.webp",
      deployedNotionEdit: "2026-08-24T00:00:00.000Z",
      deployedAt: "2026-08-24T00:01:00.000Z",
      contentHash: "hash",
      sourceHash: null,
      ...overrides,
    }
  }

  test("公開中の post / page と Nuxt の root を既存 4 ファイルへ分ける", () => {
    const sitemaps = generateSiteSitemaps([
      page({}),
      page({
        pageId: "00000000-0000-0000-0000-000000000002",
        kind: "page",
        route: "/profile/",
        slug: "profile",
        category: null,
        excerpt: null,
      }),
      page({
        pageId: "00000000-0000-0000-0000-000000000003",
        status: "unpublished",
        route: "/hidden/",
        slug: "hidden",
      }),
    ])

    expect(Object.keys(sitemaps)).toEqual([
      "sitemap.xml",
      "sitemap-misc.xml",
      "post-sitemap.xml",
      "page-sitemap.xml",
    ])
    expect(sitemaps["sitemap.xml"]).toContain("https://mirumi.me/post-sitemap.xml")
    expect(sitemaps["sitemap-misc.xml"]).toContain("<loc>https://mirumi.me/</loc>")
    expect(sitemaps["post-sitemap.xml"]).toContain("<loc>https://mirumi.me/article-slug/</loc>")
    expect(sitemaps["post-sitemap.xml"]).not.toContain("hidden")
    expect(sitemaps["page-sitemap.xml"]).toContain("<loc>https://mirumi.me/profile/</loc>")
    expect(sitemaps["page-sitemap.xml"]).not.toContain("https://mirumi.in")
  })

  test("XML 特殊文字を escape し、lastmod は更新日時を使う", () => {
    const sitemaps = generateSiteSitemaps([page({ route: "/article&slug/" })])

    expect(sitemaps["post-sitemap.xml"]).toContain("<loc>https://mirumi.me/article&amp;slug/</loc>")
    expect(sitemaps["post-sitemap.xml"]).toContain("<lastmod>2026-08-24T00:00:00.000Z</lastmod>")
  })
})
