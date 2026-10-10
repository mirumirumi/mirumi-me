import { createHash } from "node:crypto"
import { readFile, rename, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import sharp from "sharp"

import { S3MediaObjectStore } from "../../../server/src/containers/aws"
import {
  MediaNormalizer,
  type MediaObject,
  type MediaObjectMetadata,
  type MediaObjectStore,
} from "../../../server/src/containers/images"
import { downloadImage } from "../../../server/src/containers/media-sync"
import type { MediaMigrationEntry, MediaMigrationMapping } from "./media-mapping"
import { selectMigrationTargets } from "./migration-targets"
import {
  collectMediaReferences,
  createAttachmentIndex,
  createSourceCandidates,
  type MediaReference,
} from "./normalize-media-core"
import { readContents } from "./read"
import type { WordPressAttachmentRecord } from "./types"

const MAX_ATTEMPTS = 3
const DEFAULT_CONCURRENCY = 3
const baseDirectory = fileURLToPath(new URL("..", import.meta.url))

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    source: { type: "string", default: "blog-content-block-survey/contents.ndjson" },
    attachments: { type: "string", default: "media-attachments.ndjson" },
    mapping: { type: "string" },
    report: { type: "string", default: "media-normalization-report.json" },
    concurrency: { type: "string", default: String(DEFAULT_CONCURRENCY) },
  },
})
const apply = values.apply ?? false
const concurrency = Number.parseInt(values.concurrency ?? String(DEFAULT_CONCURRENCY), 10)
if (!Number.isInteger(concurrency) || concurrency < 1 || 8 < concurrency) {
  throw Error("--concurrency には 1〜8 の整数を指定してください")
}
const sourcePath = resolve(
  baseDirectory,
  values.source ?? "blog-content-block-survey/contents.ndjson",
)
const attachmentsPath = resolve(baseDirectory, values.attachments ?? "media-attachments.ndjson")
const mappingPath = resolve(
  baseDirectory,
  values.mapping ?? (apply ? "media-mapping.json" : "media-mapping.preview.json"),
)
const reportPath = resolve(baseDirectory, values.report ?? "media-normalization-report.json")

class PlanningMediaStore implements MediaObjectStore {
  keys = new Set<string>()

  async head(_key: string): Promise<MediaObjectMetadata | null> {
    return null
  }

  async put(key: string, _object: MediaObject) {
    this.keys.add(key)
  }
}

interface MediaNormalizationFailure {
  sourceUrl: string
  usage: MediaReference["usage"]
  error: string
}

interface MediaNormalizationReport {
  generatedAt: string
  applied: boolean
  source: string
  attachments: string
  references: number
  responsive: number
  passthrough: number
  animations: number
  originalSourceFallbacks: number
  objects: number
  failures: Array<MediaNormalizationFailure>
  mapping: string | null
}

const readAttachments = async (path: string): Promise<Array<WordPressAttachmentRecord>> => {
  const raw = await readFile(path, "utf8")
  const records: Array<WordPressAttachmentRecord> = []
  for (const [index, line] of raw.trimEnd().split("\n").entries()) {
    if (!line.trim()) {
      continue
    }
    const value = JSON.parse(line) as Partial<WordPressAttachmentRecord>
    if (
      typeof value.id !== "number" ||
      typeof value.mimeType !== "string" ||
      typeof value.originalUrl !== "string" ||
      !Array.isArray(value.sourceUrls) ||
      value.sourceUrls.some((url) => typeof url !== "string")
    ) {
      throw Error(`media attachment の ${index + 1} 行目が不正です`)
    }
    records.push(value as WordPressAttachmentRecord)
  }

  return records
}

const sleep = (milliseconds: number) => {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}

const downloadWithRetry = async (url: string): Promise<Uint8Array> => {
  let lastError: unknown = Error("画像を取得できませんでした")
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await downloadImage(url)
    } catch (err) {
      lastError = err
      if (attempt < MAX_ATTEMPTS) {
        await sleep(500 * 2 ** (attempt - 1))
      }
    }
  }

  throw lastError
}

const imageMetadata = async (bytes: Uint8Array): Promise<{ width: number; animated: boolean }> => {
  const metadata = await sharp(bytes, { animated: true, limitInputPixels: false }).metadata()
  const width = metadata.autoOrient?.width ?? metadata.width
  const height = metadata.pageHeight ?? metadata.autoOrient?.height ?? metadata.height
  if (!width || !height) {
    throw Error("画像の寸法を取得できません")
  }
  if (20_000 < width || 20_000 < height || 40_000_000 < width * height) {
    throw Error("画像の寸法または pixel 数が上限を超えています")
  }

  return { width, animated: 1 < (metadata.pages ?? 1) }
}

const icoWidth = (bytes: Uint8Array): number | null => {
  if (
    bytes.byteLength < 8 ||
    bytes[0] !== 0 ||
    bytes[1] !== 0 ||
    bytes[2] !== 1 ||
    bytes[3] !== 0
  ) {
    return null
  }

  return bytes[6] === 0 ? 256 : (bytes[6] ?? null)
}

const errorMessage = (err: unknown): string => {
  return err instanceof Error ? err.message.slice(0, 500) : "不明なエラー"
}

