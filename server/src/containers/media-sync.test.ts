import { afterEach, describe, expect, test, vi } from "vitest"

import type { ArticleContent } from "shared/content"

import type { MediaNormalizer } from "./images"
import { downloadImage, isNotionHostedImage, syncArticleMedia } from "./media-sync"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("syncArticleMedia", () => {
  const article: ArticleContent = {
    id: "00000000-0000-0000-0000-000000000001",
    title: "記事",
    slug: "article",
    thumbnailUrl: "https://mirumi.media/0123456789abcdef-cover-1200x630.webp",
    thumbnailName: "0123456789abcdef-cover-1200x630.webp",
    publishedAt: "2026-08-24T00:00:00.000Z",
    updatedAt: null,
    category: { name: "技術", slug: "tech" },
    customCss: "",
    toc: { hidden: false, closed: false },
    blocks: [
      {
        id: "00000000-0000-0000-0000-000000000010",
        type: "image",
        url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/path/image.png?signature=x",
        caption: [],
        children: [],
      },
    ],
  }

  test("Notion upload だけ同期し、canonical thumbnail 群を復元する", async () => {
    const normalizeBodyImage = vi.fn(async () => ({
      fallbackUrl: "https://mirumi.media/hash-image-800w.webp",
      width: 800,
      animated: false,
    }))
    const result = await syncArticleMedia(
      article,
      { normalizeBodyImage } as unknown as MediaNormalizer,
      vi.fn(async () => new Uint8Array([1, 2, 3])),
      vi.fn(),
    )

    expect(result.article.blocks[0]).toEqual(
      expect.objectContaining({ url: "https://mirumi.media/hash-image-800w.webp" }),
    )
    expect(result.thumbnailUrls).toEqual({
      article: "https://mirumi.media/0123456789abcdef-cover-1200x630.webp",
      mobile: "https://mirumi.media/0123456789abcdef-cover-600x315.webp",
      card: "https://mirumi.media/0123456789abcdef-cover-412x216.webp",
    })
    expect(result.ogImageUrl).toEqual("https://mirumi.media/0123456789abcdef-cover-1200x630.webp")
    expect(normalizeBodyImage).toHaveBeenCalledOnce()
  })

  test("Notion thumbnail は署名 URL ではなく Files property の name で正規化する", async () => {
    const thumbnailUrls = {
      article: "https://mirumi.media/hash-my-cover-1200x630.webp",
      mobile: "https://mirumi.media/hash-my-cover-600x315.webp",
      card: "https://mirumi.media/hash-my-cover-412x216.webp",
    }
    const normalizeThumbnailImage = vi.fn(async () => thumbnailUrls)
    const downloader = vi.fn(async () => new Uint8Array([1, 2, 3]))
    const result = await syncArticleMedia(
      {
        ...article,
        thumbnailUrl: "https://file.notion.so/signed-url?signature=x",
        thumbnailName: "My Cover.png",
        blocks: [],
      },
      { normalizeThumbnailImage } as unknown as MediaNormalizer,
      downloader,
      vi.fn(),
    )

    expect(normalizeThumbnailImage).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "My Cover.png",
      "thumbnail-000000000001",
    )
    expect(result.thumbnailUrls).toEqual(thumbnailUrls)
    expect(result.article.thumbnailUrl).toEqual(thumbnailUrls.article)
  })

  test("WordPress 時代の非 canonical thumbnail もホストを問わず取り込む", async () => {
    const thumbnailUrls = {
      article: "https://mirumi.media/hash-dygma-defy-1200x630.webp",
      mobile: "https://mirumi.media/hash-dygma-defy-600x315.webp",
      card: "https://mirumi.media/hash-dygma-defy-412x216.webp",
    }
    const normalizeThumbnailImage = vi.fn(async () => thumbnailUrls)
    const downloader = vi.fn(async () => new Uint8Array([1, 2, 3]))
    const result = await syncArticleMedia(
      {
        ...article,
        thumbnailUrl: "https://mirumi.media/dygma-defy.jpg",
        thumbnailName: "dygma-defy.jpg",
        blocks: [],
      },
      { normalizeThumbnailImage } as unknown as MediaNormalizer,
      downloader,
      vi.fn(),
    )
    expect(downloader).toHaveBeenCalledWith("https://mirumi.media/dygma-defy.jpg")
    expect(normalizeThumbnailImage).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "dygma-defy.jpg",
      "thumbnail-000000000001",
    )
    expect(result.thumbnailUrls).toEqual(thumbnailUrls)
    expect(result.article.thumbnailUrl).toEqual(thumbnailUrls.article)
  })

  test("thumbnail が空なら自動生成画像を OGP だけに使う", async () => {
    const normalizeThumbnailImage = vi.fn(async () => ({
      article: "https://mirumi.media/generated-1200x630.webp",
      mobile: "https://mirumi.media/generated-600x315.webp",
      card: "https://mirumi.media/generated-412x216.webp",
    }))
    const result = await syncArticleMedia(
      { ...article, thumbnailUrl: null, blocks: [] },
      { normalizeThumbnailImage } as unknown as MediaNormalizer,
      vi.fn(),
      vi.fn(async () => new Uint8Array([1, 2, 3])),
    )

    expect(result.thumbnailUrls).toEqual(null)
    expect(result.ogImageUrl).toEqual("https://mirumi.media/generated-1200x630.webp")
    expect(normalizeThumbnailImage).toHaveBeenCalledOnce()
  })
})

describe("isNotionHostedImage", () => {
  test("Notion の一時 URL だけを識別する", () => {
    expect(
      isNotionHostedImage(
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/path/image.png?signature=x",
      ),
    ).toEqual(true)
    expect(isNotionHostedImage("https://file.notion.so/image.png")).toEqual(true)
    expect(isNotionHostedImage("https://mirumi.media/image.png")).toEqual(false)
    expect(isNotionHostedImage("https://example.com/image.png")).toEqual(false)
  })
})

describe("downloadImage", () => {
  test("S3 の古い octet-stream 画像も bytes を取得して Sharp 検証へ渡す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "binary/octet-stream" },
        })
      }),
    )

    expect(await downloadImage("https://mirumi.media/legacy.webp")).toEqual(
      new Uint8Array([1, 2, 3]),
    )
  })
})
