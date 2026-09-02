import { describe, expect, test } from "vitest"

import { BODY_IMAGE_SIZES, resolveResponsiveBodyImage, resolveThumbnailUrls } from "./media"

describe("body image media", () => {
  test("canonical fallback URL から存在する標準 variant を組み立てる", () => {
    expect(
      resolveResponsiveBodyImage("https://mirumi.media/0123456789abcdef-my-cats-1-1600w.webp"),
    ).toEqual({
      fallbackUrl: "https://mirumi.media/0123456789abcdef-my-cats-1-1600w.webp",
      fallbackWidth: 1600,
      srcset:
        "https://mirumi.media/0123456789abcdef-my-cats-1-800w.webp 800w, https://mirumi.media/0123456789abcdef-my-cats-1-1200w.webp 1200w, https://mirumi.media/0123456789abcdef-my-cats-1-1600w.webp 1600w",
      sizes: BODY_IMAGE_SIZES,
    })
    expect(
      resolveResponsiveBodyImage("https://mirumi.media/0123456789abcdef-screen-shot-1032w.webp")
        ?.srcset,
    ).toEqual(
      "https://mirumi.media/0123456789abcdef-screen-shot-800w.webp 800w, https://mirumi.media/0123456789abcdef-screen-shot-1032w.webp 1032w",
    )
  })

  test("旧画像と animation は responsive URL と誤認しない", () => {
    expect(resolveResponsiveBodyImage("https://mirumi.media/my-cats-1999x1124.png")).toEqual(null)
    expect(resolveResponsiveBodyImage("https://mirumi.media/hash-animation.gif")).toEqual(null)
    expect(resolveResponsiveBodyImage("https://example.com/hash-image-1600w.webp")).toEqual(null)
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
