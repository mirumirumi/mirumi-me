import { afterEach, describe, expect, test, vi } from "vitest"

import type { ArticleContent } from "shared/content"

import type { MediaNormalizer } from "./images"
import { downloadImage, downloadMediaFile, syncAppStoreIcons, syncArticleMedia } from "./media-sync"

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
      fallbackUrl: "https://mirumi.media/0123456789abcdef-image-800x400-800w.webp",
      width: 800,
      height: 400,
      animated: false,
    }))
    const result = await syncArticleMedia(
      article,
      { normalizeBodyImage } as unknown as MediaNormalizer,
      { image: vi.fn(async () => new Uint8Array([1, 2, 3])), file: vi.fn() },
      vi.fn(),
    )

    expect(result.article.blocks[0]).toEqual(
      expect.objectContaining({
        url: "https://mirumi.media/0123456789abcdef-image-800x400-800w.webp",
      }),
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
      { image: downloader, file: vi.fn() },
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
      { image: downloader, file: vi.fn() },
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
      { image: vi.fn(), file: vi.fn() },
      vi.fn(async () => new Uint8Array([1, 2, 3])),
    )

    expect(result.thumbnailUrls).toEqual(null)
    expect(result.ogImageUrl).toEqual("https://mirumi.media/generated-1200x630.webp")
    expect(normalizeThumbnailImage).toHaveBeenCalledOnce()
  })

  test("Notion にアップロードした audio / video だけを元 bytes のまま置き、同じファイルは 1 回だけ取りに行く", async () => {
    const uploaded =
      "https://prod-files-secure.s3.us-west-2.amazonaws.com/space/file/movie.mp4?X-Amz-Signature=x"
    const copyBodyFile = vi.fn(async () => "https://mirumi.media/0123456789abcdef-movie.mp4")
    const file = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "video/mp4",
    }))
    const result = await syncArticleMedia(
      {
        ...article,
        blocks: [
          { id: "video-1", type: "video", url: uploaded, caption: [], children: [] },
          { id: "video-2", type: "video", url: uploaded, caption: [], children: [] },
          {
            id: "youtube",
            type: "video",
            url: "https://www.youtube.com/watch?v=abc",
            caption: [],
            children: [],
          },
          {
            id: "legacy-audio",
            type: "audio",
            url: "https://mirumi.media/voice.mp3",
            caption: [],
            children: [],
          },
        ],
      },
      { copyBodyFile } as unknown as MediaNormalizer,
      { image: vi.fn(), file },
      vi.fn(),
    )

    expect(result.article.blocks.map((block) => ("url" in block ? block.url : null))).toEqual([
      "https://mirumi.media/0123456789abcdef-movie.mp4",
      "https://mirumi.media/0123456789abcdef-movie.mp4",
      "https://www.youtube.com/watch?v=abc",
      "https://mirumi.media/voice.mp3",
    ])
    expect(file).toHaveBeenCalledOnce()
    expect(file).toHaveBeenCalledWith(uploaded, "video")
    expect(copyBodyFile).toHaveBeenCalledWith(
      { bytes: new Uint8Array([1, 2, 3]), contentType: "video/mp4" },
      "video",
      uploaded,
      "video-video1",
    )
  })
})

describe("syncAppStoreIcons", () => {
  test("App Store のアイコンを取ってきて、本文画像と同じく mirumi.media に置き直す", async () => {
    const normalizeBodyImage = vi.fn(async () => ({
      fallbackUrl: "https://mirumi.media/0123456789abcdef-app-icon-42-512x512-512w.webp",
      width: 512,
      height: 512,
      animated: false,
    }))
    const downloader = vi.fn(async () => new Uint8Array([1, 2, 3]))
    const ios = "https://apps.apple.com/jp/app/some-app/id42"

    expect(
      await syncAppStoreIcons(
        {
          [ios]: {
            id: "42",
            name: "アプリ",
            developer: "開発元",
            price: "無料",
            artworkUrl: "https://is1-ssl.mzstatic.com/image/thumb/icon/512x512bb.jpg",
          },
        },
        { normalizeBodyImage } as unknown as MediaNormalizer,
        downloader,
      ),
    ).toEqual({
      [ios]: {
        id: "42",
        name: "アプリ",
        developer: "開発元",
        price: "無料",
        artworkUrl: "https://mirumi.media/0123456789abcdef-app-icon-42-512x512-512w.webp",
      },
    })
    expect(downloader).toHaveBeenCalledWith(
      "https://is1-ssl.mzstatic.com/image/thumb/icon/512x512bb.jpg",
    )
    expect(normalizeBodyImage).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
      "app-icon-42.png",
      "app-icon-42",
    )
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

describe("downloadMediaFile", () => {
  test("音声・動画の bytes と Content-Type を返す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "Content-Type": "video/mp4; charset=binary" },
        })
      }),
    )

    expect(await downloadMediaFile("https://file.notion.so/movie.mp4", "video")).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "video/mp4",
    })
  })

  test("block の種類と合わない応答は断る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response("<html></html>", { headers: { "Content-Type": "text/html" } })
      }),
    )

    await expect(downloadMediaFile("https://file.notion.so/movie.mp4", "video")).rejects.toThrow(
      "video 以外の応答が返りました",
    )
  })

  test("上限を超える大きさは、本文を読まずに断る", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Length": String(1_024 * 1_024 * 1_024 + 1),
          },
        })
      }),
    )

    await expect(downloadMediaFile("https://file.notion.so/voice.mp3", "audio")).rejects.toThrow(
      "1 GiB の上限を超えています",
    )
  })
})
