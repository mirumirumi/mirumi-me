import { describe, expect, test } from "vitest"

import type { BuildPage } from "shared/build-manifest"
import type { ArticleContent } from "shared/content"

import type {
  DeployedPage,
  PreparedPageRevision,
  PublishJobRequest,
  SiteDeploymentState,
} from "../lib/publishing"
import { createEmptyDeploymentState } from "../lib/publishing"
import {
  createArticleSourceHash,
  createPublishedPageSnapshot,
  createUnpublishedPageSnapshot,
  preparePages,
  resolveUpdatedAt,
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
    comments: [],
  }

  test("公開 snapshot に build 済み metadata と開始 revision を固定する", () => {
    expect(
      createPublishedPageSnapshot(
        prepared,
        page,
        "2026-08-24T01:05:00.000Z",
        "content-hash",
        "source-hash",
      ),
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
      sourceHash: "source-hash",
    })
  })

  test("非公開 snapshot は最後の公開値と route ownership を維持する", () => {
    const deployed = createPublishedPageSnapshot(
      prepared,
      page,
      "2026-08-24T01:05:00.000Z",
      "content-hash",
      "source-hash",
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

  describe("createArticleSourceHash", () => {
    const article: ArticleContent = {
      id: "00000000-0000-0000-0000-000000000001",
      title: "記事",
      slug: "article",
      thumbnailUrl: "https://mirumi.media/hash-cover-1200x630.webp",
      thumbnailName: "cover.png",
      publishedAt: "2026-08-24T01:00:00.000Z",
      updatedAt: null,
      category: { name: "技術", slug: "tech" },
      customCss: "",
      toc: { hidden: false, closed: false },
      blocks: [
        {
          id: "00000000-0000-0000-0000-000000000010",
          type: "video",
          url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/clip.mp4?X-Amz-Signature=aaa&X-Amz-Expires=3600",
          caption: [],
          children: [],
        },
        {
          id: "00000000-0000-0000-0000-000000000011",
          type: "embed",
          url: "https://www.youtube.com/watch?v=abc",
          caption: [],
          children: [],
        },
      ],
    }

    test("公開日と更新日を変えてもハッシュは変わらない", () => {
      const base = createArticleSourceHash(article)
      expect(
        createArticleSourceHash({ ...article, publishedAt: "2020-01-01T00:00:00.000Z" }),
      ).toEqual(base)
      expect(
        createArticleSourceHash({ ...article, updatedAt: "2026-09-01T00:00:00.000Z" }),
      ).toEqual(base)
    })

    test("本文や title が変わればハッシュも変わる", () => {
      const base = createArticleSourceHash(article)
      expect(createArticleSourceHash({ ...article, title: "別の題" })).not.toEqual(base)
      expect(createArticleSourceHash({ ...article, blocks: article.blocks.slice(1) })).not.toEqual(
        base,
      )
    })

    test("Notion ホストの署名付き URL は署名が変わってもハッシュは変わらない", () => {
      const base = createArticleSourceHash(article)
      const resigned = {
        ...article,
        blocks: [
          {
            ...article.blocks[0]!,
            url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/clip.mp4?X-Amz-Signature=bbb&X-Amz-Expires=3600",
          },
          article.blocks[1]!,
        ],
      }
      expect(createArticleSourceHash(resigned)).toEqual(base)
    })

    test("外部 URL のクエリは意味を持つのでハッシュに含める", () => {
      const base = createArticleSourceHash(article)
      const other = {
        ...article,
        blocks: [
          article.blocks[0]!,
          { ...article.blocks[1]!, url: "https://www.youtube.com/watch?v=def" },
        ],
      }
      expect(createArticleSourceHash(other)).not.toEqual(base)
    })
  })

  describe("resolveUpdatedAt", () => {
    const requestedAt = "2026-09-19T10:00:00.000Z"
    const publishedAt = "2026-08-24T01:00:00.000Z"

    test("初回公開（前回の配信がない）なら更新日を決めない", () => {
      expect(resolveUpdatedAt("partial", undefined, "new", publishedAt, requestedAt)).toEqual(null)
    })

    test("前回の index に sourceHash がなければ判定できないので決めない", () => {
      expect(
        resolveUpdatedAt("partial", { sourceHash: null }, "new", publishedAt, requestedAt),
      ).toEqual(null)
    })

    test("内容が変わっていなければ決めない", () => {
      expect(
        resolveUpdatedAt("partial", { sourceHash: "same" }, "same", publishedAt, requestedAt),
      ).toEqual(null)
    })

    test("内容が変わっていれば requestedAt を更新日にする", () => {
      expect(
        resolveUpdatedAt("partial", { sourceHash: "old" }, "new", publishedAt, requestedAt),
      ).toEqual(requestedAt)
    })

    test("bootstrap も書き戻すので決める", () => {
      expect(
        resolveUpdatedAt("bootstrap", { sourceHash: "old" }, "new", publishedAt, requestedAt),
      ).toEqual(requestedAt)
    })

    test("full は Notion へ書き戻さないので内容が変わっていても決めない", () => {
      expect(
        resolveUpdatedAt("full", { sourceHash: "old" }, "new", publishedAt, requestedAt),
      ).toEqual(null)
    })

    test("公開日が requestedAt より未来なら更新日が公開日より前になるので決めない", () => {
      expect(
        resolveUpdatedAt(
          "partial",
          { sourceHash: "old" },
          "new",
          "2026-12-31T00:00:00.000Z",
          requestedAt,
        ),
      ).toEqual(null)
    })

    test("公開日のタイムゾーン表記が違っても時刻で比較する", () => {
      expect(
        resolveUpdatedAt(
          "partial",
          { sourceHash: "old" },
          "new",
          "2026-09-19T18:59:00.000+09:00",
          requestedAt,
        ),
      ).toEqual(requestedAt)
      expect(
        resolveUpdatedAt(
          "partial",
          { sourceHash: "old" },
          "new",
          "2026-09-19T19:01:00.000+09:00",
          requestedAt,
        ),
      ).toEqual(null)
    })
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
