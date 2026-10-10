import sharp from "sharp"
import { describe, expect, test } from "vitest"

import type { MediaObject, MediaObjectMetadata, MediaObjectStore } from "./images"
import { cleanMediaStem, MediaNormalizer, resolvePreservedImageFormat } from "./images"

describe("MediaNormalizer", () => {
  class MemoryMediaStore implements MediaObjectStore {
    objects = new Map<string, MediaObject>()
    puts: Array<string> = []

    async head(key: string): Promise<MediaObjectMetadata | null> {
      return this.objects.get(key)?.metadata ?? null
    }

    async put(key: string, object: MediaObject): Promise<void> {
      this.puts.push(key)
      this.objects.set(key, object)
    }
  }

  const createImage = async (width: number, height: number): Promise<Uint8Array> => {
    return sharp({
      create: { width, height, channels: 3, background: "#8ab4f8" },
    })
      .png()
      .toBuffer()
  }

  const createAnimation = async (width: number, height: number): Promise<Uint8Array> => {
    const frames = await Promise.all(
      ["#8ab4f8", "#f28b82"].map((background) => {
        return sharp({ create: { width, height, channels: 3, background } })
          .png()
          .toBuffer()
      }),
    )

    return sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer()
  }

  test("本文画像を拡大せず標準幅と元幅の WebP にする", async () => {
    const store = new MemoryMediaStore()
    const normalizer = new MediaNormalizer(store)
    const result = await normalizer.normalizeBodyImage(
      await createImage(1_000, 500),
      "https://prod-files-secure.s3.us-west-2.amazonaws.com/path/My%20Cats-1999x1124.png",
      "image-block",
    )

    expect(result.animated).toEqual(false)
    expect(result.width).toEqual(1_000)
    expect(result.height).toEqual(500)
    // 画像セットの寸法を全 variant の key に持たせ、renderer が width / height を復元できるようにする
    expect(result.fallbackUrl).toMatch(
      /^https:\/\/mirumi\.media\/[a-f0-9]{16}-my-cats-1000x500-1000w\.webp$/,
    )
    expect(store.puts.map((key) => key.replace(/^[a-f0-9]{16}-/, ""))).toEqual([
      "my-cats-1000x500-800w.webp",
      "my-cats-1000x500-1000w.webp",
    ])
    expect([...store.objects.values()].map(({ metadata }) => metadata)).toEqual([
      expect.objectContaining({ width: "800", height: "400", usage: "body" }),
      expect.objectContaining({ width: "1000", height: "500", usage: "body" }),
    ])
  })

  test("1600 px を超える本文画像は 1600 px の寸法を画像セットの寸法にする", async () => {
    const store = new MemoryMediaStore()
    const result = await new MediaNormalizer(store).normalizeBodyImage(
      await createImage(2_000, 1_000),
      "https://file.notion.so/wide.png",
      "image-block",
    )

    expect(result.width).toEqual(1_600)
    expect(result.height).toEqual(800)
    expect(store.puts.map((key) => key.replace(/^[a-f0-9]{16}-/, ""))).toEqual([
      "wide-1600x800-800w.webp",
      "wide-1600x800-1200w.webp",
      "wide-1600x800-1600w.webp",
    ])
  })

  test("本文 animation は元 bytes のまま 1 frame の寸法を key に持たせる", async () => {
    const store = new MemoryMediaStore()
    const source = await createAnimation(48, 32)
    const result = await new MediaNormalizer(store).normalizeBodyImage(
      source,
      "https://file.notion.so/Dancing%20Cat.gif",
      "image-block",
    )

    expect(result).toEqual({
      fallbackUrl: expect.stringMatching(
        /^https:\/\/mirumi\.media\/[a-f0-9]{16}-dancing-cat-48x32\.gif$/,
      ),
      width: 48,
      height: 32,
      animated: true,
    })
    expect([...store.objects.values()]).toEqual([
      expect.objectContaining({ body: source, contentType: "image/gif" }),
    ])
  })

  test("同じ immutable variant があれば PUT を省略する", async () => {
    const store = new MemoryMediaStore()
    const normalizer = new MediaNormalizer(store)
    const source = await createImage(700, 350)

    await normalizer.normalizeBodyImage(source, "https://file.notion.so/image.png", "block")
    await normalizer.normalizeBodyImage(source, "https://file.notion.so/image.png", "block")

    expect(store.puts).toHaveLength(1)
  })

  test("thumbnail を固定 3 サイズへ cover 変換する", async () => {
    const store = new MemoryMediaStore()
    const result = await new MediaNormalizer(store).normalizeThumbnailImage(
      await createImage(1_600, 900),
      "https://file.notion.so/Cover.png",
      "thumbnail",
    )

    expect(result).toEqual({
      article: expect.stringMatching(/-cover-1200x630\.webp$/),
      mobile: expect.stringMatching(/-cover-600x315\.webp$/),
      card: expect.stringMatching(/-cover-412x216\.webp$/),
    })
    expect([...store.objects.values()].map(({ metadata }) => metadata)).toEqual([
      expect.objectContaining({ width: "412", height: "216", usage: "thumbnail" }),
      expect.objectContaining({ width: "600", height: "315", usage: "thumbnail" }),
      expect.objectContaining({ width: "1200", height: "630", usage: "thumbnail" }),
    ])
  })

  test("Notion にアップロードした音声・動画は、元 bytes のまま拡張子と Content-Type を保って置く", async () => {
    const store = new MemoryMediaStore()
    const bytes = new Uint8Array([1, 2, 3])
    const url = await new MediaNormalizer(store).copyBodyFile(
      { bytes, contentType: "video/mp4" },
      "video",
      "https://prod-files-secure.s3.us-west-2.amazonaws.com/space/file/My%20Movie.MP4?X-Amz-Signature=x",
      "video-block",
    )

    expect(url).toMatch(/^https:\/\/mirumi\.media\/[a-f0-9]{16}-my-movie\.mp4$/)
    expect([...store.objects.values()]).toEqual([
      {
        body: bytes,
        contentType: "video/mp4",
        metadata: expect.objectContaining({ usage: "video", width: "0", height: "0" }),
      },
    ])
  })

  test("octet-stream で返った音声・動画は、拡張子から Content-Type を決める", async () => {
    const store = new MemoryMediaStore()
    const url = await new MediaNormalizer(store).copyBodyFile(
      { bytes: new Uint8Array([1, 2, 3]), contentType: "application/octet-stream" },
      "audio",
      "https://file.notion.so/voice.m4a",
      "audio-block",
    )

    expect(url).toMatch(/-voice\.m4a$/)
    expect([...store.objects.values()].map((object) => object.contentType)).toEqual(["audio/mp4"])
  })

  test("拡張子のない音声・動画は、Content-Type から拡張子を決める", async () => {
    const store = new MemoryMediaStore()
    const url = await new MediaNormalizer(store).copyBodyFile(
      { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" },
      "audio",
      "https://file.notion.so/download",
      "audio-block",
    )

    expect(url).toMatch(/^https:\/\/mirumi\.media\/[a-f0-9]{16}-download\.mp3$/)
  })

  test("同じ音声・動画がすでにあれば PUT を省略する", async () => {
    const store = new MemoryMediaStore()
    const normalizer = new MediaNormalizer(store)
    const file = { bytes: new Uint8Array([1, 2, 3]), contentType: "video/webm" }

    await normalizer.copyBodyFile(file, "video", "https://file.notion.so/clip.webm", "block")
    await normalizer.copyBodyFile(file, "video", "https://file.notion.so/clip.webm", "block")

    expect(store.puts).toHaveLength(1)
  })
})

describe("cleanMediaStem", () => {
  test("元 filename を読みやすい安全な stem にする", () => {
    expect(
      cleanMediaStem(
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/path/My%20Cats-1999x1124.png?x=1",
        "image-block",
      ),
    ).toEqual("my-cats")
    expect(cleanMediaStem("My Cover.png", "thumbnail")).toEqual("my-cover")
    expect(cleanMediaStem("https://file.notion.so/", "image-abcd")).toEqual("image-abcd")
  })
})

describe("resolvePreservedImageFormat", () => {
  test("Sharp の HEIF metadata から AVIF と HEIC を区別する", () => {
    expect(resolvePreservedImageFormat("heif", "av1")).toEqual({
      extension: "avif",
      contentType: "image/avif",
    })
    expect(resolvePreservedImageFormat("heif", "hevc")).toEqual({
      extension: "heic",
      contentType: "image/heic",
    })
    expect(resolvePreservedImageFormat("jpeg")).toEqual({
      extension: "jpg",
      contentType: "image/jpeg",
    })
  })
})
