import { describe, expect, test } from "vitest"

import {
  FIXED_PAGE_ROUTES,
  isIgnoredFixedPageSlug,
  isReservedPostSlug,
  isValidSlug,
  normalizeNotionPageId,
  resolvePublicRoute,
} from "./site-routes"

describe("site-routes", () => {
  describe("normalizeNotionPageId", () => {
    test("32 桁と UUID 形式を同じ小文字 UUID に揃える", () => {
      expect(normalizeNotionPageId("ABCDEF0123456789ABCDEF0123456789")).toEqual(
        "abcdef01-2345-6789-abcd-ef0123456789",
      )
      expect(normalizeNotionPageId("ABCDEF01-2345-6789-ABCD-EF0123456789")).toEqual(
        "abcdef01-2345-6789-abcd-ef0123456789",
      )
    })

    test("Notion page ID でない値は null にする", () => {
      expect(normalizeNotionPageId("not-a-page-id")).toEqual(null)
    })
  })

  describe("isValidSlug", () => {
    test("小文字英数字をハイフンで区切った slug だけを許可する", () => {
      expect(isValidSlug("valid-post-2026")).toEqual(true)
      expect(isValidSlug("Invalid-Post")).toEqual(false)
      expect(isValidSlug("invalid_post")).toEqual(false)
      expect(isValidSlug("-invalid")).toEqual(false)
    })
  })

  describe("isReservedPostSlug", () => {
    test("固定ページとシステム route の root を記事に使わせない", () => {
      expect(isReservedPostSlug("profile")).toEqual(true)
      expect(isReservedPostSlug("api")).toEqual(true)
      expect(isReservedPostSlug("contact")).toEqual(true)
      expect(isReservedPostSlug("entry-list")).toEqual(true)
      expect(isReservedPostSlug("what-is-this-blog")).toEqual(true)
      expect(isReservedPostSlug("ordinary-post")).toEqual(false)
    })
  })

  describe("isIgnoredFixedPageSlug", () => {
    test("CMS 移行対象外の旧固定ページを判定する", () => {
      expect(isIgnoredFixedPageSlug("home")).toEqual(true)
      expect(isIgnoredFixedPageSlug("new-entries")).toEqual(true)
      expect(isIgnoredFixedPageSlug("what-is-this-blog")).toEqual(true)
      expect(isIgnoredFixedPageSlug("profile")).toEqual(false)
    })
  })

  describe("resolvePublicRoute", () => {
    test("記事は slug 直下、固定ページは明示 mapping から route を決める", () => {
      expect(resolvePublicRoute("post", "ordinary-post")).toEqual("/ordinary-post/")
      expect(resolvePublicRoute("page", "home")).toEqual(null)
      expect(resolvePublicRoute("page", "new-entries")).toEqual(null)
      expect(resolvePublicRoute("page", "what-is-this-blog")).toEqual(null)
      expect(resolvePublicRoute("page", "profile")).toEqual("/profile/")
      expect(resolvePublicRoute("page", "unknown-page")).toEqual(null)
      expect(FIXED_PAGE_ROUTES.about).toEqual("/about/")
    })
  })
})
