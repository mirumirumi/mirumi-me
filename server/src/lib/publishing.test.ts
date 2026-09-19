import { describe, expect, test } from "vitest"

import type { DeployedPage, PageRevision, SiteDeploymentState } from "./publishing"
import {
  createEmptyDeploymentState,
  createPageSummariesManifestFromDeployment,
  omitIgnoredFixedPages,
  overlayDeploymentState,
  preparePageRevision,
  resolvePublishAction,
  validatePageRevisionMetadata,
} from "./publishing"

describe("publishing lifecycle", () => {
  const makeRevision = (overrides: Partial<PageRevision> = {}): PageRevision => {
    return {
      pageId: "00000000-0000-0000-0000-000000000001",
      kind: "post",
      title: "記事タイトル",
      slug: "article-slug",
      internalState: "公開待ち",
      lastEditedTime: "2026-08-24T01:00:00.000Z",
      lastDeploy: null,
      lastNotionEdit: null,
      publishedAt: null,
      updatedAt: null,
      category: { name: "技術", slug: "tech" },
      ...overrides,
    }
  }

  const makeDeployedPage = (overrides: Partial<DeployedPage> = {}): DeployedPage => {
    return {
      pageId: "00000000-0000-0000-0000-000000000001",
      kind: "post",
      status: "published",
      route: "/article-slug/",
      slug: "article-slug",
      title: "公開済み記事",
      excerpt: "記事の概要",
      category: { name: "技術", slug: "tech" },
      publishedAt: "2026-08-20T00:00:00.000Z",
      updatedAt: null,
      thumbnailUrls: null,
      ogImageUrl: "https://mirumi.media/og.webp",
      deployedNotionEdit: "2026-08-23T00:00:00.000Z",
      deployedAt: "2026-08-23T00:01:00.000Z",
      contentHash: "content-hash",
      sourceHash: null,
      ...overrides,
    }
  }

  const makeState = (pages: Array<DeployedPage> = []): SiteDeploymentState => {
    const state = createEmptyDeploymentState("2026-08-23T00:00:00.000Z")

    return overlayDeploymentState(state, pages, "2026-08-23T00:01:00.000Z")
  }

  describe("resolvePublishAction", () => {
    test("部分公開では待ち状態だけを action にする", () => {
      expect(resolvePublishAction("公開待ち", "partial")).toEqual("publish")
      expect(resolvePublishAction("非公開待ち", "partial")).toEqual("unpublish")
      expect(resolvePublishAction("公開中", "partial")).toEqual("noop")
    })

    test("full と bootstrap は公開中の記事を生成対象にする", () => {
      expect(resolvePublishAction("公開中", "full")).toEqual("publish")
      expect(resolvePublishAction("公開中", "bootstrap")).toEqual("publish")
      expect(resolvePublishAction("非公開", "full")).toEqual("noop")
    })
  })

  describe("createPageSummariesManifestFromDeployment", () => {
    test("最後に公開した記事 snapshot だけから一覧をつくる", () => {
      const published = makeDeployedPage()

      expect(
        createPageSummariesManifestFromDeployment([
          published,
          {
            ...published,
            pageId: "00000000-0000-0000-0000-000000000002",
            route: "/hidden/",
            slug: "hidden",
            status: "unpublished",
          },
          {
            ...published,
            pageId: "00000000-0000-0000-0000-000000000003",
            kind: "page",
            route: "/profile/",
            slug: "profile",
            category: null,
          },
        ]),
      ).toEqual({
        schemaVersion: 1,
        pages: [
          {
            pageId: published.pageId,
            slug: published.slug,
            title: published.title,
            excerpt: published.excerpt,
            publishedAt: published.publishedAt,
            updatedAt: published.updatedAt,
            category: published.category,
            thumbnailUrls: null,
          },
        ],
      })
    })
  })

  describe("omitIgnoredFixedPages", () => {
    test("CMS で使わない旧固定ページと route ownership を publish index から外す", () => {
      const article = makeDeployedPage()
      const retiredPage = makeDeployedPage({
        pageId: "00000000-0000-0000-0000-000000000002",
        kind: "page",
        route: "/what-is-this-blog/",
        slug: "what-is-this-blog",
        category: null,
      })

      expect(omitIgnoredFixedPages(makeState([article, retiredPage]))).toEqual({
        schemaVersion: 1,
        updatedAt: "2026-08-23T00:01:00.000Z",
        pages: { [article.pageId]: article },
        routeOwners: { [article.route]: article.pageId },
      })
    })
  })

  describe("preparePageRevision", () => {
    test("新規公開日は Workflow の requestedAt から一度だけ決める", () => {
      const result = preparePageRevision(
        makeRevision(),
        "partial",
        "2026-08-24T02:00:00.000Z",
        makeState(),
      )

      expect(result.action).toEqual("publish")
      expect(result.route).toEqual("/article-slug/")
      expect(result.effectivePublishedAt).toEqual("2026-08-24T02:00:00.000Z")
      expect(result.issues).toEqual([])
    })

    test("公開済み page ID の slug 変更を拒否する", () => {
      const deployed = makeDeployedPage()
      const result = preparePageRevision(
        makeRevision({ slug: "changed-slug", publishedAt: deployed.publishedAt }),
        "partial",
        "2026-08-24T02:00:00.000Z",
        makeState([deployed]),
      )

      expect(result.issues.map((issue) => issue.code)).toContain("slug-changed")
    })

    test("別 page が所有する route への公開を拒否する", () => {
      const owner = makeDeployedPage({
        pageId: "00000000-0000-0000-0000-000000000002",
      })
      const result = preparePageRevision(
        makeRevision(),
        "partial",
        "2026-08-24T02:00:00.000Z",
        makeState([owner]),
      )

      expect(result.issues.map((issue) => issue.code)).toContain("route-collision")
    })

    test("記事の予約 slug、category 欠落、固定ページの category を拒否する", () => {
      const post = preparePageRevision(
        makeRevision({ slug: "api", category: null }),
        "partial",
        "2026-08-24T02:00:00.000Z",
        makeState(),
      )
      const page = preparePageRevision(
        makeRevision({ kind: "page", slug: "profile" }),
        "partial",
        "2026-08-24T02:00:00.000Z",
        makeState(),
      )

      expect(post.issues.map((issue) => issue.code)).toEqual(["reserved-slug", "missing-category"])
      expect(page.issues.map((issue) => issue.code)).toEqual(["unexpected-category"])
    })

    test("未公開 page の非公開要求と full build の公開日欠落を拒否する", () => {
      const unpublish = preparePageRevision(
        makeRevision({ internalState: "非公開待ち" }),
        "partial",
        "2026-08-24T02:00:00.000Z",
        makeState(),
      )
      const full = preparePageRevision(
        makeRevision({ internalState: "公開中" }),
        "full",
        "2026-08-24T02:00:00.000Z",
        makeState(),
      )

      expect(unpublish.issues.map((issue) => issue.code)).toEqual(["not-published"])
      expect(full.issues.map((issue) => issue.code)).toEqual(["missing-published-at"])
    })

    test("同じ revision の非公開を response lost 後に再実行できる", () => {
      const deployed = makeDeployedPage({
        status: "unpublished",
        deployedNotionEdit: "2026-08-24T01:00:00.000Z",
      })
      const result = preparePageRevision(
        makeRevision({
          internalState: "非公開待ち",
          publishedAt: deployed.publishedAt,
        }),
        "partial",
        "2026-08-24T02:00:00.000Z",
        makeState([deployed]),
      )

      expect(result.action).toEqual("unpublish")
      expect(result.effectivePublishedAt).toEqual(deployed.publishedAt)
      expect(result.issues).toEqual([])
    })

    test("別 revision ですでに非公開の page は再実行とみなさない", () => {
      const deployed = makeDeployedPage({ status: "unpublished" })
      const result = preparePageRevision(
        makeRevision({
          internalState: "非公開待ち",
          publishedAt: deployed.publishedAt,
        }),
        "partial",
        "2026-08-24T02:00:00.000Z",
        makeState([deployed]),
      )

      expect(result.issues.map((issue) => issue.code)).toEqual(["not-published"])
    })
  })

  describe("validatePageRevisionMetadata", () => {
    test("partial は待ち状態以外を論理エラーにする", () => {
      const result = validatePageRevisionMetadata(
        makeRevision({ internalState: "公開中", publishedAt: "2026-08-20T00:00:00.000Z" }),
        "partial",
        "2026-08-24T02:00:00.000Z",
      )

      expect(result.action).toEqual("noop")
      expect(result.issues.map((issue) => issue.code)).toEqual(["invalid-state"])
    })

    test("full は公開中でない page の未完成 metadata を検証対象にしない", () => {
      const result = validatePageRevisionMetadata(
        makeRevision({ internalState: "下書き", title: "", slug: "", category: null }),
        "full",
        "2026-08-24T02:00:00.000Z",
      )

      expect(result.action).toEqual("noop")
      expect(result.issues).toEqual([])
    })
  })

  describe("overlayDeploymentState", () => {
    test("非公開後も page と route ownership を残す", () => {
      const page = makeDeployedPage({ status: "unpublished" })
      const state = overlayDeploymentState(
        createEmptyDeploymentState("2026-08-23T00:00:00.000Z"),
        [page],
        "2026-08-24T00:00:00.000Z",
      )

      expect(state.pages[page.pageId]).toEqual(page)
      expect(state.routeOwners[page.route]).toEqual(page.pageId)
      expect(state.updatedAt).toEqual("2026-08-24T00:00:00.000Z")
    })

    test("別 page に所有済み route を上書きさせない", () => {
      const current = makeState([makeDeployedPage()])
      const collision = makeDeployedPage({
        pageId: "00000000-0000-0000-0000-000000000002",
      })

      expect(() =>
        overlayDeploymentState(current, [collision], "2026-08-24T00:00:00.000Z"),
      ).toThrow("route は別の page が所有しています")
    })
  })
})
