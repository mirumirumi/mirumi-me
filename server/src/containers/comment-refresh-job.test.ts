import { describe, expect, test } from "vitest"

import type { BuildPage } from "shared/build-manifest"
import { parseBuildPage } from "shared/build-manifest"

import type { DeployedPage, SiteDeploymentState } from "../lib/publishing"
import {
  createCommentRefreshedSnapshot,
  createCommentRefreshPlan,
  findPublishedPostBySlug,
  isRefreshedByThisRequest,
  replaceSnapshotComments,
} from "./comment-refresh-job"
import { createBuildPageContentHash } from "./published-pages"

describe("comment refresh job", () => {
  const deployed: DeployedPage = {
    pageId: "00000000-0000-0000-0000-000000000001",
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
  }
  const state: SiteDeploymentState = {
    schemaVersion: 1,
    updatedAt: "2026-08-24T01:05:00.000Z",
    pages: {
      [deployed.pageId]: deployed,
      "00000000-0000-0000-0000-000000000002": {
        ...deployed,
        pageId: "00000000-0000-0000-0000-000000000002",
        status: "unpublished",
        route: "/hidden/",
        slug: "hidden",
      },
      "00000000-0000-0000-0000-000000000003": {
        ...deployed,
        pageId: "00000000-0000-0000-0000-000000000003",
        kind: "page",
        route: "/about/",
        slug: "about",
        category: null,
      },
    },
    routeOwners: {
      "/article/": deployed.pageId,
      "/hidden/": "00000000-0000-0000-0000-000000000002",
      "/about/": "00000000-0000-0000-0000-000000000003",
    },
  }
  const snapshot: BuildPage = parseBuildPage({
    schemaVersion: 1,
    pageId: deployed.pageId,
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
  })

  describe("findPublishedPostBySlug", () => {
    test("公開中の記事だけを slug で引く", () => {
      expect(findPublishedPostBySlug(state, "article")).toEqual(deployed)
      expect(findPublishedPostBySlug(state, "hidden")).toEqual(null)
      expect(findPublishedPostBySlug(state, "about")).toEqual(null)
      expect(findPublishedPostBySlug(state, "unknown")).toEqual(null)
    })
  })

  describe("replaceSnapshotComments", () => {
    test("comments だけを差し替え、hash は comments の内容で変わる", () => {
      const comments = [
        {
          id: "123",
          parentId: null,
          authorName: "読者",
          createdAt: "2026-08-25T00:00:00.000Z",
          contentHtml: "<p>コメント</p>",
          isOwner: false,
        },
      ]
      const replaced = replaceSnapshotComments(snapshot, comments)

      expect(replaced).toEqual({ ...snapshot, comments })
      expect(createBuildPageContentHash(replaced)).not.toEqual(createBuildPageContentHash(snapshot))
      expect(createBuildPageContentHash(replaceSnapshotComments(snapshot, []))).toEqual(
        createBuildPageContentHash(snapshot),
      )
    })
  })

  describe("createCommentRefreshPlan", () => {
    test("記事 1 本の route だけを持つ partial plan にする", () => {
      expect(createCommentRefreshPlan("workflow-id", "2026-09-21T00:00:00.000Z", deployed)).toEqual(
        {
          schemaVersion: 1,
          workflowId: "workflow-id",
          mode: "partial",
          generatedAt: "2026-09-21T00:00:00.000Z",
          routes: ["/article/"],
          pageIdsByRoute: { "/article/": deployed.pageId },
        },
      )
    })
  })

  describe("isRefreshedByThisRequest", () => {
    test("index の deployedAt が自分の requestedAt と同じときだけ、応答が失われた retry とみなす", () => {
      expect(
        isRefreshedByThisRequest(deployed, { requestedAt: "2026-08-24T01:05:00.000Z" }),
      ).toEqual(true)
      expect(
        isRefreshedByThisRequest(deployed, { requestedAt: "2026-09-21T00:00:00.000Z" }),
      ).toEqual(false)
    })
  })

  describe("createCommentRefreshedSnapshot", () => {
    test("contentHash と deployedAt だけを進め、記事本文の版は動かさない", () => {
      expect(
        createCommentRefreshedSnapshot(deployed, "new-hash", "2026-09-21T00:00:00.000Z"),
      ).toEqual({
        ...deployed,
        contentHash: "new-hash",
        deployedAt: "2026-09-21T00:00:00.000Z",
      })
    })
  })
})
