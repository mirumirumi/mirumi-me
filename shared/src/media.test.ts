import { describe, expect, test } from "vitest"

import {
  BODY_IMAGE_SIZES,
  resolveCardImageUrl,
  resolveMediaDimensions,
  resolveResponsiveBodyImage,
  resolveThumbnailUrls,
} from "./media"

describe("body image media", () => {
  test("canonical fallback URL から存在する標準 variant を組み立てる", () => {
    expect(
      resolveResponsiveBodyImage(
        "https://mirumi.media/0123456789abcdef-my-cats-1-1600x900-1600w.webp",
      ),
    ).toEqual({
      fallbackUrl: "https://mirumi.media/0123456789abcdef-my-cats-1-1600x900-1600w.webp",
      fallbackWidth: 1600,
      srcset:
        "https://mirumi.media/0123456789abcdef-my-cats-1-1600x900-800w.webp 800w, https://mirumi.media/0123456789abcdef-my-cats-1-1600x900-1200w.webp 1200w, https://mirumi.media/0123456789abcdef-my-cats-1-1600x900-1600w.webp 1600w",
      sizes: BODY_IMAGE_SIZES,
    })
    expect(
      resolveResponsiveBodyImage(
        "https://mirumi.media/0123456789abcdef-screen-shot-1032x581-1032w.webp",
      )?.srcset,
    ).toEqual(
      "https://mirumi.media/0123456789abcdef-screen-shot-1032x581-800w.webp 800w, https://mirumi.media/0123456789abcdef-screen-shot-1032x581-1032w.webp 1032w",
    )
  })

  test("fallback 以外の variant URL からも画像セット全体を組み立てる", () => {
    expect(
      resolveResponsiveBodyImage(
        "https://mirumi.media/0123456789abcdef-my-cats-1600x900-800w.webp",
      ),
    ).toEqual({
      fallbackUrl: "https://mirumi.media/0123456789abcdef-my-cats-1600x900-1600w.webp",
      fallbackWidth: 1600,
      srcset:
        "https://mirumi.media/0123456789abcdef-my-cats-1600x900-800w.webp 800w, https://mirumi.media/0123456789abcdef-my-cats-1600x900-1200w.webp 1200w, https://mirumi.media/0123456789abcdef-my-cats-1600x900-1600w.webp 1600w",
      sizes: BODY_IMAGE_SIZES,
    })
  })

  test("旧画像と animation と thumbnail は responsive URL と誤認しない", () => {
    expect(resolveResponsiveBodyImage("https://mirumi.media/my-cats-1999x1124.png")).toEqual(null)
    expect(
      resolveResponsiveBodyImage("https://mirumi.media/0123456789abcdef-animation-480x270.gif"),
    ).toEqual(null)
    expect(
      resolveResponsiveBodyImage("https://mirumi.media/0123456789abcdef-cover-1200x630.webp"),
    ).toEqual(null)
    expect(
      resolveResponsiveBodyImage("https://example.com/0123456789abcdef-image-1600x900-1600w.webp"),
    ).toEqual(null)
  })

  test("画像セットの寸法より大きい variant 名は受け付けない", () => {
    expect(
      resolveResponsiveBodyImage(
        "https://mirumi.media/0123456789abcdef-my-cats-800x450-1200w.webp",
      ),
    ).toEqual(null)
  })
})

describe("media dimensions", () => {
  test("本文画像はどの variant の URL からも fallback の寸法を返す", () => {
    expect(
      resolveMediaDimensions("https://mirumi.media/0123456789abcdef-my-cats-1600x900-1600w.webp"),
    ).toEqual({ width: 1600, height: 900 })
    expect(
      resolveMediaDimensions("https://mirumi.media/0123456789abcdef-my-cats-1600x900-800w.webp"),
    ).toEqual({ width: 1600, height: 900 })
  })

  test("animation と thumbnail はファイル名末尾の寸法を返す", () => {
    expect(
      resolveMediaDimensions("https://mirumi.media/0123456789abcdef-dancing-cat-480x270.gif"),
    ).toEqual({ width: 480, height: 270 })
    expect(
      resolveMediaDimensions("https://mirumi.media/0123456789abcdef-cover-1200x630.webp"),
    ).toEqual({ width: 1200, height: 630 })
  })

  test("canonical でない画像は寸法を推測しない", () => {
    // WordPress の中間サイズ名は表示サイズの指定と一致しないことがあるので信用しない
    expect(resolveMediaDimensions("https://mirumi.media/my-cats-1999x1124.png")).toEqual(null)
    expect(resolveMediaDimensions("https://mirumi.media/0123456789abcdef-animation.gif")).toEqual(
      null,
    )
    expect(
      resolveMediaDimensions("https://example.com/0123456789abcdef-image-1600x900-1600w.webp"),
    ).toEqual(null)
  })
})

describe("card image", () => {
  test("thumbnail があればその card を使う", () => {
    expect(
      resolveCardImageUrl(
        { card: "https://mirumi.media/hash-cover-412x216.webp" },
        "https://mirumi.media/0123456789abcdef-generated-1200x630.webp",
      ),
    ).toEqual("https://mirumi.media/hash-cover-412x216.webp")
  })

  test("thumbnail がなければ自動生成 OGP の card variant を使う", () => {
    expect(
      resolveCardImageUrl(null, "https://mirumi.media/0123456789abcdef-generated-1200x630.webp"),
    ).toEqual("https://mirumi.media/0123456789abcdef-generated-412x216.webp")
  })

  test("OGP が canonical でなければ null", () => {
    expect(resolveCardImageUrl(null, "https://mirumi.media/legacy.jpg")).toEqual(null)
  })
})

describe("thumbnail media", () => {
  test("1200x630 の canonical URL から用途別 URL を組み立てる", () => {
    expect(
      resolveThumbnailUrls("https://mirumi.media/0123456789abcdef-cover-image-1200x630.webp"),
    ).toEqual({
      article: "https://mirumi.media/0123456789abcdef-cover-image-1200x630.webp",
      mobile: "https://mirumi.media/0123456789abcdef-cover-image-600x315.webp",
      card: "https://mirumi.media/0123456789abcdef-cover-image-412x216.webp",
    })
  })

  test("canonical thumbnail 以外は受け付けない", () => {
    expect(resolveThumbnailUrls("https://mirumi.media/cover-1200x630.jpg")).toEqual(null)
  })
})
