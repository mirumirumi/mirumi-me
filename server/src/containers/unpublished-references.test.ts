import { describe, expect, test, vi } from "vitest"

import type { BuildPage } from "shared/build-manifest"

import type { DeployedPage, SiteDeploymentState } from "../lib/publishing"
import { findUnpublishedReferences } from "./unpublished-references"

describe("findUnpublishedReferences", () => {
  const ids = {
    unpublished: "00000000-0000-0000-0000-000000000001",
    referrer: "00000000-0000-0000-0000-000000000002",
    unrelated: "00000000-0000-0000-0000-000000000003",
    alsoUnpublished: "00000000-0000-0000-0000-000000000004",
    built: "00000000-0000-0000-0000-000000000005",
  }

  const card = (route: string): string => {
    return `<a class="blogcard" href="https://mirumi.me${route}"><div class="blogcard"></div></a>`
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

  const unpublishedPage = makeDeployedPage(ids.unpublished, "gone", { status: "unpublished" })

  test("非公開にした route を内部ブログカードで指す公開中の記事だけを集める", async () => {
    const state = makeState([
      unpublishedPage,
      makeDeployedPage(ids.referrer, "referrer"),
      makeDeployedPage(ids.unrelated, "unrelated"),
      makeDeployedPage(ids.alsoUnpublished, "hidden", { status: "unpublished" }),
    ])
    const html: Record<string, string> = {
      [ids.referrer]: `<p>前置き</p>${card("/gone/")}`,
      [ids.unrelated]: `<p><a href="https://mirumi.me/gone/">普通のリンク</a></p>`,
      [ids.alsoUnpublished]: card("/gone/"),
    }
    const loadSnapshot = vi.fn(async (pageId: string) => makeBuildPage(pageId, html[pageId] ?? ""))

    expect(
      await findUnpublishedReferences({
        unpublished: [unpublishedPage],
        state,
        builtPages: new Map(),
        loadSnapshot,
      }),
    ).toEqual([
      {
        pageId: ids.unpublished,
        route: "/gone/",
        referrers: [{ pageId: ids.referrer, title: "referrer の記事", slug: "referrer" }],
      },
    ])
    expect(loadSnapshot).toHaveBeenCalledWith(ids.referrer, "hash-referrer")
    expect(loadSnapshot).not.toHaveBeenCalledWith(ids.alsoUnpublished, expect.anything())
  })

  test("同じ job で作った記事は、snapshot を読まずに作った本文で調べる", async () => {
    const state = makeState([unpublishedPage, makeDeployedPage(ids.built, "built")])
    const loadSnapshot = vi.fn(async () => {
      throw Error("読まないはず")
    })

    expect(
      await findUnpublishedReferences({
        unpublished: [unpublishedPage],
        state,
        builtPages: new Map([[ids.built, makeBuildPage(ids.built, card("/gone/"))]]),
        loadSnapshot,
      }),
    ).toEqual([
      {
        pageId: ids.unpublished,
        route: "/gone/",
        referrers: [{ pageId: ids.built, title: "built の記事", slug: "built" }],
      },
    ])
    expect(loadSnapshot).not.toHaveBeenCalled()
  })

  test("snapshot が無いか読めなかった記事は、ログを残して飛ばし、ほかの記事は調べる", async () => {
    const state = makeState([
      unpublishedPage,
      makeDeployedPage(ids.referrer, "referrer"),
      makeDeployedPage(ids.unrelated, "unrelated"),
      makeDeployedPage(ids.built, "missing"),
    ])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const loadSnapshot = vi.fn(async (pageId: string) => {
      if (pageId === ids.unrelated) {
        throw Error("S3 が落ちた")
      }

      return pageId === ids.referrer ? makeBuildPage(pageId, card("/gone/")) : null
    })

    expect(
      await findUnpublishedReferences({
        unpublished: [unpublishedPage],
        state,
        builtPages: new Map(),
        loadSnapshot,
      }),
    ).toEqual([
      {
        pageId: ids.unpublished,
        route: "/gone/",
        referrers: [{ pageId: ids.referrer, title: "referrer の記事", slug: "referrer" }],
      },
    ])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  test("指している記事がなければ何も返さない", async () => {
    const state = makeState([unpublishedPage, makeDeployedPage(ids.unrelated, "unrelated")])

    expect(
      await findUnpublishedReferences({
        unpublished: [unpublishedPage],
        state,
        builtPages: new Map(),
        loadSnapshot: async (pageId) => makeBuildPage(pageId, card("/other/")),
      }),
    ).toEqual([])
  })
})
