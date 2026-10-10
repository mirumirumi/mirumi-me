import { describe, expect, test } from "vitest"

import {
  createPageViewSql,
  parsePageViewSum,
  pickNotionPageUrl,
  resolveSite,
  toPageViewPath,
} from "./admin-data"

describe("admin data", () => {
  describe("resolveSite", () => {
    test("開いているページのホストで dev と prd の読み先を分ける", () => {
      expect(resolveSite("mirumi.me")?.dataset).toEqual("mirumi_me_pv_prd")
      expect(resolveSite("d3unw9ju8hrt73.cloudfront.net")?.dataset).toEqual("mirumi_me_pv_prd")
      expect(resolveSite("d3694gpnjd4x49.cloudfront.net")?.dataset).toEqual("mirumi_me_pv_dev")
      expect(resolveSite("example.com")).toEqual(null)
    })
  })

  describe("toPageViewPath", () => {
    test("Workers が数えるときと同じく、末尾スラッシュをそろえたトップと 1 階層のページにする", () => {
      expect(toPageViewPath("/")).toEqual("/")
      expect(toPageViewPath("/nuxt-ssg")).toEqual("/nuxt-ssg/")
      expect(toPageViewPath("/category/pc/")).toEqual(null)
      expect(toPageViewPath("/x' OR 1=1 --/")).toEqual(null)
    })
  })

  describe("createPageViewSql", () => {
    test("直近 31 日の PV の合計を、そのページのパスで数える", () => {
      expect(createPageViewSql("mirumi_me_pv_prd", "/nuxt-ssg/")).toEqual(
        "SELECT SUM(_sample_interval) AS pv FROM mirumi_me_pv_prd WHERE index1 = '/nuxt-ssg/' AND timestamp > NOW() - INTERVAL '31' DAY FORMAT JSON",
      )
    })
  })

  describe("parsePageViewSum", () => {
    test("数値でも文字列でも PV として読み、行がなければ 0 にする", () => {
      expect(parsePageViewSum({ data: [{ pv: 12 }] })).toEqual(12)
      expect(parsePageViewSum({ data: [{ pv: "34" }] })).toEqual(34)
      expect(parsePageViewSum({ data: [{ pv: null }] })).toEqual(0)
      expect(parsePageViewSum({ data: [] })).toEqual(0)
    })

    test("形の違う応答は例外にする", () => {
      expect(() => parsePageViewSum({ errors: [{ message: "bad" }] })).toThrow(
        "Analytics Engine の応答を読めませんでした",
      )
    })
  })

  describe("pickNotionPageUrl", () => {
    test("slug で引いた最初のページの URL を返し、なければ null にする", () => {
      expect(pickNotionPageUrl({ results: [{ url: "https://www.notion.so/abc" }] })).toEqual(
        "https://www.notion.so/abc",
      )
      expect(pickNotionPageUrl({ results: [] })).toEqual(null)
    })
  })
})
