import { describe, expect, test } from "vitest"

import type { ArticleContent } from "shared/content"

import {
  createArticleSourceHash,
  createFetchedArticleHash,
  isNotionHostedImage,
} from "./article-hash"

describe("isNotionHostedImage", () => {
  test("Notion の一時 URL だけを識別する", () => {
    expect(
      isNotionHostedImage(
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/path/image.png?signature=x",
      ),
    ).toEqual(true)
    // ワークスペースのデータ保管リージョンによってバケットが変わる（mirumi.me は東京）
    expect(
      isNotionHostedImage(
        "https://prod-files-secure-apne1.s3.ap-northeast-1.amazonaws.com/space/file/image.png?X-Amz-Signature=x",
      ),
    ).toEqual(true)
    expect(isNotionHostedImage("https://file.notion.so/image.png")).toEqual(true)
    expect(isNotionHostedImage("https://mirumi.media/image.png")).toEqual(false)
    expect(
      isNotionHostedImage("https://other-bucket.s3.ap-northeast-1.amazonaws.com/a.png"),
    ).toEqual(false)
    expect(isNotionHostedImage("https://example.com/image.png")).toEqual(false)
  })
})

describe("createArticleSourceHash", () => {
  const article: ArticleContent = {
    id: "00000000-0000-0000-0000-000000000001",
    title: "記事",
    slug: "article",
    thumbnailUrl: "https://mirumi.media/hash-cover-1200x630.webp",
    thumbnailName: "cover.png",
    publishedAt: "2026-08-24T01:00:00.000Z",
    updatedAt: null,
    category: { name: "技術", slug: "tech" },
    customCss: "",
    toc: { hidden: false, closed: false },
    blocks: [
      {
        id: "00000000-0000-0000-0000-000000000010",
        type: "video",
        url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/clip.mp4?X-Amz-Signature=aaa&X-Amz-Expires=3600",
        caption: [],
        children: [],
      },
      {
        id: "00000000-0000-0000-0000-000000000011",
        type: "embed",
        url: "https://www.youtube.com/watch?v=abc",
        caption: [],
        children: [],
      },
    ],
  }

  test("公開日と更新日を変えてもハッシュは変わらない", () => {
    const base = createArticleSourceHash(article)
    expect(
      createArticleSourceHash({ ...article, publishedAt: "2020-01-01T00:00:00.000Z" }),
    ).toEqual(base)
    expect(createArticleSourceHash({ ...article, updatedAt: "2026-09-01T00:00:00.000Z" })).toEqual(
      base,
    )
  })

  test("本文や title が変わればハッシュも変わる", () => {
    const base = createArticleSourceHash(article)
    expect(createArticleSourceHash({ ...article, title: "別の題" })).not.toEqual(base)
    expect(createArticleSourceHash({ ...article, blocks: article.blocks.slice(1) })).not.toEqual(
      base,
    )
  })

  test("Notion ホストの署名付き URL は署名が変わってもハッシュは変わらない", () => {
    const base = createArticleSourceHash(article)
    const resigned = {
      ...article,
      blocks: [
        {
          ...article.blocks[0]!,
          url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/clip.mp4?X-Amz-Signature=bbb&X-Amz-Expires=3600",
        },
        article.blocks[1]!,
      ],
    }
    expect(createArticleSourceHash(resigned)).toEqual(base)
  })

  test("外部 URL のクエリは意味を持つのでハッシュに含める", () => {
    const base = createArticleSourceHash(article)
    const other = {
      ...article,
      blocks: [
        article.blocks[0]!,
        { ...article.blocks[1]!, url: "https://www.youtube.com/watch?v=def" },
      ],
    }
    expect(createArticleSourceHash(other)).not.toEqual(base)
  })
})

describe("createFetchedArticleHash", () => {
  const article: ArticleContent = {
    id: "00000000-0000-0000-0000-000000000001",
    title: "記事",
    slug: "article",
    thumbnailUrl:
      "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/cover.png?X-Amz-Signature=aaa",
    thumbnailName: "cover.png",
    publishedAt: "2026-08-24T01:00:00.000Z",
    updatedAt: null,
    category: { name: "技術", slug: "tech" },
    customCss: "",
    toc: { hidden: false, closed: false },
    blocks: [
      {
        id: "00000000-0000-0000-0000-000000000010",
        type: "image",
        url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/body.png?X-Amz-Signature=aaa",
        caption: [],
        children: [],
      },
    ],
  }

  test("取り直して署名だけが変わっても同じになる", () => {
    const resigned: ArticleContent = {
      ...article,
      thumbnailUrl:
        "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/cover.png?X-Amz-Signature=bbb",
      blocks: [
        {
          ...article.blocks[0]!,
          url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/ws/file/body.png?X-Amz-Signature=bbb",
        } as ArticleContent["blocks"][number],
      ],
    }
    expect(createFetchedArticleHash(resigned)).toEqual(createFetchedArticleHash(article))
  })

  test("本文だけでなく、公開日や更新日を直しても変わる", () => {
    const base = createFetchedArticleHash(article)
    expect(createFetchedArticleHash({ ...article, blocks: [] })).not.toEqual(base)
    expect(
      createFetchedArticleHash({ ...article, publishedAt: "2026-08-25T01:00:00.000Z" }),
    ).not.toEqual(base)
    expect(
      createFetchedArticleHash({ ...article, updatedAt: "2026-08-25T01:00:00.000Z" }),
    ).not.toEqual(base)
  })
})
