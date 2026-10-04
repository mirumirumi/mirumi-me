import { describe, expect, test, vi } from "vitest"

import type { SearchIndex } from "shared/search"

import {
  SEARCH_INDEX_REFRESH_INTERVAL_MS,
  SearchIndexCache,
  type SearchIndexLoadResult,
  SignedS3SearchIndexSource,
} from "./search"

const index = (title: string): SearchIndex => ({
  schemaVersion: 1,
  updatedAt: "2026-08-24T00:00:00.000Z",
  posts: [
    {
      pageId: "00000000-0000-0000-0000-000000000001",
      slug: "article",
      title,
      publishedAt: "2026-08-24T00:00:00.000Z",
      updatedAt: null,
      text: "本文",
    },
  ],
})

describe("SignedS3SearchIndexSource", () => {
  const createSource = (fetcher: typeof fetch): SignedS3SearchIndexSource => {
    return new SignedS3SearchIndexSource({
      fetcher,
      region: "ap-northeast-1",
      bucket: "bucket",
      credentials: { accessKeyId: "AKID", secretAccessKey: "secret" },
    })
  }

  test("署名付き GET で索引を読み、ETag を持っていれば変わったときだけ本文を受け取る", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(index("題名")), { status: 200, headers: { ETag: '"v1"' } }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const source = createSource(fetcher)

    expect(await source.load(null)).toEqual({
      status: "loaded",
      etag: '"v1"',
      index: index("題名"),
    })
    expect(await source.load('"v1"')).toEqual({ status: "unchanged" })
    expect(await source.load(null)).toEqual({ status: "missing" })
    expect(String(fetcher.mock.calls[0]?.[0])).toEqual(
      "https://bucket.s3.ap-northeast-1.amazonaws.com/_internal/search-index-v1.json",
    )
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("If-None-Match")).toEqual('"v1"')
  })

  test("S3 が失敗したら例外にする", async () => {
    const source = createSource(
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 500 })),
    )

    await expect(source.load(null)).rejects.toThrow("検索の索引の取得に失敗しました: 500")
  })
})

describe("SearchIndexCache", () => {
  const createCache = (results: Array<SearchIndexLoadResult | Error>) => {
    let now = 0
    const load = vi.fn(async (_etag: string | null): Promise<SearchIndexLoadResult> => {
      const result = results.shift()
      if (!result) {
        throw Error("想定より多く読んだ")
      }
      if (result instanceof Error) {
        throw result
      }

      return result
    })
    const cache = new SearchIndexCache({ source: { load }, now: () => now })

    return {
      cache,
      load,
      advance: (ms: number) => {
        now += ms
      },
    }
  }

  test("最初の 1 回だけ S3 から読み、間隔のあいだはメモリの索引を返す", async () => {
    const { cache, load } = createCache([{ status: "loaded", etag: '"v1"', index: index("題名") }])

    expect((await cache.posts()).map((post) => post.titleKey)).toEqual(["題名"])
    expect((await cache.posts()).map((post) => post.titleKey)).toEqual(["題名"])
    expect(load).toHaveBeenCalledOnce()
  })

  test("間隔が過ぎたら ETag つきで確かめ、変わっていればそれに替える", async () => {
    const { cache, load, advance } = createCache([
      { status: "loaded", etag: '"v1"', index: index("古い") },
      { status: "unchanged" },
      { status: "loaded", etag: '"v2"', index: index("新しい") },
    ])

    await cache.posts()
    advance(SEARCH_INDEX_REFRESH_INTERVAL_MS)
    expect((await cache.posts()).map((post) => post.titleKey)).toEqual(["古い"])
    advance(SEARCH_INDEX_REFRESH_INTERVAL_MS)
    expect((await cache.posts()).map((post) => post.titleKey)).toEqual(["新しい"])
    expect(load.mock.calls.map(([etag]) => etag)).toEqual([null, '"v1"', '"v1"'])
  })

  test("同時に来たリクエストは 1 回の読み込みを待ち合わせる", async () => {
    const { cache, load } = createCache([{ status: "loaded", etag: '"v1"', index: index("題名") }])

    await Promise.all([cache.posts(), cache.posts(), cache.posts()])

    expect(load).toHaveBeenCalledOnce()
  })

  test("確かめるのに失敗しても、持っている索引で答え続ける", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const { cache, advance } = createCache([
      { status: "loaded", etag: '"v1"', index: index("題名") },
      Error("S3 が落ちた"),
    ])

    await cache.posts()
    advance(SEARCH_INDEX_REFRESH_INTERVAL_MS)

    expect((await cache.posts()).map((post) => post.titleKey)).toEqual(["題名"])
    warn.mockRestore()
  })

  test("索引がまだなければ 0 件として扱い、持っている索引がないまま失敗したら例外にする", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const missing = createCache([{ status: "missing" }])
    expect(await missing.cache.posts()).toEqual([])

    const failing = createCache([Error("S3 が落ちた")])
    await expect(failing.cache.posts()).rejects.toThrow("S3 が落ちた")
    warn.mockRestore()
  })
})
