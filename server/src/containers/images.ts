import { createHash } from "node:crypto"
import sharp from "sharp"

import type { ThumbnailUrls } from "../lib/publishing"

const MEDIA_TRANSFORM_VERSION = "v1"
const MEDIA_ORIGIN = "https://mirumi.media"
const MAX_IMAGE_BYTES = 20 * 1_024 * 1_024
const MAX_IMAGE_DIMENSION = 20_000
const MAX_IMAGE_PIXELS = 40_000_000
const BODY_WIDTHS = [800, 1_200, 1_600]
const THUMBNAIL_SIZES = [
  { width: 412, height: 216, name: "card" },
  { width: 600, height: 315, name: "mobile" },
  { width: 1_200, height: 630, name: "article" },
] as const

type MediaUsage = "body" | "thumbnail"

export interface MediaObjectMetadata {
  transformVersion: string
  variantHash: string
  usage: MediaUsage
  width: string
  height: string
}

export interface MediaObject {
  body: Uint8Array
  contentType: string
  metadata: MediaObjectMetadata
}

export interface MediaObjectStore {
  head(key: string): Promise<MediaObjectMetadata | null>
  put(key: string, object: MediaObject): Promise<void>
}

export interface NormalizedBodyImage {
  fallbackUrl: string
  width: number
  animated: boolean
}

const bytesHash = (bytes: Uint8Array): string => {
  return createHash("sha256").update(bytes).digest("hex")
}

const assetHash = (bytes: Uint8Array, usage: MediaUsage): string => {
  return createHash("sha256")
    .update(MEDIA_TRANSFORM_VERSION)
    .update("\0")
    .update(usage)
    .update("\0")
    .update(bytes)
    .digest("hex")
    .slice(0, 16)
}

const filenameFromSource = (value: string): string => {
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "")
  } catch {
    return value
  }
}

export const cleanMediaStem = (source: string, fallback: string): string => {
  const filename = filenameFromSource(source)
  const withoutExtension = filename.replace(/\.[a-z0-9]{1,8}$/i, "")
  const withoutDimensions = withoutExtension.replace(/-\d+x\d+$/i, "")
  const stem = withoutDimensions
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^a-z0-9\p{L}\p{N}-]+/gu, "-")
    .replaceAll(/-{2,}/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 80)

  return stem || fallback
}

const publicMediaUrl = (key: string): string => {
  return `${MEDIA_ORIGIN}/${encodeURIComponent(key)}`
}

export const resolvePreservedImageFormat = (
  format: string,
  compression?: string,
): { extension: string; contentType: string } => {
  if (format === "jpg") {
    return { extension: "jpg", contentType: "image/jpeg" }
  }
  if (format === "jpeg") {
    return { extension: "jpg", contentType: "image/jpeg" }
  }
  if (format === "heif") {
    return compression === "av1"
      ? { extension: "avif", contentType: "image/avif" }
      : { extension: "heic", contentType: "image/heic" }
  }

  return { extension: format, contentType: `image/${format}` }
}

const validateSource = async (bytes: Uint8Array) => {
  if (MAX_IMAGE_BYTES < bytes.byteLength) {
    throw Error("画像が 20 MiB の上限を超えています")
  }

  const image = sharp(bytes, {
    animated: true,
    failOn: "warning",
    // animation は byte-for-byte で保存し decode しない。ここの metadata 取得で
    // 全 frame の合計 pixel 数を上限にすると、小さい長尺 GIF まで誤って拒否してしまう
    limitInputPixels: false,
  })
  const metadata = await image.metadata()
  const width = metadata.autoOrient?.width ?? metadata.width
  const height = metadata.pageHeight ?? metadata.autoOrient?.height ?? metadata.height
  if (!metadata.format || !width || !height) {
    throw Error("画像形式または寸法を取得できません")
  }
  if (MAX_IMAGE_DIMENSION < width || MAX_IMAGE_DIMENSION < height) {
    throw Error("画像の縦横寸法が上限を超えています")
  }
  if (MAX_IMAGE_PIXELS < width * height) {
    throw Error("画像の pixel 数が上限を超えています")
  }

  return {
    format: metadata.format,
    compression: metadata.compression,
    width,
    height,
    animated: 1 < (metadata.pages ?? 1),
  }
}

