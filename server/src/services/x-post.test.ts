import { afterEach, describe, expect, test, vi } from "vitest"

import type { XPostCache } from "shared/x-post"
import { resolveXPost } from "shared/x-post"

import { createXaiPostFetcher } from "./x-post"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createXaiPostFetcher", () => {
  const response = (citations: Array<string>): Response => {
    return Response.json({
      citations,
      output: [
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: JSON.stringify({
                text: "投稿本文",
                authorName: "みるみ",
                authorHandle: "__mirumi__",
                createdAt: null,
              }),
            },
          ],
        },
      ],
    })
  }

  test("X Search の citation が対象 post ID を指すときだけ採用する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(["https://x.com/__mirumi__/status/1234567890"])),
    )

    expect(await createXaiPostFetcher("api-key", "grok-4.6")("1234567890")).toEqual(
      expect.objectContaining({ postId: "1234567890", text: "投稿本文" }),
    )
  })

  test("対象 post の citation がない結果は推測として拒否する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(["https://x.com/other/status/9999999999"])),
    )

    await expect(createXaiPostFetcher("api-key", "grok-4.6")("1234567890")).rejects.toThrow(
      "citation",
    )
  })

  test("X 以外の同じ path を citation として採用しない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(["https://example.com/status/1234567890"])),
    )

    await expect(createXaiPostFetcher("api-key", "grok-4.6")("1234567890")).rejects.toThrow(
      "citation",
    )
  })
})

describe("resolveXPost", () => {
  class MemoryCache implements XPostCache {
    value: string | null = null

    async get(): Promise<string | null> {
      return this.value
    }

    async put(_key: string, value: string): Promise<void> {
      this.value = value
    }
  }

  test("正規化済み cache があれば xAI を呼ばない", async () => {
    const cache = new MemoryCache()
    cache.value = JSON.stringify({
      version: 1,
      fetchedAt: "2026-08-24T00:00:00.000Z",
      post: {
        postId: "1234567890",
        url: "https://x.com/__mirumi__/status/1234567890",
        text: "投稿本文",
        authorName: "みるみ",
        authorHandle: "__mirumi__",
        createdAt: null,
      },
    })
    const fetchPost = vi.fn()

    expect(await resolveXPost("1234567890", cache, fetchPost)).toEqual(
      expect.objectContaining({ postId: "1234567890", text: "投稿本文" }),
    )
    expect(fetchPost).not.toHaveBeenCalled()
  })

  test("cache miss では xAI の結果を保存する", async () => {
    const cache = new MemoryCache()
    const post = {
      postId: "1234567890",
      url: "https://x.com/__mirumi__/status/1234567890",
      text: "投稿本文",
      authorName: "みるみ",
      authorHandle: "__mirumi__",
      createdAt: "2026-08-24T00:00:00.000Z",
    }

    expect(
      await resolveXPost(
        "1234567890",
        cache,
        vi.fn(async () => post),
      ),
    ).toEqual(post)
    expect(JSON.parse(cache.value ?? "null")).toEqual(expect.objectContaining({ version: 1, post }))
  })

  test("disposable cache の障害だけでは xAI の取得結果を失わない", async () => {
    const post = {
      postId: "1234567890",
      url: "https://x.com/__mirumi__/status/1234567890",
      text: "投稿本文",
      authorName: "みるみ",
      authorHandle: "__mirumi__",
      createdAt: null,
    }
    const cache: XPostCache = {
      get: async () => {
        throw Error("cache get failed")
      },
      put: async () => {
        throw Error("cache put failed")
      },
    }

    expect(
      await resolveXPost(
        "1234567890",
        cache,
        vi.fn(async () => post),
      ),
    ).toEqual(post)
  })
})
