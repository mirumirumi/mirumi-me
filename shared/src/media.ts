export const MEDIA_HOSTNAME = "mirumi.media"
const BODY_IMAGE_WIDTHS = [800, 1_200, 1_600]

export const BODY_IMAGE_SIZES =
  "(max-width: 428px) calc(100vw - 54px), (max-width: 829px) calc(100vw - 44px), 785px"

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

export const resolveResponsiveBodyImage = (value: string): ResponsiveBodyImage | null => {
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
  const match = filename.match(/^([a-f0-9]{16})-(.+)-(\d+)w\.webp$/)
  if (!match?.[1] || !match[2] || !match[3]) {
    return null
  }
  const fallbackWidth = Number(match[3])
  if (!Number.isSafeInteger(fallbackWidth) || fallbackWidth < 1) {
    return null
  }

  const widths = [...BODY_IMAGE_WIDTHS.filter((width) => width < fallbackWidth), fallbackWidth]
  const baseFilename = `${match[1]}-${match[2]}`
  const srcset = widths
    .map((width) => {
      const variant = new URL(url)
      variant.pathname = `${url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1)}${encodeURIComponent(`${baseFilename}-${width}w.webp`)}`

      return `${variant.href} ${width}w`
    })
    .join(", ")

  return { fallbackUrl: url.href, fallbackWidth, srcset, sizes: BODY_IMAGE_SIZES }
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
