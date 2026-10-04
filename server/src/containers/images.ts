import { createHash } from "node:crypto"
import sharp from "sharp"

import type { ThumbnailUrls } from "../lib/publishing"

const MEDIA_TRANSFORM_VERSION = "v2"
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

// audio / video は Notion にアップロードしたものを変換せずに置く（寸法は持たない）
export type MediaUsage = "body" | "thumbnail" | "audio" | "video"

// 本文の audio / video の上限。key に中身の hash を入れる（content-addressed）ため、いったんメモリに全部読んでから置く。
// 読みながら連結するあいだはファイルの約 2 倍を使うので、Container（standard-3、メモリ 8 GiB 程度）で Nuxt generate の分を
// 残せる大きさにしている。Notion の上限（有料プランで 1 ファイル 5 GB。S3 の 1 回の PUT も 5 GB まで）まで上げたくなったら、
// メモリに載せず Notion から読みながら S3 へ流す作りに変える。key を中身の hash ではなく Notion のファイルの path
// （同じアップロードなら変わらない）から作れば、読む前に key が決まり、一度置いたあとは存在の確認だけで済む
// （L2 `Notion 公開基盤の設計.md` の「Notion にアップロードした audio / video」）
export const MAX_BODY_FILE_BYTES = 1_024 * 1_024 * 1_024
export const MAX_BODY_FILE_LABEL = "1 GiB"

// Notion が octet-stream で返したときと、拡張子のない URL のときに使う。同じ Content-Type は先のものを拡張子にする
const BODY_FILE_TYPES: Array<{ extension: string; contentType: string }> = [
  { extension: "mp4", contentType: "video/mp4" },
  { extension: "m4v", contentType: "video/mp4" },
  { extension: "mov", contentType: "video/quicktime" },
  { extension: "webm", contentType: "video/webm" },
  { extension: "mp3", contentType: "audio/mpeg" },
  { extension: "m4a", contentType: "audio/mp4" },
  { extension: "wav", contentType: "audio/wav" },
  { extension: "ogg", contentType: "audio/ogg" },
  { extension: "aac", contentType: "audio/aac" },
  { extension: "flac", contentType: "audio/flac" },
]

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

export interface DownloadedMediaFile {
  bytes: Uint8Array
  contentType: string
}

export interface NormalizedBodyImage {
  fallbackUrl: string
  width: number
  height: number
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

const isOctetStream = (contentType: string): boolean => {
  return contentType === "application/octet-stream" || contentType === "binary/octet-stream"
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
      const key = `${hash}-${stem}-${source.width}x${source.height}.${extension}`
      await this.#saveVariant(key, bytes, contentType, "body", {
        width: source.width,
        height: source.height,
      })

      return {
        fallbackUrl: publicMediaUrl(key),
        width: source.width,
        height: source.height,
        animated: true,
      }
    }

    const maximumWidth = Math.min(source.width, BODY_WIDTHS.at(-1)!)
    const widths = [...BODY_WIDTHS.filter((width) => width < maximumWidth), maximumWidth]
    // key に画像セットの寸法（fallback の実寸）を入れるため、先に全 variant を作ってから保存する
    const variants: Array<{ output: Uint8Array; width: number; height: number }> = []
    for (const width of widths) {
      const output = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80, effort: 6, smartSubsample: true })
        .toBuffer()
      const outputMetadata = await sharp(output).metadata()
      if (!outputMetadata.width || !outputMetadata.height) {
        throw Error("変換後の本文画像の寸法を取得できません")
      }
      variants.push({ output, width: outputMetadata.width, height: outputMetadata.height })
    }

    const fallback = variants.at(-1)!
    const prefix = `${hash}-${stem}-${fallback.width}x${fallback.height}`
    for (const variant of variants) {
      await this.#saveVariant(
        `${prefix}-${variant.width}w.webp`,
        variant.output,
        "image/webp",
        "body",
        {
          width: variant.width,
          height: variant.height,
        },
      )
    }

    return {
      fallbackUrl: publicMediaUrl(`${prefix}-${fallback.width}w.webp`),
      width: fallback.width,
      height: fallback.height,
      animated: false,
    }
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

  // Notion にアップロードした audio / video は、画像の animation と同じく変換せず元 bytes のまま置く
  async copyBodyFile(
    file: DownloadedMediaFile,
    kind: "audio" | "video",
    sourceUrl: string,
    fallbackStem: string,
  ): Promise<string> {
    if (MAX_BODY_FILE_BYTES < file.bytes.byteLength) {
      throw Error(`${kind} が ${MAX_BODY_FILE_LABEL} の上限を超えています`)
    }
    const sourceExtension =
      filenameFromSource(sourceUrl)
        .match(/\.([a-z0-9]{1,8})$/i)?.[1]
        ?.toLowerCase() ?? null
    const contentType = isOctetStream(file.contentType)
      ? (BODY_FILE_TYPES.find((type) => type.extension === sourceExtension)?.contentType ??
        file.contentType)
      : file.contentType
    const extension =
      sourceExtension ??
      BODY_FILE_TYPES.find((type) => type.contentType === contentType)?.extension ??
      "bin"
    const key = `${assetHash(file.bytes, kind)}-${cleanMediaStem(sourceUrl, fallbackStem)}.${extension}`
    await this.#saveVariant(key, file.bytes, contentType, kind, { width: 0, height: 0 })

    return publicMediaUrl(key)
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
