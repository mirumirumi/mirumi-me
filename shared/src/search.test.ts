import { describe, expect, test } from "vitest"

import {
  normalizeSearchText,
  parseSearchIndex,
  parseSearchQuery,
  prepareSearchPosts,
  SEARCH_PER_PAGE,
  type SearchIndexPost,
  searchPosts,
} from "./search"

describe("search", () => {
  const post = (slug: string, overrides: Partial<SearchIndexPost> = {}): SearchIndexPost => {
    return {
      pageId: `00000000-0000-0000-0000-${slug.padStart(12, "0")}`,
      slug,
      title: `${slug} の記事`,
      publishedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: null,
      text: "",
      ...overrides,
    }
  }

  describe("normalizeSearchText", () => {
    test("全角の英数字と空白、大文字をそろえ、連続する空白を 1 つにする", () => {
      expect(normalizeSearchText("ＷＳＬ２　の  Setup\n手順")).toEqual("wsl2 の setup 手順")
    })
  })

  describe("parseSearchIndex", () => {
    test("Container が書いた索引を読み、形が違えば例外にする", () => {
      const index = { schemaVersion: 1, updatedAt: "2026-08-24T00:00:00.000Z", posts: [post("a")] }

      expect(parseSearchIndex(index)).toEqual(index)
      expect(() => parseSearchIndex({ ...index, schemaVersion: 2 })).toThrow(
        "検索の索引の schema が不正です",
      )
    })
  })

  describe("parseSearchQuery", () => {
    test("半角・全角の空白で語に分け、そろえたうえで重複と空を除く", () => {
      expect(parseSearchQuery(" Nuxt　ＳＳＧ  nuxt ")).toEqual(["nuxt", "ssg"])
    })

    test("語は 10 個までにする", () => {
      expect(
        parseSearchQuery(Array.from({ length: 12 }, (_, index) => `w${index}`).join(" ")),
      ).toHaveLength(10)
    })
  })

  describe("searchPosts", () => {
    test("すべての語を含む記事だけを、出現回数（タイトルは 3 倍）の多い順、同じなら新しい順に返す", () => {
      const posts = prepareSearchPosts([
        post("body-once", { text: "nuxt と ssg の話", publishedAt: "2026-03-01T00:00:00.000Z" }),
        post("body-twice", { text: "nuxt nuxt ssg", publishedAt: "2026-01-01T00:00:00.000Z" }),
        post("title", { title: "Nuxt の SSG", text: "", publishedAt: "2025-01-01T00:00:00.000Z" }),
        post("newer-once", { text: "nuxt ssg", publishedAt: "2026-05-01T00:00:00.000Z" }),
        post("only-nuxt", { text: "nuxt だけ" }),
      ])

      expect(searchPosts(posts, ["nuxt", "ssg"], 1)).toEqual({
        total: 4,
        pages: 1,
        posts: [
          {
            slug: "title",
            title: "Nuxt の SSG",
            publishedAt: "2025-01-01T00:00:00.000Z",
            updatedAt: null,
          },
          {
            slug: "body-twice",
            title: "body-twice の記事",
            publishedAt: "2026-01-01T00:00:00.000Z",
            updatedAt: null,
          },
          {
            slug: "newer-once",
            title: "newer-once の記事",
            publishedAt: "2026-05-01T00:00:00.000Z",
            updatedAt: null,
          },
          {
            slug: "body-once",
            title: "body-once の記事",
            publishedAt: "2026-03-01T00:00:00.000Z",
            updatedAt: null,
          },
        ],
      })
    })

    test("13 件ずつに分け、範囲の外のページは空にする", () => {
      const posts = prepareSearchPosts(
        Array.from({ length: SEARCH_PER_PAGE + 2 }, (_, index) => {
          return post(`p${index}`, {
            text: "hit",
            publishedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
          })
        }),
      )

      expect(searchPosts(posts, ["hit"], 2)).toEqual({
        total: SEARCH_PER_PAGE + 2,
        pages: 2,
        posts: [expect.objectContaining({ slug: "p1" }), expect.objectContaining({ slug: "p0" })],
      })
      expect(searchPosts(posts, ["hit"], 3).posts).toEqual([])
    })

    test("語がなければ何も返さない", () => {
      expect(searchPosts(prepareSearchPosts([post("a", { text: "a" })]), [], 1)).toEqual({
        total: 0,
        pages: 0,
        posts: [],
      })
    })
  })
})
