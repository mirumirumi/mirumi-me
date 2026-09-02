import { afterEach, describe, expect, test, vi } from "vitest"

import type { BookmarkCache } from "./bookmark"
import { fetchBookmarkCard, resolveExternalBookmark, validateBookmarkUrl } from "./bookmark"

describe("bookmark", () => {
  class MemoryCache implements BookmarkCache {
    value: string | null = null

    async get(): Promise<string | null> {
      return this.value
    }

    async put(_key: string, value: string): Promise<void> {
      this.value = value
    }
  }

  describe("validateBookmarkUrl", () => {
    test("公開 http(s) URL だけを許可する", () => {
      expect(validateBookmarkUrl("https://example.com/article#fragment").href).toEqual(
        "https://example.com/article",
      )
      expect(() => validateBookmarkUrl("http://127.0.0.1/private")).toThrowError()
      expect(() => validateBookmarkUrl("http://169.254.169.254/latest")).toThrowError()
      expect(() => validateBookmarkUrl("http://[::ffff:127.0.0.1]/private")).toThrowError()
      expect(() => validateBookmarkUrl("https://user:pass@example.com/")).toThrowError()
      expect(() => validateBookmarkUrl("https://example.com:8443/")).toThrowError()
    })

    test("private range と内部ホスト名を弾く", () => {
      expect(() => validateBookmarkUrl("http://10.0.0.1/")).toThrowError()
      expect(() => validateBookmarkUrl("http://172.16.0.1/")).toThrowError()
      expect(() => validateBookmarkUrl("http://192.168.0.1/")).toThrowError()
      expect(() => validateBookmarkUrl("http://100.64.0.1/")).toThrowError()
      expect(() => validateBookmarkUrl("http://printer.local/")).toThrowError()
      expect(() => validateBookmarkUrl("http://metadata.google.internal/")).toThrowError()
      // URL parser が正規化するので整数・8 進表記も dotted-quad として弾ける
      expect(() => validateBookmarkUrl("http://2130706433/")).toThrowError()
      // 末尾ドット付き FQDN でも完全一致の denylist を外れない
      expect(() => validateBookmarkUrl("http://metadata.google.internal./")).toThrowError()
      expect(() => validateBookmarkUrl("http://printer.local./")).toThrowError()
    })
  })

  describe("fetchBookmarkCard", () => {
    const realFetch = globalThis.fetch

    afterEach(() => {
      globalThis.fetch = realFetch
    })

    const stubFetch = (responses: Array<Response>) => {
      const requested: Array<string> = []
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        requested.push(String(input))
        const response = responses.shift()
        if (!response) {
          throw Error("想定外の追加 request")
        }

        return response
      })
      globalThis.fetch = fetcher as unknown as typeof fetch

      return requested
    }

    const htmlResponse = (body: string, init: ResponseInit = {}): Response => {
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
        ...init,
      })
    }

    test("OGP から card を組み立て、相対 image URL を絶対化する", async () => {
      stubFetch([
        htmlResponse(
          `<html><head>
            <meta property="og:title" content="記事の &amp; タイトル">
            <meta property="og:description" content="説明文">
            <meta property="og:image" content="/images/ogp.png">
          </head><body></body></html>`,
        ),
      ])

      expect(await fetchBookmarkCard(new URL("https://example.com/article"))).toEqual({
        kind: "external",
        url: "https://example.com/article",
        title: "記事の & タイトル",
        description: "説明文",
        imageUrl: "https://example.com/images/ogp.png",
        label: "example.com",
      })
    })

    test("redirect 先を再検証し、private address へは追従しない", async () => {
      const requested = stubFetch([
        new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest" } }),
        htmlResponse("<html><head><title>到達してはいけない</title></head></html>"),
      ])

      await expect(fetchBookmarkCard(new URL("https://example.com/redirect"))).rejects.toThrow()
      expect(requested).toEqual(["https://example.com/redirect"])
    })

    test("公開 URL への redirect には追従する", async () => {
      stubFetch([
        new Response(null, { status: 301, headers: { Location: "https://example.org/moved" } }),
        htmlResponse("<html><head><title>移動先</title></head></html>"),
      ])
      const card = await fetchBookmarkCard(new URL("https://example.com/old"))

      expect(card.url).toEqual("https://example.org/moved")
      expect(card.title).toEqual("移動先")
    })

    test("HTML でない response は取得しない", async () => {
      stubFetch([
        new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
      ])

      await expect(fetchBookmarkCard(new URL("https://example.com/api"))).rejects.toThrow()
    })
  })

  describe("resolveExternalBookmark", () => {
    test("30日以内の cache は外部 fetch せず返す", async () => {
      const cache = new MemoryCache()
      cache.value = JSON.stringify({
        version: 1,
        fetchedAt: "2026-08-20T00:00:00.000Z",
        card: {
          kind: "external",
          url: "https://example.com/",
          title: "cached",
          description: null,
          imageUrl: null,
          label: "example.com",
        },
      })
      const fetchCard = vi.fn()

      expect(
        await resolveExternalBookmark(
          "https://example.com/",
          cache,
          fetchCard,
          "2026-08-24T00:00:00.000Z",
        ),
      ).toEqual(expect.objectContaining({ title: "cached" }))
      expect(fetchCard).not.toHaveBeenCalled()
    })

    test("再取得失敗時は stale cache を返す", async () => {
      const cache = new MemoryCache()
      cache.value = JSON.stringify({
        version: 1,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        card: {
          kind: "external",
          url: "https://example.com/",
          title: "stale",
          description: null,
          imageUrl: null,
          label: "example.com",
        },
      })

      expect(
        await resolveExternalBookmark(
          "https://example.com/",
          cache,
          vi.fn(async () => {
            throw Error("temporary failure")
          }),
          "2026-08-24T00:00:00.000Z",
        ),
      ).toEqual(expect.objectContaining({ title: "stale" }))
    })

    test("disposable cache の障害だけでは取得済み card を失わない", async () => {
      const card = {
        kind: "external" as const,
        url: "https://example.com/",
        title: "fetched",
        description: null,
        imageUrl: null,
        label: "example.com",
      }
      const cache: BookmarkCache = {
        get: async () => {
          throw Error("cache get failed")
        },
        put: async () => {
          throw Error("cache put failed")
        },
      }

      expect(
        await resolveExternalBookmark(
          "https://example.com/",
          cache,
          vi.fn(async () => card),
          "2026-08-24T00:00:00.000Z",
        ),
      ).toEqual(card)
    })
  })
})
