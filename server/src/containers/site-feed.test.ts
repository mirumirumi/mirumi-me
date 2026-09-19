import { describe, expect, test } from "vitest"

import type { DeployedPage } from "../lib/publishing"
import { generateSiteFeed } from "./site-feed"

describe("generateSiteFeed", () => {
  const page = (overrides: Partial<DeployedPage>): DeployedPage => {
    return {
      pageId: "00000000-0000-0000-0000-000000000001",
      kind: "post",
      status: "published",
      route: "/article-slug/",
      slug: "article-slug",
      title: "記事 & タイトル",
      excerpt: "本文の概要 ]]> 続き",
      category: { name: "tech & AI", slug: "tech" },
      publishedAt: "2026-08-20T00:00:00.000Z",
      updatedAt: null,
      thumbnailUrls: null,
      ogImageUrl: "https://mirumi.media/og.webp",
      deployedNotionEdit: "2026-08-24T00:00:00.000Z",
      deployedAt: "2026-08-24T00:01:00.000Z",
      contentHash: "hash",
      sourceHash: null,
      ...overrides,
    }
  }

  test("新しい公開記事だけを RSS 2.0 item にする", () => {
    const feed = generateSiteFeed([
      page({}),
      page({
        pageId: "00000000-0000-0000-0000-000000000002",
        route: "/newer/",
        slug: "newer",
        title: "新しい記事",
        publishedAt: "2026-08-21T00:00:00.000Z",
      }),
      page({
        pageId: "00000000-0000-0000-0000-000000000003",
        status: "unpublished",
        route: "/hidden/",
        slug: "hidden",
      }),
      page({
        pageId: "00000000-0000-0000-0000-000000000004",
        kind: "page",
        route: "/profile/",
        slug: "profile",
        category: null,
        excerpt: null,
      }),
    ])

    expect(feed.indexOf("https://mirumi.me/newer/")).toBeLessThan(
      feed.indexOf("https://mirumi.me/article-slug/"),
    )
    expect(feed).not.toContain("hidden")
    expect(feed).not.toContain("profile")
    expect(feed).toContain("<title>記事 &amp; タイトル</title>")
    expect(feed).toContain("<category><![CDATA[tech & AI]]></category>")
    expect(feed).toContain("本文の概要 ]]]]><![CDATA[> 続き")
    expect(feed).toContain('<guid isPermaLink="true">https://mirumi.me/article-slug/</guid>')
  })

  test("既存設定と同じ最新 7 件に制限する", () => {
    const pages = Array.from({ length: 9 }, (_, index) => {
      return page({
        pageId: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
        route: `/article-${index}/`,
        slug: `article-${index}`,
        publishedAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      })
    })

    expect(feedItemCount(generateSiteFeed(pages))).toEqual(7)
  })
})

const feedItemCount = (feed: string): number => {
  return feed.match(/<item>/g)?.length ?? 0
}
