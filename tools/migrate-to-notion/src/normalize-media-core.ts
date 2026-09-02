import { HTMLElement, parse } from "node-html-parser"

import type { MediaUsage } from "./media-mapping"
import { normalizeMediaSourceUrl } from "./media-mapping"
import type { WordPressAttachmentRecord, WordPressContentRecord } from "./types"

export interface MediaReference {
  sourceUrl: string
  usage: MediaUsage
}

export type AttachmentIndex = ReadonlyMap<string, WordPressAttachmentRecord>

const isTrackingImage = (element: HTMLElement): boolean => {
  const style = element.getAttribute("style") ?? ""
  const width = Number.parseFloat(
    element.getAttribute("width") ?? style.match(/width:\s*([\d.]+)px/i)?.[1] ?? "",
  )
  const height = Number.parseFloat(
    element.getAttribute("height") ?? style.match(/height:\s*([\d.]+)px/i)?.[1] ?? "",
  )

  return (Number.isFinite(width) && width < 2) || (Number.isFinite(height) && height < 2)
}

const toMediaUrl = (value: string, baseUrl?: string): string | null => {
  try {
    const absolute = new URL(value.startsWith("//") ? `https:${value}` : value, baseUrl).href
    const normalized = normalizeMediaSourceUrl(absolute)

    return new URL(normalized).hostname === "mirumi.media" ? normalized : null
  } catch {
    return null
  }
}

const shortcodeMediaUrls = (content: string): Array<string> => {
  const urls: Array<string> = []
  for (const match of content.matchAll(/\[(?:image|quoteImage)\b[^\]]*\bname=(['"])(.*?)\1/gi)) {
    const name = match[2]?.trim()
    if (!name || name.includes("://")) {
      continue
    }
    const url = new URL("https://mirumi.media")
    url.pathname = `/${name.replace(/^\/+/, "")}`
    urls.push(url.href)
  }

  return urls
}

export const collectMediaReferences = (
  records: Array<WordPressContentRecord>,
): Array<MediaReference> => {
  const references = new Map<string, MediaReference>()
  const add = (value: string, usage: MediaUsage, baseUrl?: string) => {
    const sourceUrl = toMediaUrl(value, baseUrl)
    if (!sourceUrl) {
      return
    }
    const key = `${usage}\0${sourceUrl}`
    if (!references.has(key)) {
      references.set(key, { sourceUrl, usage })
    }
  }

  for (const record of records) {
    const articleUrl = `https://mirumi.me/${record.slug}/`
    const root = parse(record.content)
    for (const image of root.querySelectorAll("img")) {
      if (isTrackingImage(image)) {
        continue
      }
      const source =
        image.getAttribute("src") ??
        image.getAttribute("data-src") ??
        image.getAttribute("data-lazy-src")
      if (source) {
        add(source, "body", articleUrl)
      }
    }
    for (const source of shortcodeMediaUrls(record.content)) {
      add(source, "body")
    }
    if (record.showThumbnailOnFrontend && record.thumbnailUrl) {
      add(record.thumbnailUrl, "thumbnail")
    }
  }

  return [...references.values()]
}

export const createAttachmentIndex = (
  attachments: Array<WordPressAttachmentRecord>,
): AttachmentIndex => {
  const index = new Map<string, WordPressAttachmentRecord>()
  for (const attachment of attachments) {
    for (const value of [attachment.originalUrl, ...attachment.sourceUrls]) {
      const sourceUrl = normalizeMediaSourceUrl(value)
      const current = index.get(sourceUrl)
      if (current && current.id !== attachment.id) {
        throw Error(`attachment URL が衝突しています: ${sourceUrl}`)
      }
      index.set(sourceUrl, attachment)
    }
  }

  return index
}

const removeDimensionSuffix = (sourceUrl: string): string => {
  const candidate = new URL(sourceUrl)
  candidate.pathname = candidate.pathname.replace(/-\d+x\d+(?=\.[^./]+$)/i, "")

  return candidate.href
}

export const createSourceCandidates = (
  sourceUrl: string,
  attachments: AttachmentIndex,
): Array<string> => {
  const normalized = normalizeMediaSourceUrl(sourceUrl)
  const attachment = attachments.get(normalized)
  const candidates = attachment
    ? [normalizeMediaSourceUrl(attachment.originalUrl), normalized]
    : [removeDimensionSuffix(normalized), normalized]

  return [...new Set(candidates)]
}
