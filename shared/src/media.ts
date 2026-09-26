export const MEDIA_HOSTNAME = "mirumi.media"
const BODY_IMAGE_WIDTHS = [800, 1_200, 1_600]

// desktop の本文の最大幅。これ以上の画像はどれも同じ全幅で表示される
export const BODY_CONTENT_WIDTH = 785

export const BODY_IMAGE_SIZES = `(max-width: 428px) calc(100vw - 54px), (max-width: 829px) calc(100vw - 44px), ${BODY_CONTENT_WIDTH}px`

export interface ResponsiveBodyImage {
  fallbackUrl: string
  fallbackWidth: number
  srcset: string
  sizes: string
}

export interface ResolvedThumbnailUrls {
  article: string
  mobile: string
  card: string
}

export interface MediaDimensions {
  width: number
  height: number
}

const parseMediaUrl = (value: string): { url: URL; filename: string } | null => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.hostname !== MEDIA_HOSTNAME) {
    return null
  }

  return { url, filename: decodeURIComponent(url.pathname.split("/").at(-1) ?? "") }
}

const parseDimensions = (width: string, height: string): MediaDimensions | null => {
  const dimensions = { width: Number(width), height: Number(height) }
  if (
    !Number.isSafeInteger(dimensions.width) ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1
  ) {
    return null
  }

  return dimensions
}

// 本文静止画は `{assetHash}-{stem}-{fallback の W}x{H}-{variant の幅}w.webp`。
// 画像セットの寸法を全 variant が共有するので、どの variant の URL からでもセット全体を復元できる
const parseBodyImageFilename = (
  filename: string,
): { prefix: string; dimensions: MediaDimensions; variantWidth: number } | null => {
  const match = filename.match(/^([a-f0-9]{16}-.+-(\d+)x(\d+))-(\d+)w\.webp$/)
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) {
    return null
  }
  const dimensions = parseDimensions(match[2], match[3])
  const variantWidth = Number(match[4])
  if (!dimensions || !Number.isSafeInteger(variantWidth) || dimensions.width < variantWidth) {
    return null
  }

  return { prefix: match[1], dimensions, variantWidth }
}

export const resolveResponsiveBodyImage = (value: string): ResponsiveBodyImage | null => {
  const media = parseMediaUrl(value)
  const parsed = media ? parseBodyImageFilename(media.filename) : null
  if (!media || !parsed) {
    return null
  }

  const fallbackWidth = parsed.dimensions.width
  const widths = [...BODY_IMAGE_WIDTHS.filter((width) => width < fallbackWidth), fallbackWidth]
  const variantUrl = (width: number): string => {
    const variant = new URL(media.url)
    variant.pathname = `${media.url.pathname.slice(0, media.url.pathname.lastIndexOf("/") + 1)}${encodeURIComponent(`${parsed.prefix}-${width}w.webp`)}`

    return variant.href
  }
  const srcset = widths.map((width) => `${variantUrl(width)} ${width}w`).join(", ")

  return {
    fallbackUrl: variantUrl(fallbackWidth),
    fallbackWidth,
    srcset,
    sizes: BODY_IMAGE_SIZES,
  }
}

// img の width / height に使う寸法。canonical な名前だけを根拠にし、
// WordPress 時代のファイル名にある `-{W}x{H}` は表示サイズと食い違うことがあるので推測に使わない
export const resolveMediaDimensions = (value: string): MediaDimensions | null => {
  const media = parseMediaUrl(value)
  if (!media) {
    return null
  }
  const body = parseBodyImageFilename(media.filename)
  if (body) {
    return body.dimensions
  }
  // animation と thumbnail は 1 ファイルが自分の寸法を末尾に持つ
  const match = media.filename.match(/^[a-f0-9]{16}-.+-(\d+)x(\d+)\.[a-z0-9]+$/)

  return match?.[1] && match[2] ? parseDimensions(match[1], match[2]) : null
}

// 著者が thumbnail を設定していない記事も、トップや一覧のカードでは自動生成した OGP 画像を出す。
// 記事ヘッダーに出すかどうかは thumbnailUrls の有無で決めるため、そちらの判定はこれを使わない
export const resolveCardImageUrl = (
  thumbnailUrls: Pick<ResolvedThumbnailUrls, "card"> | null,
  ogImageUrl: string,
): string | null => {
  return thumbnailUrls?.card ?? resolveThumbnailUrls(ogImageUrl)?.card ?? null
}

export const resolveThumbnailUrls = (value: string): ResolvedThumbnailUrls | null => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.hostname !== MEDIA_HOSTNAME) {
    return null
  }

  const filename = decodeURIComponent(url.pathname.split("/").at(-1) ?? "")
  const match = filename.match(/^([a-f0-9]{16})-(.+)-1200x630\.webp$/)
  if (!match?.[1] || !match[2]) {
    return null
  }
  const prefix = `${match[1]}-${match[2]}`
  const variantUrl = (size: "412x216" | "600x315" | "1200x630"): string => {
    const variant = new URL(url)
    variant.pathname = `${url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1)}${encodeURIComponent(`${prefix}-${size}.webp`)}`

    return variant.href
  }

  return {
    article: variantUrl("1200x630"),
    mobile: variantUrl("600x315"),
    card: variantUrl("412x216"),
  }
}
