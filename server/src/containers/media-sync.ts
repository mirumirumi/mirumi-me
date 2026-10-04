import type { AppStoreApp } from "shared/app-store"
import type { ArticleContent, ContentBlock } from "shared/content"
import { isNotionHostedFile, resolveThumbnailUrls } from "shared/media"

import type { ThumbnailUrls } from "../lib/publishing"
import type { DownloadedMediaFile, MediaNormalizer } from "./images"
import { MAX_BODY_FILE_BYTES, MAX_BODY_FILE_LABEL } from "./images"

const MAX_IMAGE_BYTES = 20 * 1_024 * 1_024
const IMAGE_FETCH_TIMEOUT_MS = 15_000
// 動画は数百 MB になりうるので、画像より長く待つ
const MEDIA_FILE_FETCH_TIMEOUT_MS = 5 * 60_000

type ImageDownloader = (url: string) => Promise<Uint8Array>
type MediaFileDownloader = (url: string, kind: "audio" | "video") => Promise<DownloadedMediaFile>
type ThumbnailGenerator = (article: ArticleContent) => Promise<Uint8Array>

export interface MediaDownloaders {
  image: ImageDownloader
  file: MediaFileDownloader
}

export interface SyncedArticleMedia {
  article: ArticleContent
  thumbnailUrls: ThumbnailUrls | null
  ogImageUrl: string
}

// 応答を確かめて、上限まで読む。Content-Type は parameter を落として返す
const readMediaResponse = async (
  response: Response,
  label: string,
  kind: "image" | "audio" | "video",
  maxBytes: number,
  limitLabel: string,
): Promise<DownloadedMediaFile> => {
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw Error(`${label}を取得できませんでした: ${response.status}`)
  }
  const contentType = response.headers.get("Content-Type")?.split(";")[0]?.trim() ?? ""
  if (
    !contentType.startsWith(`${kind}/`) &&
    contentType !== "application/octet-stream" &&
    contentType !== "binary/octet-stream"
  ) {
    await response.body.cancel()
    throw Error(`${label}から ${kind} 以外の応答が返りました`)
  }
  const contentLength = Number(response.headers.get("Content-Length"))
  if (Number.isFinite(contentLength) && maxBytes < contentLength) {
    await response.body.cancel()
    throw Error(`${label}が ${limitLabel} の上限を超えています`)
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
    if (maxBytes < received) {
      await reader.cancel()
      throw Error(`${label}が ${limitLabel} の上限を超えています`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return { bytes, contentType }
}

const readImageResponse = async (response: Response, label: string): Promise<Uint8Array> => {
  const { bytes } = await readMediaResponse(response, label, "image", MAX_IMAGE_BYTES, "20 MiB")

  return bytes
}

export const downloadImage = async (url: string): Promise<Uint8Array> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    redirect: "follow",
  })
  return readImageResponse(response, "画像 URL")
}

export const downloadMediaFile = async (
  url: string,
  kind: "audio" | "video",
): Promise<DownloadedMediaFile> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(MEDIA_FILE_FETCH_TIMEOUT_MS),
    redirect: "follow",
  })

  return readMediaResponse(
    response,
    `Notion にアップロードした ${kind} `,
    kind,
    MAX_BODY_FILE_BYTES,
    MAX_BODY_FILE_LABEL,
  )
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
  downloaders: MediaDownloaders,
  syncedByUrl: Map<string, Promise<string>>,
) => {
  for (const block of blocks) {
    if (block.type === "image" && isNotionHostedFile(block.url)) {
      let normalized = syncedByUrl.get(block.url)
      if (!normalized) {
        normalized = downloaders.image(block.url).then(async (bytes) => {
          const fallbackStem = `image-${block.id.replaceAll("-", "").slice(-12)}`
          const image = await normalizer.normalizeBodyImage(bytes, block.url, fallbackStem)

          return image.fallbackUrl
        })
        syncedByUrl.set(block.url, normalized)
      }
      block.url = await normalized
    } else if (
      (block.type === "audio" || block.type === "video") &&
      isNotionHostedFile(block.url)
    ) {
      // Notion の署名付き URL は 1 時間ほどで切れるので、そのまま HTML に焼き込まず mirumi.media に置く
      const kind = block.type
      const sourceUrl = block.url
      let copied = syncedByUrl.get(sourceUrl)
      if (!copied) {
        copied = downloaders.file(sourceUrl, kind).then((file) => {
          const fallbackStem = `${kind}-${block.id.replaceAll("-", "").slice(-12)}`

          return normalizer.copyBodyFile(file, kind, sourceUrl, fallbackStem)
        })
        syncedByUrl.set(sourceUrl, copied)
      }
      block.url = await copied
    }
    await syncBlocks(block.children, normalizer, downloaders, syncedByUrl)
  }
}

// App Store から引いたアイコンは CDN 直リンクだと将来切れるので、移行した 103 件と同じく mirumi.media に置き直す
export const syncAppStoreIcons = async (
  apps: Readonly<Record<string, AppStoreApp>>,
  normalizer: MediaNormalizer,
  downloader: ImageDownloader,
): Promise<Record<string, AppStoreApp>> => {
  const synced: Record<string, AppStoreApp> = {}
  for (const [ios, app] of Object.entries(apps)) {
    const icon = await normalizer.normalizeBodyImage(
      await downloader(app.artworkUrl),
      `app-icon-${app.id}.png`,
      `app-icon-${app.id}`,
    )
    synced[ios] = { ...app, artworkUrl: icon.fallbackUrl }
  }

  return synced
}

export const syncArticleMedia = async (
  sourceArticle: ArticleContent,
  normalizer: MediaNormalizer,
  downloaders: MediaDownloaders,
  generateThumbnail: ThumbnailGenerator,
  existingOgImageUrl: string | null = null,
): Promise<SyncedArticleMedia> => {
  const article = structuredClone(sourceArticle)
  await syncBlocks(article.blocks, normalizer, downloaders, new Map())

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

  // 判定は「どこにある画像か」ではなく「すでに canonical か」で行う。WordPress から移行した
  // mirumi.media 直下の画像のようにホストだけでは正規化済みか判断できないものがあるため
  let thumbnailUrls: ThumbnailUrls | null
  const canonicalThumbnailUrls = resolveThumbnailUrls(article.thumbnailUrl)
  if (canonicalThumbnailUrls) {
    thumbnailUrls = canonicalThumbnailUrls
  } else {
    thumbnailUrls = await normalizer.normalizeThumbnailImage(
      await downloaders.image(article.thumbnailUrl),
      article.thumbnailName ?? article.thumbnailUrl,
      `thumbnail-${article.id.replaceAll("-", "").slice(-12)}`,
    )
    article.thumbnailUrl = thumbnailUrls.article
  }

  return { article, thumbnailUrls, ogImageUrl: thumbnailUrls.article }
}