const metadataMatches = (current: MediaObjectMetadata, expected: MediaObjectMetadata): boolean => {
  return (
    current.transformVersion === expected.transformVersion &&
    current.variantHash === expected.variantHash &&
    current.usage === expected.usage &&
    current.width === expected.width &&
    current.height === expected.height
  )
}

export class MediaNormalizer {
  readonly #store: MediaObjectStore

  constructor(store: MediaObjectStore) {
    this.#store = store
  }

  async normalizeBodyImage(
    bytes: Uint8Array,
    sourceUrl: string,
    fallbackStem: string,
  ): Promise<NormalizedBodyImage> {
    const source = await validateSource(bytes)
    const hash = assetHash(bytes, "body")
    const stem = cleanMediaStem(sourceUrl, fallbackStem)
    if (source.animated) {
      const { extension, contentType } = resolvePreservedImageFormat(
        source.format,
        source.compression,
      )
      const key = `${hash}-${stem}.${extension}`
      await this.#saveVariant(key, bytes, contentType, "body", {
        width: source.width,
        height: source.height,
      })

      return { fallbackUrl: publicMediaUrl(key), width: source.width, animated: true }
    }

    const maximumWidth = Math.min(source.width, BODY_WIDTHS.at(-1)!)
    const widths = [...BODY_WIDTHS.filter((width) => width < maximumWidth), maximumWidth]
    let fallbackUrl = ""
    for (const width of widths) {
      const output = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80, effort: 6, smartSubsample: true })
        .toBuffer()
      const outputMetadata = await sharp(output).metadata()
      const actualWidth = outputMetadata.width
      const actualHeight = outputMetadata.height
      if (!actualWidth || !actualHeight) {
        throw Error("変換後の本文画像の寸法を取得できません")
      }
      const key = `${hash}-${stem}-${actualWidth}w.webp`
      await this.#saveVariant(key, output, "image/webp", "body", {
        width: actualWidth,
        height: actualHeight,
      })
      fallbackUrl = publicMediaUrl(key)
    }

    return { fallbackUrl, width: maximumWidth, animated: false }
  }

  async normalizeThumbnailImage(
    bytes: Uint8Array,
    sourceUrl: string,
    fallbackStem: string,
  ): Promise<ThumbnailUrls> {
    const source = await validateSource(bytes)
    if (source.animated) {
      throw Error("animation は thumbnail に指定できません")
    }

    const hash = assetHash(bytes, "thumbnail")
    const stem = cleanMediaStem(sourceUrl, fallbackStem)
    const urls: Partial<ThumbnailUrls> = {}
    for (const size of THUMBNAIL_SIZES) {
      const output = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate()
        .resize({ width: size.width, height: size.height, fit: "cover" })
        .webp({ quality: 80, effort: 6, smartSubsample: true })
        .toBuffer()
      const key = `${hash}-${stem}-${size.width}x${size.height}.webp`
      await this.#saveVariant(key, output, "image/webp", "thumbnail", size)
      urls[size.name] = publicMediaUrl(key)
    }

    return urls as ThumbnailUrls
  }

  async #saveVariant(
    key: string,
    body: Uint8Array,
    contentType: string,
    usage: MediaUsage,
    dimensions: { width: number; height: number },
  ) {
    const metadata: MediaObjectMetadata = {
      transformVersion: MEDIA_TRANSFORM_VERSION,
      variantHash: bytesHash(body),
      usage,
      width: String(dimensions.width),
      height: String(dimensions.height),
    }
    const current = await this.#store.head(key)
    if (current) {
      if (!metadataMatches(current, metadata)) {
        throw Error(`immutable media object の metadata が一致しません: ${key}`)
      }

      return
    }

    await this.#store.put(key, { body, contentType, metadata })
  }
}
