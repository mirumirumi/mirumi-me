import { describe, expect, test } from "vitest"

import type { BuildPage } from "shared/build-manifest"

import type {
  DeployedPage,
  PreparedPageRevision,
  PublishJobRequest,
  SiteDeploymentState,
} from "../lib/publishing"
import { createEmptyDeploymentState } from "../lib/publishing"
import {
  createPublishedPageSnapshot,
  createUnpublishedPageSnapshot,
  preparePages,
  validateBootstrapIndex,
} from "./publish-job"

describe("publish job snapshots", () => {
  const prepared: PreparedPageRevision = {
    revision: {
      pageId: "00000000-0000-0000-0000-000000000001",
      kind: "post",
      title: "記事",
      slug: "article",
      internalState: "公開待ち",
      lastEditedTime: "2026-08-24T00:00:00.000Z",
      lastDeploy: null,
      lastNotionEdit: null,
      publishedAt: null,
      updatedAt: null,
      category: { name: "技術", slug: "tech" },
    },
    action: "publish",
    route: "/article/",
    effectivePublishedAt: "2026-08-24T01:00:00.000Z",
    issues: [],
  }
  const page: BuildPage = {
    schemaVersion: 1,
    pageId: prepared.revision.pageId,
    kind: "post",
    title: "記事",
    slug: "article",
    contentHtml: "<p>本文</p>",
    excerpt: "本文",
    thumbnailUrls: null,
    ogImageUrl: "https://mirumi.media/og.webp",
    publishedAt: "2026-08-24T01:00:00.000Z",
    updatedAt: null,
    category: { name: "技術", slug: "tech" },
    customCss: "",
    warnings: [],
  }

  test("公開 snapshot に build 済み metadata と開始 revision を固定する", () => {
    expect(
      createPublishedPageSnapshot(prepared, page, "2026-08-24T01:05:00.000Z", "content-hash"),
    ).toEqual({
      pageId: prepared.revision.pageId,
      kind: "post",
      status: "published",
      route: "/article/",
      slug: "article",
      title: "記事",
      excerpt: "本文",
      category: { name: "技術", slug: "tech" },
      publishedAt: "2026-08-24T01:00:00.000Z",
      updatedAt: null,
      thumbnailUrls: null,
      ogImageUrl: "https://mirumi.media/og.webp",
      deployedNotionEdit: "2026-08-24T00:00:00.000Z",
      deployedAt: "2026-08-24T01:05:00.000Z",
      contentHash: "content-hash",
    })
  })

  test("非公開 snapshot は最後の公開値と route ownership を維持する", () => {
    const deployed = createPublishedPageSnapshot(
      prepared,
      page,
      "2026-08-24T01:05:00.000Z",
      "content-hash",
    )
    const result: DeployedPage = createUnpublishedPageSnapshot(
      { ...prepared, action: "unpublish" },
      deployed,
      "2026-08-24T02:00:00.000Z",
    )

    expect(result).toEqual({
      ...deployed,
      status: "unpublished",
      deployedNotionEdit: prepared.revision.lastEditedTime,
      deployedAt: "2026-08-24T02:00:00.000Z",
    })
  })

  test("bootstrap は空の index と同じ試行の retry だけを許可する", () => {
    const empty = {
      state: { schemaVersion: 1 as const, updatedAt: "request-at", pages: {}, routeOwners: {} },
      etag: null,
    }
    const retry = { ...empty, etag: '"etag"' }

    expect(() => validateBootstrapIndex("bootstrap", empty, "request-at")).not.toThrow()
    expect(() => validateBootstrapIndex("bootstrap", retry, "request-at")).not.toThrow()
    expect(() => validateBootstrapIndex("bootstrap", retry, "other-request-at")).toThrow(
      "publish index が存在するため bootstrap できません",
    )
    expect(() => validateBootstrapIndex("full", retry, "other-request-at")).not.toThrow()
  })

  describe("preparePages", () => {
    const makeRequest = (slugs: Array<string>): PublishJobRequest => {
      return {
        workflowId: "workflow-id",
        params: {
          mode: "bootstrap",
          source: "release",
          requestId: "request-id",
          requestedAt: "2026-08-24T01:00:00.000Z",
          pageIds: [],
        },
        pages: slugs.map((slug, index) => ({
          ...prepared,
          revision: {
            ...prepared.revision,
            pageId: `00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
            slug,
            internalState: "公開中",
            publishedAt: "2026-08-20T00:00:00.000Z",
          },
          route: `/${slug}/`,
          issues: [],
        })),
      }
    }
    const emptyState = (): SiteDeploymentState => {
      return createEmptyDeploymentState("2026-08-24T01:00:00.000Z")
    }

    test("同じ route を持つ page が同じ batch にあれば、後続だけを route-collision にする", () => {
      const result = preparePages(makeRequest(["article", "article"]), emptyState())
      expect(result.pages).toHaveLength(1)
      expect(result.pages.at(0)?.revision.pageId).toEqual("00000000-0000-0000-0000-000000000001")
      expect(result.failed).toEqual([
        {
          pageId: "00000000-0000-0000-0000-000000000002",
          code: "route-collision",
          message: "同じ route を持つ page が同時に指定されています: /article/",
        },
      ])
    })

    test("route が衝突しなければ全 page を通す", () => {
      const result = preparePages(makeRequest(["article", "other-article"]), emptyState())
      expect(result.pages).toHaveLength(2)
      expect(result.failed).toEqual([])
    })
  })
})
