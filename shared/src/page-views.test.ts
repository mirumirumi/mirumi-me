import { describe, expect, test } from "vitest"

import { normalizePageViewPath } from "./page-views"

describe("normalizePageViewPath", () => {
  test("末尾スラッシュの有無をそろえ、トップと 1 階層のページだけを返す", () => {
    expect(normalizePageViewPath("/")).toEqual("/")
    expect(normalizePageViewPath("/nuxt-ssg")).toEqual("/nuxt-ssg/")
    expect(normalizePageViewPath("/nuxt-ssg/")).toEqual("/nuxt-ssg/")
  })

  test("2 階層以上、slug として不正な文字、クエリや hash を含むものは数えない", () => {
    for (const path of [
      "/category/pc/",
      "/Nuxt/",
      "/nuxt_ssg/",
      "/nuxt-ssg/?p=1",
      "/nuxt-ssg/#toc",
      "nuxt-ssg",
      "",
    ]) {
      expect(normalizePageViewPath(path)).toEqual(null)
    }
  })
})
