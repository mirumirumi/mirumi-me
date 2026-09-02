import { readFile } from "node:fs/promises"

export type MediaUsage = "body" | "thumbnail"

export interface MediaMigrationEntry {
  sourceUrl: string
  usage: MediaUsage
  kind: "responsive" | "passthrough"
  fallbackUrl: string
  sourceWidth: number
}

export interface MediaMigrationMapping {
  schemaVersion: 1
  generatedAt: string
  entries: Array<MediaMigrationEntry>
}

export interface MediaMigrationResolver {
  resolve(sourceUrl: string, usage: MediaUsage): string
}

const WORDPRESS_UPLOAD_HOSTS = new Set([
  "milmemo.net",
  "mirumi.in",
  "mirumi.me",
  "www.milmemo.net",
  "www.mirumi.in",
])

export const normalizeMediaSourceUrl = (value: string): string => {
  const url = new URL(value.startsWith("//") ? `https:${value}` : value)
  if (WORDPRESS_UPLOAD_HOSTS.has(url.hostname) && url.pathname.startsWith("/wp-content/uploads/")) {
    url.hostname = "mirumi.media"
    url.pathname = url.pathname.slice("/wp-content/uploads".length)
  }
  url.protocol = "https:"
  url.port = ""
  url.search = ""
  url.hash = ""

  return url.href
}

const mappingKey = (sourceUrl: string, usage: MediaUsage): string => {
  return `${usage}\0${normalizeMediaSourceUrl(sourceUrl)}`
}

const validateEntry = (value: unknown, index: number): MediaMigrationEntry => {
  if (!value || typeof value !== "object") {
    throw Error(`media mapping の ${index + 1} 件目が不正です`)
  }
  const entry = value as Partial<MediaMigrationEntry>
  if (
    typeof entry.sourceUrl !== "string" ||
    (entry.usage !== "body" && entry.usage !== "thumbnail") ||
    (entry.kind !== "responsive" && entry.kind !== "passthrough") ||
    typeof entry.fallbackUrl !== "string" ||
    typeof entry.sourceWidth !== "number" ||
    !Number.isInteger(entry.sourceWidth) ||
    entry.sourceWidth < 1
  ) {
    throw Error(`media mapping の ${index + 1} 件目が不正です`)
  }
  const sourceUrl = normalizeMediaSourceUrl(entry.sourceUrl)
  const fallbackUrl = normalizeMediaSourceUrl(entry.fallbackUrl)
  if (new URL(sourceUrl).hostname !== "mirumi.media") {
    throw Error(`media mapping の参照先が mirumi.media ではありません: ${sourceUrl}`)
  }
  if (entry.kind === "passthrough" && sourceUrl !== fallbackUrl) {
    throw Error(`passthrough 画像の URL が変更されています: ${sourceUrl}`)
  }
  if (entry.kind === "responsive" && new URL(fallbackUrl).hostname !== "mirumi.media") {
    throw Error(`canonical media URL が mirumi.media ではありません: ${fallbackUrl}`)
  }

  return { ...entry, sourceUrl, fallbackUrl } as MediaMigrationEntry
}

export const createMediaMigrationResolver = (
  mapping: MediaMigrationMapping,
): MediaMigrationResolver => {
  if (mapping.schemaVersion !== 1 || Number.isNaN(Date.parse(mapping.generatedAt))) {
    throw Error("media mapping の schema が不正です")
  }

  const entries = new Map<string, MediaMigrationEntry>()
  for (const [index, value] of mapping.entries.entries()) {
    const entry = validateEntry(value, index)
    const key = mappingKey(entry.sourceUrl, entry.usage)
    if (entries.has(key)) {
      throw Error(`media mapping が重複しています: ${entry.sourceUrl} (${entry.usage})`)
    }
    entries.set(key, entry)
  }

  return {
    resolve: (sourceUrl, usage) => {
      const normalized = normalizeMediaSourceUrl(sourceUrl)
      if (new URL(normalized).hostname !== "mirumi.media") {
        return sourceUrl
      }
      const entry = entries.get(mappingKey(normalized, usage))
      if (!entry) {
        throw Error(`画像が media mapping にありません: ${normalized} (${usage})`)
      }

      return entry.fallbackUrl
    },
  }
}

export const readMediaMigrationMapping = async (path: string): Promise<MediaMigrationMapping> => {
  const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<MediaMigrationMapping>
  if (!Array.isArray(parsed.entries)) {
    throw Error("media mapping に entries がありません")
  }
  const mapping: MediaMigrationMapping = {
    schemaVersion: parsed.schemaVersion as 1,
    generatedAt: parsed.generatedAt ?? "",
    entries: parsed.entries,
  }
  createMediaMigrationResolver(mapping)

  return mapping
}
