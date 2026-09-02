import { describe, expect, test } from "vitest"

import {
  collectMediaReferences,
  createAttachmentIndex,
  createSourceCandidates,
} from "./normalize-media-core"
import type { WordPressAttachmentRecord, WordPressContentRecord } from "./types"

describe("media normalization core", () => {
  const record: WordPressContentRecord = {
    id: 1,
    postType: "post",
    postDate: "2024-01-01 00:00:00",
    postModified: "2024-01-01 00:00:00",
    slug: "article",
    title: "記事",
    excerpt: "",
    content:
      '<p><img src="https://mirumi.in/wp-content/uploads/2024/01/photo-1999x1124.png"></p>' +
      '<p>前[image name="inline.png" align="center"]後</p>' +
      '<img src="https://tracker.example/pixel.gif" width="1" height="1">',
    categories: [],
    thumbnailUrl: "https://mirumi.media/thumb.jpg",
    showThumbnailOnFrontend: true,
    tocHidden: false,
    tocClosed: false,
  }

  test("変換対象の本文画像と thumbnail だけを用途付きで集める", () => {
    expect(collectMediaReferences([record])).toEqual([
      { sourceUrl: "https://mirumi.media/2024/01/photo-1999x1124.png", usage: "body" },
      { sourceUrl: "https://mirumi.media/inline.png", usage: "body" },
      { sourceUrl: "https://mirumi.media/thumb.jpg", usage: "thumbnail" },
    ])
  })

  test("attachment metadata の元画像を最優先の入力候補にする", () => {
    const attachment: WordPressAttachmentRecord = {
      id: 10,
      mimeType: "image/png",
      originalUrl: "https://mirumi.media/2024/01/photo.png",
      sourceUrls: [
        "https://mirumi.media/2024/01/photo.png",
        "https://mirumi.media/2024/01/photo-1999x1124.png",
      ],
    }
    const index = createAttachmentIndex([attachment])

    expect(
      createSourceCandidates("https://mirumi.media/2024/01/photo-1999x1124.png", index),
    ).toEqual([
      "https://mirumi.media/2024/01/photo.png",
      "https://mirumi.media/2024/01/photo-1999x1124.png",
    ])
  })

  test("metadata がないときだけ寸法 suffix を落とした候補を先に試す", () => {
    expect(
      createSourceCandidates(
        "https://mirumi.media/2024/01/photo-1999x1124.png",
        createAttachmentIndex([]),
      ),
    ).toEqual([
      "https://mirumi.media/2024/01/photo.png",
      "https://mirumi.media/2024/01/photo-1999x1124.png",
    ])
  })

  test("attachment alias が別 attachment と衝突したら拒否する", () => {
    const sourceUrls = ["https://mirumi.media/same.png"]
    const makeAttachment = (id: number): WordPressAttachmentRecord => {
      return {
        id,
        mimeType: "image/png",
        originalUrl: `https://mirumi.media/${id}.png`,
        sourceUrls,
      }
    }

    expect(() => createAttachmentIndex([makeAttachment(1), makeAttachment(2)])).toThrow(
      "attachment URL が衝突しています",
    )
  })
})
