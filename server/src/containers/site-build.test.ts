import { describe, expect, test } from "vitest"

import type { BuildPageSummary } from "shared/build-manifest"

import type { PreparedPageRevision } from "../lib/publishing"
import {
  createSiteBuildPlan,
  findRemovedAggregateRoutes,
  findUnpublishedContentRoutes,
} from "./site-build"

describe("createSiteBuildPlan", () => {
  const summaries: Array<BuildPageSummary> = [
    {
      pageId: "00000000-0000-0000-0000-000000000001",
      slug: "new-post",
      title: "新しい記事",
      excerpt: "概要",
      publishedAt: "2026-08-24T00:00:00.000Z",
      updatedAt: null,
      category: { name: "技術", slug: "tech" },
      thumbnailUrls: null,
      cardImageUrl: null,
    },
    ...Array.from({ length: 13 }, (_, index): BuildPageSummary => {
      return {
        pageId: `00000000-0000-0000-0001-${String(index).padStart(12, "0")}`,
        slug: `old-post-${index}`,
        title: `以前の記事 ${index}`,
        excerpt: "概要",
        publishedAt: "2026-08-20T00:00:00.000Z",
        updatedAt: null,
        category: { name: "日記", slug: "diary" },
        thumbnailUrls: null,
        cardImageUrl: null,
      }
    }),
  ]

  const changedPost: PreparedPageRevision = {
    revision: {
      pageId: summaries[0]!.pageId,
      kind: "post",
      title: "新しい記事",
      slug: "new-post",
      internalState: "公開待ち",
      lastEditedTime: "2026-08-24T00:00:00.000Z",
      lastDeploy: null,
      lastNotionEdit: null,
      publishedAt: null,
      updatedAt: null,
      category: { name: "技術", slug: "tech" },
    },
    action: "publish",
    route: "/new-post/",
    effectivePublishedAt: "2026-08-24T00:00:00.000Z",
    issues: [],
  }

  test("記事の部分公開では記事と全集約 route を明示する", () => {
    expect(
      createSiteBuildPlan({
        workflowId: "workflow-id",
        mode: "partial",
        generatedAt: "2026-08-24T01:00:00.000Z",
        summaries,
        changedPages: [changedPost],
      }),
    ).toEqual({
      schemaVersion: 1,
      workflowId: "workflow-id",
      mode: "partial",
      generatedAt: "2026-08-24T01:00:00.000Z",
      routes: [
        "/new-post/",
        "/",
        "/entries/",
        "/entries/page/1/",
        "/entries/page/2/",
        "/entry-list/",
        "/category/diary/",
        "/category/diary/page/1/",
        "/category/tech/",
        "/category/tech/page/1/",
      ],
      pageIdsByRoute: {
        "/new-post/": "00000000-0000-0000-0000-000000000001",
      },
    })
  })

  test("記事の非公開では対象 route を生成対象に戻さない", () => {
    const plan = createSiteBuildPlan({
      workflowId: "workflow-id",
      mode: "partial",
      generatedAt: "2026-08-24T01:00:00.000Z",
      summaries: summaries.slice(1),
      changedPages: [{ ...changedPost, action: "unpublish" }],
    })

    expect(plan.routes).not.toContain("/new-post/")
    expect(plan.pageIdsByRoute).toEqual({})
    expect(plan.routes).toContain("/entries/")
  })

  test("固定本文ページの部分公開では集約 route を生成しない", () => {
    const changedPage: PreparedPageRevision = {
      ...changedPost,
      revision: {
        ...changedPost.revision,
        pageId: "00000000-0000-0000-0000-000000000099",
        kind: "page",
        slug: "profile",
        category: null,
      },
      route: "/profile/",
    }

    expect(
      createSiteBuildPlan({
        workflowId: "workflow-id",
        mode: "partial",
        generatedAt: "2026-08-24T01:00:00.000Z",
        summaries,
        changedPages: [changedPage],
      }).routes,
    ).toEqual(["/profile/"])
    expect(findUnpublishedContentRoutes([{ ...changedPage, action: "unpublish" }])).toEqual([
      "/profile/",
    ])
  })

  test("full build は公開本文とサイト共通 route をすべて含める", () => {
    const plan = createSiteBuildPlan({
      workflowId: "workflow-id",
      mode: "full",
      generatedAt: "2026-08-24T01:00:00.000Z",
      summaries,
      changedPages: [
        changedPost,
        {
          ...changedPost,
          revision: {
            ...changedPost.revision,
            pageId: "00000000-0000-0000-0000-000000000099",
            kind: "page",
            slug: "profile",
            category: null,
          },
          route: "/profile/",
        },
      ],
    })

    expect(plan.routes).toContain("/new-post/")
    expect(plan.routes).toContain("/profile/")
    expect(plan.routes).toContain("/contact/")
    expect(plan.routes).toContain("/s/")
    expect(plan.pageIdsByRoute).toEqual({
      "/new-post/": "00000000-0000-0000-0000-000000000001",
      "/profile/": "00000000-0000-0000-0000-000000000099",
    })
  })

  test("記事減少で不要になった pagination と category route を抽出する", () => {
    expect(findRemovedAggregateRoutes(summaries, summaries.slice(1))).toEqual([
      "/entries/page/2/",
      "/category/tech/",
      "/category/tech/page/1/",
    ])
  })
})
