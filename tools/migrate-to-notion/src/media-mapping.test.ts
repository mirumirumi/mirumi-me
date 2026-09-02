import { describe, expect, test } from "vitest"

import { createMediaMigrationResolver, normalizeMediaSourceUrl } from "./media-mapping"

describe("media mapping", () => {
  test("WordPress upload URL を mirumi.media の正規 URL にする", () => {
    expect(
      normalizeMediaSourceUrl(
        "http://www.milmemo.net/wp-content/uploads/2024/01/my-image-1999x1124.png?ver=1#x",
      ),
    ).toEqual("https://mirumi.media/2024/01/my-image-1999x1124.png")
  })

  test("用途ごとの canonical URL を解決する", () => {
    const resolver = createMediaMigrationResolver({
      schemaVersion: 1,
      generatedAt: "2026-08-24T00:00:00.000Z",
      entries: [
        {
          sourceUrl: "https://mirumi.media/my-image-1999x1124.png",
          usage: "body",
          kind: "responsive",
          fallbackUrl: "https://mirumi.media/0123456789abcdef-my-image-1600w.webp",
          sourceWidth: 1_999,
        },
        {
          sourceUrl: "https://mirumi.media/my-image-1999x1124.png",
          usage: "thumbnail",
          kind: "responsive",
          fallbackUrl: "https://mirumi.media/abcdef0123456789-my-image-1200x630.webp",
          sourceWidth: 1_999,
        },
      ],
    })

    expect(resolver.resolve("https://mirumi.media/my-image-1999x1124.png", "body")).toEqual(
      "https://mirumi.media/0123456789abcdef-my-image-1600w.webp",
    )
    expect(resolver.resolve("https://example.com/external.png", "body")).toEqual(
      "https://example.com/external.png",
    )
    expect(() => resolver.resolve("https://mirumi.media/not-in-mapping.png", "body")).toThrow(
      "media mapping にありません",
    )
  })

  test("同じ URL と用途の重複を拒否する", () => {
    const entry = {
      sourceUrl: "https://mirumi.media/image.png",
      usage: "body" as const,
      kind: "passthrough" as const,
      fallbackUrl: "https://mirumi.media/image.png",
      sourceWidth: 800,
    }

    expect(() =>
      createMediaMigrationResolver({
        schemaVersion: 1,
        generatedAt: "2026-08-24T00:00:00.000Z",
        entries: [entry, entry],
      }),
    ).toThrow("media mapping が重複しています")
  })
})
