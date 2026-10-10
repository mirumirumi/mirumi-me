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
        signal: new AbortController().signal,
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
        signal: new AbortController().signal,
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
        signal: new AbortController().signal,
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
        signal: new AbortController().signal,
      }),
    ).toEqual([])
  })

  test("打ち切られたら、読み終わるのを待たずに失敗させ、残りの記事は読まない", async () => {
    const pages = Array.from({ length: 20 }, (_, index) => {
      return makeDeployedPage(
        `00000000-0000-0000-0001-${String(index).padStart(12, "0")}`,
        `p${index}`,
      )
    })
    const state = makeState([unpublishedPage, ...pages])
    const controller = new AbortController()
    const pending: Array<(page: BuildPage | null) => void> = []
    const loadSnapshot = vi.fn((_pageId: string): Promise<BuildPage | null> => {
      return new Promise((resolve) => pending.push(resolve))
    })
    const search = findUnpublishedReferences({
      unpublished: [unpublishedPage],
      state,
      builtPages: new Map(),
      loadSnapshot,
      signal: controller.signal,
    })
    controller.abort()
    await expect(search).rejects.toThrow(
      "非公開にした記事を指す記事を、時間内に探しきれませんでした",
    )
    const readBeforeAbort = loadSnapshot.mock.calls.length
    for (const resolve of pending) {
      resolve(null)
    }
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(loadSnapshot.mock.calls.length).toEqual(readBeforeAbort)
    expect(readBeforeAbort < pages.length).toEqual(true)
  })
})
