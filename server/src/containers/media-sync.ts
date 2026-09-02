import type { ArticleContent, ContentBlock } from "shared/content"
import { resolveThumbnailUrls } from "shared/media"

import type { ThumbnailUrls } from "../lib/publishing"
import type { MediaNormalizer } from "./images"

const MAX_IMAGE_BYTES = 20 * 1_024 * 1_024
const IMAGE_FETCH_TIMEOUT_MS = 15_000

type ImageDownloader = (url: string) => Promise<Uint8Array>
type ThumbnailGenerator = (article: ArticleContent) => Promise<Uint8Array>

export interface SyncedArticleMedia {
  article: ArticleContent
  thumbnailUrls: ThumbnailUrls | null
  ogImageUrl: string
}

export const isNotionHostedImage = (value: string): boolean => {
  try {
    const { hostname } = new URL(value)

    return (
      hostname === "file.notion.so" ||
      hostname.endsWith(".notionusercontent.com") ||
      hostname === "prod-files-secure.s3.us-west-2.amazonaws.com"
    )
  } catch {
    return false
  }
}

const readImageResponse = async (response: Response, label: string): Promise<Uint8Array> => {
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw Error(`${label}を取得できませんでした: ${response.status}`)
  }
  const contentType = response.headers.get("Content-Type")?.split(";")[0]?.trim() ?? ""
  if (
    !contentType.startsWith("image/") &&
    contentType !== "application/octet-stream" &&
    contentType !== "binary/octet-stream"
  ) {
    await response.body.cancel()
    throw Error(`${label}から image 以外の応答が返りました`)
  }
  const contentLength = Number(response.headers.get("Content-Length"))
  if (Number.isFinite(contentLength) && MAX_IMAGE_BYTES < contentLength) {
    await response.body.cancel()
    throw Error(`${label}が 20 MiB の上限を超えています`)
  }

  const reader = response.body.getReader()
  const chunks: Array<Uint8Array> = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    received += value.byteLength
    if (MAX_IMAGE_BYTES < received) {
      await reader.cancel()
      throw Error(`${label}が 20 MiB の上限を超えています`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

export const downloadImage = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    redirect: "follow",
  })
  return readImageResponse(response, "画像 URL")
}

export const createThumbnailGenerator = (functionUrl: string): ThumbnailGenerator => {
  return async (article) => {
    const response = await fetch(functionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: article.title, slug: article.slug }),
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    })
    return readImageResponse(response, "自動 thumbnail")
  }
}

const syncBlocks = async (
  blocks: Array<ContentBlock>,
  normalizer: MediaNormalizer,
  downloader: ImageDownloader,
  normalizedByUrl: Map<string, Promise<string>>,
) => {
  for (const block of blocks) {
    if (block.type === "image" && isNotionHostedImage(block.url)) {
      let normalized = normalizedByUrl.get(block.url)
      if (!normalized) {
        normalized = downloader(block.url).then(async (bytes) => {
          const fallbackStem = `image-${block.id.replaceAll("-", "").slice(-12)}`
          const image = await normalizer.normalizeBodyImage(bytes, block.url, fallbackStem)

          return image.fallbackUrl
        })
        normalizedByUrl.set(block.url, normalized)
      }
      block.url = await normalized
    }
    await syncBlocks(block.children, normalizer, downloader, normalizedByUrl)
  }
}

export const syncArticleMedia = async (
  sourceArticle: ArticleContent,
  normalizer: MediaNormalizer,
  downloader: ImageDownloader,
  generateThumbnail: ThumbnailGenerator,
  existingOgImageUrl: string | null = null,
): Promise<SyncedArticleMedia> => {
  const article = structuredClone(sourceArticle)
  await syncBlocks(article.blocks, normalizer, downloader, new Map())

  if (!article.thumbnailUrl) {
    if (existingOgImageUrl) {
      return { article, thumbnailUrls: null, ogImageUrl: existingOgImageUrl }
    }
    const generated = await generateThumbnail(article)
    const generatedUrls = await normalizer.normalizeThumbnailImage(
      generated,
      `https://generated.invalid/${encodeURIComponent(article.slug)}.png`,
      `thumbnail-${article.id.replaceAll("-", "").slice(-12)}`,
    )

    return { article, thumbnailUrls: null, ogImageUrl: generatedUrls.article }
  }

  let thumbnailUrls: ThumbnailUrls | null
  if (isNotionHostedImage(article.thumbnailUrl)) {
    thumbnailUrls = await normalizer.normalizeThumbnailImage(
      await downloader(article.thumbnailUrl),
      article.thumbnailName ?? article.thumbnailUrl,
      `thumbnail-${article.id.replaceAll("-", "").slice(-12)}`,
    )
    article.thumbnailUrl = thumbnailUrls.article
  } else {
    thumbnailUrls = resolveThumbnailUrls(article.thumbnailUrl)
    if (!thumbnailUrls) {
      throw Error("thumbnail が canonical media URL ではありません")
    }
  }

  return { article, thumbnailUrls, ogImageUrl: thumbnailUrls.article }
}
