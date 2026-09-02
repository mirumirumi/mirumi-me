import { writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

import { countBlockRequests } from "./batch"
import { convertWordPressContent } from "./convert"
import { createMediaMigrationResolver, readMediaMigrationMapping } from "./media-mapping"
import { selectMigrationTargets } from "./migration-targets"
import { readContents } from "./read"
import type { MigrationWarning, MigrationWarningCode, NotionPageInput } from "./types"

interface DryRunReport {
  generatedAt: string
  source: string
  mediaMapping: string
  records: number
  blocks: number
  blockTypes: Record<string, number>
  maxTopLevelBlocks: { sourceId: number; slug: string; blocks: number } | null
  blockRequests: number
  recordsNeedingExtraRequests: Array<{ sourceId: number; slug: string; requests: number }>
  recordsWithoutBlocks: Array<{ sourceId: number; slug: string }>
  thumbnails: number
  warnings: number
  warningCodes: Partial<Record<MigrationWarningCode, number>>
  warningRecords: Array<{
    sourceId: number
    slug: string
    warnings: Array<MigrationWarning>
  }>
}

const sourcePath = fileURLToPath(
  new URL("../blog-content-block-survey/contents.ndjson", import.meta.url),
)
const reportPath = fileURLToPath(new URL("../dry-run-report.json", import.meta.url))
const { values } = parseArgs({
  options: {
    "media-map": { type: "string", default: "media-mapping.json" },
  },
})
const mediaMappingPath = fileURLToPath(
  new URL(`../${values["media-map"] ?? "media-mapping.json"}`, import.meta.url),
)

const addBlockCounts = (blocks: ReadonlyArray<unknown>, counts: Record<string, number>): number => {
  let total = 0
  for (const value of blocks) {
    if (!value || typeof value !== "object") {
      continue
    }

    const block = value as { type?: unknown; [key: string]: unknown }
    const type = typeof block.type === "string" ? block.type : "unknown"
    const body = block[type]
    const children =
      body && typeof body === "object" && "children" in body && Array.isArray(body.children)
        ? body.children
        : []

    counts[type] = (counts[type] ?? 0) + 1
    total += 1 + addBlockCounts(children, counts)
  }

  return total
}

const makeReport = (conversions: Array<NotionPageInput>): DryRunReport => {
  const blockTypes: Record<string, number> = {}
  const warningCodes: Partial<Record<MigrationWarningCode, number>> = {}
  let blocks = 0
  let warnings = 0
  let maxTopLevelBlocks: DryRunReport["maxTopLevelBlocks"] = null

  for (const conversion of conversions) {
    blocks += addBlockCounts(conversion.children, blockTypes)
    if (!maxTopLevelBlocks || maxTopLevelBlocks.blocks < conversion.children.length) {
      maxTopLevelBlocks = {
        sourceId: conversion.sourceId,
        slug: conversion.slug,
        blocks: conversion.children.length,
      }
    }
    warnings += conversion.warnings.length
    for (const warning of conversion.warnings) {
      warningCodes[warning.code] = (warningCodes[warning.code] ?? 0) + 1
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    source: sourcePath,
    mediaMapping: mediaMappingPath,
    records: conversions.length,
    blocks,
    blockTypes: Object.fromEntries(
      Object.entries(blockTypes).sort((left, right) => right[1] - left[1]),
    ),
    maxTopLevelBlocks,
    blockRequests: conversions.reduce(
      (total, conversion) => total + countBlockRequests(conversion.children),
      0,
    ),
    recordsNeedingExtraRequests: conversions
      .map(({ sourceId, slug, children }) => ({
        sourceId,
        slug,
        requests: countBlockRequests(children),
      }))
      .filter(({ requests }) => 1 < requests)
      .sort((left, right) => right.requests - left.requests),
    recordsWithoutBlocks: conversions
      .filter((conversion) => conversion.children.length === 0)
      .map(({ sourceId, slug }) => ({ sourceId, slug })),
    thumbnails: conversions.filter((conversion) => {
      const thumbnail = conversion.properties.thumbnail
      return thumbnail && "files" in thumbnail && 0 < (thumbnail.files?.length ?? 0)
    }).length,
    warnings,
    warningCodes: Object.fromEntries(
      Object.entries(warningCodes).sort((left, right) => right[1] - left[1]),
    ),
    warningRecords: conversions
      .filter((conversion) => 0 < conversion.warnings.length)
      .map(({ sourceId, slug, warnings: conversionWarnings }) => ({
        sourceId,
        slug,
        warnings: conversionWarnings,
      })),
  }
}

const records = selectMigrationTargets(await readContents(sourcePath))
const media = createMediaMigrationResolver(await readMediaMigrationMapping(mediaMappingPath))
const conversions = records.map((record) => convertWordPressContent(record, media))
const report = makeReport(conversions)

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
process.stdout.write(
  [
    `${report.records} 件を変換しました`,
    `ブロック: ${report.blocks} 件`,
    `警告: ${report.warnings} 件 / ${report.warningRecords.length} 記事`,
    `本文なし: ${report.recordsWithoutBlocks.length} 件`,
    `ブロック投入リクエスト: ${report.blockRequests} 回 / 追加リクエストが必要: ${report.recordsNeedingExtraRequests.length} 記事`,
    `レポート: ${reportPath}`,
  ].join("\n") + "\n",
)
