import { describe, expect, test } from "vitest"

import type { SiteDeploymentState } from "../lib/publishing"
import { selectDeploymentPageStates } from "./deployment-state"

describe("selectDeploymentPageStates", () => {
  test("公開・非公開・未登録を Workflow 用の最小データにする", () => {
    const state: SiteDeploymentState = {
      schemaVersion: 1,
      updatedAt: "2026-08-24T02:00:00.000Z",
      pages: {
        published: {
          pageId: "published",
          kind: "post",
          status: "published",
          route: "/published/",
          slug: "published",
          title: "公開中",
          excerpt: null,
          category: { name: "技術", slug: "tech" },
          publishedAt: "2026-08-20T00:00:00.000Z",
          updatedAt: null,
          thumbnailUrls: null,
          ogImageUrl: "https://mirumi.media/og.webp",
          deployedNotionEdit: "2026-08-24T01:00:00.000Z",
          deployedAt: "2026-08-24T02:00:00.000Z",
          contentHash: "hash",
          sourceHash: null,
        },
        unpublished: {
          pageId: "unpublished",
          kind: "post",
          status: "unpublished",
          route: "/unpublished/",
          slug: "unpublished",
          title: "非公開",
          excerpt: null,
          category: { name: "技術", slug: "tech" },
          publishedAt: "2026-08-10T00:00:00.000Z",
          updatedAt: null,
          thumbnailUrls: null,
          ogImageUrl: "https://mirumi.media/og.webp",
          deployedNotionEdit: "2026-08-24T01:00:00.000Z",
          deployedAt: "2026-08-24T02:00:00.000Z",
          contentHash: "hash",
          sourceHash: null,
        },
      },
      routeOwners: { "/published/": "published", "/unpublished/": "unpublished" },
    }

    expect(selectDeploymentPageStates(state, ["published", "unpublished", "missing"])).toEqual([
      {
        pageId: "published",
        status: "published",
        deployedAt: "2026-08-24T02:00:00.000Z",
        publishedAt: "2026-08-20T00:00:00.000Z",
      },
      { pageId: "unpublished", status: "unpublished" },
      { pageId: "missing", status: "missing" },
    ])
  })
})
