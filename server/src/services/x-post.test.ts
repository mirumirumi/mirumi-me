import { afterEach, describe, expect, test, vi } from "vitest"

import type { StaticXPostData, XPostCache } from "shared/x-post"
import { extractXPostLinkUrl, resolveXPost } from "shared/x-post"

import { createXaiPostFetcher, createXPostLinkCardResolver } from "./x-post"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createXaiPostFetcher", () => {
  const response = (
    output: Record<string, unknown>,
    usage: Record<string, number> = { x_search_calls: 1, x_posts_fetched: 1 },
  ): Response => {
    return Response.json({
      usage: { server_side_tool_usage_details: usage },
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(output) }],
        },
      ],
    })
  }
  const post = {
    text: "投稿本文",
    authorName: "みるみ",
    authorHandle: "@__mirumi__",
    url: "https://x.com/__mirumi__/status/1234567890",
    createdAt: null,
    avatarUrl: "https://pbs.twimg.com/profile_images/1/icon.jpg",
    mediaUrls: ["https://pbs.twimg.com/media/abc.jpg"],
    replyCount: 14,
    repostCount: 13684,
    likeCount: 10516,
  }

  test("X Search が走って URL が対象 post を指すときだけ採用し、handle の @ は落とす", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(post)),
    )

    expect(await createXaiPostFetcher("api-key", "grok-4.7")("1234567890")).toEqual({
      postId: "1234567890",
      url: "https://x.com/__mirumi__/status/1234567890",
      text: "投稿本文",
      authorName: "みるみ",
      authorHandle: "__mirumi__",
      avatarUrl: "https://pbs.twimg.com/profile_images/1/icon.jpg",
      mediaUrls: ["https://pbs.twimg.com/media/abc.jpg"],
      replyCount: 14,
      repostCount: 13684,
      likeCount: 10516,
      linkCard: null,
      createdAt: null,
    })
  })

  test("X の media host 以外のアイコンと画像は落とす", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ...post,
          avatarUrl: "https://example.com/icon.jpg",
          mediaUrls: ["https://example.com/photo.jpg", "https://pbs.twimg.com/media/ok.jpg"],
        }),
      ),
    )
    const resolved = await createXaiPostFetcher("api-key", "grok-4.7")("1234567890")

    expect(resolved.avatarUrl).toEqual(null)
    expect(resolved.mediaUrls).toEqual(["https://pbs.twimg.com/media/ok.jpg"])
  })

  test("負の数や小数のカウントは採用しない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ...post, replyCount: -1, likeCount: 1.5 })),
    )
    const resolved = await createXaiPostFetcher("api-key", "grok-4.7")("1234567890")

    expect(resolved.replyCount).toEqual(null)
    expect(resolved.likeCount).toEqual(null)
    expect(resolved.repostCount).toEqual(13684)
  })

  test("X Search が走っていない結果は推測として拒否する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(post, { x_search_calls: 0, x_posts_fetched: 0 })),
    )

    await expect(createXaiPostFetcher("api-key", "grok-4.7")("1234567890")).rejects.toThrow(
      "X Search",
    )
  })

  test("別の post を指す URL が返ったら拒否する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ...post, url: "https://x.com/other/status/9999999999" })),
    )

    await expect(createXaiPostFetcher("api-key", "grok-4.7")("1234567890")).rejects.toThrow(
      "別の X post",
    )
  })

  test("X 以外のホストの同じ path は採用しない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ...post, url: "https://example.com/status/1234567890" })),
    )

    await expect(createXaiPostFetcher("api-key", "grok-4.7")("1234567890")).rejects.toThrow(
      "別の X post",
    )
  })

  test("取得できず text が空なら拒否する", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ ...post, text: "" })),
    )

    await expect(createXaiPostFetcher("api-key", "grok-4.7")("1234567890")).rejects.toThrow()
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
      version: 4,
      fetchedAt: "2026-08-24T00:00:00.000Z",
      post: {
        postId: "1234567890",
        url: "https://x.com/__mirumi__/status/1234567890",
        text: "投稿本文",
        authorName: "みるみ",
        authorHandle: "__mirumi__",
        avatarUrl: null,
        mediaUrls: [],
        replyCount: null,
        repostCount: null,
        likeCount: null,
        linkCard: null,
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
      avatarUrl: null,
      mediaUrls: [],
      replyCount: null,
      repostCount: null,
      likeCount: null,
      linkCard: null,
      createdAt: "2026-08-24T00:00:00.000Z",
    }

    expect(
      await resolveXPost(
        "1234567890",
        cache,
        vi.fn(async () => post),
      ),
    ).toEqual(post)
    expect(JSON.parse(cache.value ?? "null")).toEqual(expect.objectContaining({ version: 4, post }))
  })

  test("本文のリンクから card を取得して post に足す", async () => {
    const cache = new MemoryCache()
    const fetched: StaticXPostData = {
      postId: "1234567890",
      url: "https://x.com/__mirumi__/status/1234567890",
      text: "記念サイトが公開されました https://example.com/site/ どうぞ",
      authorName: "みるみ",
      authorHandle: "__mirumi__",
      avatarUrl: null,
      mediaUrls: [],
      replyCount: null,
      repostCount: null,
      likeCount: null,
      linkCard: null,
      createdAt: null,
    }
    const resolveLinkCard = vi.fn(async (url: string) => ({
      url,
      title: "リンク先",
      description: null,
      imageUrl: null,
    }))
    const resolved = await resolveXPost(
      "1234567890",
      cache,
      vi.fn(async () => fetched),
      resolveLinkCard,
    )

    expect(resolveLinkCard).toHaveBeenCalledWith("https://example.com/site/")
    expect(resolved.linkCard).toEqual({
      url: "https://example.com/site/",
      title: "リンク先",
      description: null,
      imageUrl: null,
    })
    expect(JSON.parse(cache.value ?? "null").post.linkCard).toEqual(resolved.linkCard)
  })

  test("添付画像があるときは card を取りに行かない", async () => {
    const fetched: StaticXPostData = {
      postId: "1234567890",
      url: "https://x.com/__mirumi__/status/1234567890",
      text: "写真と https://example.com/site/ を貼った投稿",
      authorName: "みるみ",
      authorHandle: "__mirumi__",
      avatarUrl: null,
      mediaUrls: ["https://pbs.twimg.com/media/abc.jpg"],
      replyCount: null,
      repostCount: null,
      likeCount: null,
      linkCard: null,
      createdAt: null,
    }
    const resolveLinkCard = vi.fn()
    const resolved = await resolveXPost(
      "1234567890",
      new MemoryCache(),
      vi.fn(async () => fetched),
      resolveLinkCard,
    )

    expect(resolveLinkCard).not.toHaveBeenCalled()
    expect(resolved.linkCard).toEqual(null)
  })

  test("card の取得に失敗しても投稿自体は返す", async () => {
    const fetched: StaticXPostData = {
      postId: "1234567890",
      url: "https://x.com/__mirumi__/status/1234567890",
      text: "https://example.com/site/",
      authorName: "みるみ",
      authorHandle: "__mirumi__",
      avatarUrl: null,
      mediaUrls: [],
      replyCount: null,
      repostCount: null,
      likeCount: null,
      linkCard: null,
      createdAt: null,
    }

    expect(
      await resolveXPost(
        "1234567890",
        new MemoryCache(),
        vi.fn(async () => fetched),
        vi.fn(async () => {
          throw Error("OGP を取得できません")
        }),
      ),
    ).toEqual(expect.objectContaining({ linkCard: null, text: "https://example.com/site/" }))
  })

  test("disposable cache の障害だけでは xAI の取得結果を失わない", async () => {
    const post = {
      postId: "1234567890",
      url: "https://x.com/__mirumi__/status/1234567890",
      text: "投稿本文",
      authorName: "みるみ",
      authorHandle: "__mirumi__",
      avatarUrl: null,
      mediaUrls: [],
      replyCount: null,
      repostCount: null,
      likeCount: null,
      linkCard: null,
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

describe("extractXPostLinkUrl", () => {
  test("X 内のリンクは飛ばして最初の外部 URL を返す", () => {
    expect(
      extractXPostLinkUrl(
        "引用 https://x.com/__mirumi__/status/1 と https://example.com/a?b=1 です",
      ),
    ).toEqual("https://example.com/a?b=1")
  })

  test("文末の句読点は URL に含めない", () => {
    expect(extractXPostLinkUrl("詳細は https://example.com/site/.")).toEqual(
      "https://example.com/site/",
    )
  })

  test("リンクがなければ null を返す", () => {
    expect(extractXPostLinkUrl("ただの本文")).toEqual(null)
  })
})

describe("createXPostLinkCardResolver", () => {
  class MemoryBookmarkCache {
    value: string | null = null

    async get(): Promise<string | null> {
      return this.value
    }

    async put(_key: string, value: string): Promise<void> {
      this.value = value
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test("OGP を取得できたら card にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            `<html><head><meta property="og:title" content="リンク先"><meta property="og:description" content="説明"></head></html>`,
            { status: 200, headers: { "Content-Type": "text/html" } },
          ),
      ),
    )

    expect(
      await createXPostLinkCardResolver(new MemoryBookmarkCache())("https://example.com/site/"),
    ).toEqual(expect.objectContaining({ title: "リンク先", description: "説明" }))
  })

  test("リンク切れで host 名だけになった card は捨てる", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    )

    expect(
      await createXPostLinkCardResolver(new MemoryBookmarkCache())("https://t.co/PisKzAC0ur"),
    ).toEqual(null)
  })
})