const writeJsonAtomic = async (path: string, value: unknown) => {
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`)
  await rename(temporaryPath, path)
}

const createStore = (): MediaObjectStore => {
  if (!apply) {
    return new PlanningMediaStore()
  }
  const region = process.env.AWS_REGION
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  const bucket = process.env.MEDIA_BUCKET_NAME
  if (!region || !accessKeyId || !secretAccessKey || !bucket) {
    throw Error("--apply に必要な AWS / MEDIA_BUCKET_NAME が設定されていません")
  }

  return new S3MediaObjectStore({ region, accessKeyId, secretAccessKey }, bucket)
}

const records = selectMigrationTargets(await readContents(sourcePath))
const attachmentIndex = createAttachmentIndex(await readAttachments(attachmentsPath))
const references = collectMediaReferences(records)
const store = createStore()
const normalizer = new MediaNormalizer(store)
const downloadCache = new Map<string, Promise<Uint8Array>>()
const entries = new Array<MediaMigrationEntry | null>(references.length).fill(null)
const failures: Array<MediaNormalizationFailure> = []
let cursor = 0
let animations = 0
let originalSourceFallbacks = 0

const processReference = async (reference: MediaReference, index: number) => {
  let lastError: unknown = Error("画像の入力候補がありません")
  try {
    const candidates = createSourceCandidates(reference.sourceUrl, attachmentIndex)
    for (const sourceUrl of candidates) {
      try {
        let bytes = downloadCache.get(sourceUrl)
        if (!bytes) {
          bytes = downloadWithRetry(sourceUrl)
          downloadCache.set(sourceUrl, bytes)
        }
        const sourceBytes = await bytes
        const preservedIcoWidth = sourceUrl.toLowerCase().endsWith(".ico")
          ? icoWidth(sourceBytes)
          : null
        if (preservedIcoWidth) {
          entries[index] = {
            sourceUrl: reference.sourceUrl,
            usage: reference.usage,
            kind: "passthrough",
            fallbackUrl: reference.sourceUrl,
            sourceWidth: preservedIcoWidth,
          }
          return
        }
        const metadata = await imageMetadata(sourceBytes)
        if (metadata.animated) {
          animations++
          entries[index] = {
            sourceUrl: reference.sourceUrl,
            usage: reference.usage,
            kind: "passthrough",
            fallbackUrl: reference.sourceUrl,
            sourceWidth: metadata.width,
          }
          return
        }

        const fallbackStem = `image-${createHash("sha256")
          .update(reference.sourceUrl)
          .digest("hex")
          .slice(0, 12)}`
        const fallbackUrl =
          reference.usage === "body"
            ? (await normalizer.normalizeBodyImage(sourceBytes, reference.sourceUrl, fallbackStem))
                .fallbackUrl
            : (
                await normalizer.normalizeThumbnailImage(
                  sourceBytes,
                  reference.sourceUrl,
                  fallbackStem,
                )
              ).article
        if (sourceUrl !== reference.sourceUrl) {
          originalSourceFallbacks++
        }
        entries[index] = {
          sourceUrl: reference.sourceUrl,
          usage: reference.usage,
          kind: "responsive",
          fallbackUrl,
          sourceWidth: metadata.width,
        }
        return
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  } catch (err) {
    failures.push({
      sourceUrl: reference.sourceUrl,
      usage: reference.usage,
      error: errorMessage(err),
    })
  }
}

await Promise.all(
  Array.from({ length: Math.min(concurrency, references.length) }, async () => {
    while (cursor < references.length) {
      const index = cursor++
      await processReference(references[index]!, index)
      if ((index + 1) % 100 === 0 || index + 1 === references.length) {
        process.stdout.write(`${index + 1}/${references.length}\n`)
      }
    }
  }),
)

const completedEntries = entries.filter((entry): entry is MediaMigrationEntry => entry !== null)
const planningStore = store instanceof PlanningMediaStore ? store : null
const report: MediaNormalizationReport = {
  generatedAt: new Date().toISOString(),
  applied: apply,
  source: sourcePath,
  attachments: attachmentsPath,
  references: references.length,
  responsive: completedEntries.filter(({ kind }) => kind === "responsive").length,
  passthrough: completedEntries.filter(({ kind }) => kind === "passthrough").length,
  animations,
  originalSourceFallbacks,
  objects: planningStore?.keys.size ?? 0,
  failures: failures.toSorted((left, right) => left.sourceUrl.localeCompare(right.sourceUrl)),
  mapping: failures.length === 0 ? mappingPath : null,
}
await writeJsonAtomic(reportPath, report)
if (0 < failures.length) {
  throw Error(`media normalization に ${failures.length} 件失敗しました: ${reportPath}`)
}

const mapping: MediaMigrationMapping = {
  schemaVersion: 1,
  generatedAt: report.generatedAt,
  entries: completedEntries.toSorted((left, right) => {
    return left.sourceUrl.localeCompare(right.sourceUrl) || left.usage.localeCompare(right.usage)
  }),
}
await writeJsonAtomic(mappingPath, mapping)
process.stdout.write(
  [
    apply ? "S3 へ適用しました" : "dry-run が完了しました",
    `参照: ${report.references} 件 / 変換: ${report.responsive} 件 / passthrough: ${report.passthrough} 件`,
    `mapping: ${mappingPath}`,
    `report: ${reportPath}`,
  ].join("\n") + "\n",
)
