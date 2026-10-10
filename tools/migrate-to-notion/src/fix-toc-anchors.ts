import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import type { BlockObjectResponse, Client } from "@notionhq/client"

import { createNotionClient, fetchNotionBlockTree, fetchNotionPageIndex } from "shared/notion"

import { MIGRATION_TARGET, PAGES_DATA_SOURCE_ID, POSTS_DATA_SOURCE_ID } from "./config"
import { request } from "./notion-request"
import { readContents } from "./read"
import {
  buildTocAnchorBlockUpdate,
  collectLegacyTocLinks,
  collectLinkUrls,
  collectNotionTocHeadings,
  collectWordPressTocHeadings,
  flattenNotionBlocks,
  planTocAnchorFix,
  type TocAnchorFix,
} from "./toc-anchors-core"

const baseDirectory = fileURLToPath(new URL("..", import.meta.url))

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    slug: { type: "string", multiple: true, default: [] },
    source: { type: "string", default: "blog-content-block-survey/contents.ndjson" },
    report: { type: "string", default: "toc-anchor-report.json" },
    "posts-data-source": { type: "string", default: POSTS_DATA_SOURCE_ID },
    "pages-data-source": { type: "string", default: PAGES_DATA_SOURCE_ID },
  },
})
const apply = values.apply ?? false
const slugs = new Set(values.slug ?? [])
const sourcePath = resolve(
  baseDirectory,
  values.source ?? "blog-content-block-survey/contents.ndjson",
)
const reportPath = resolve(baseDirectory, values.report ?? "toc-anchor-report.json")

const token = process.env.NOTION_TOKEN
if (!token) {
  throw Error("NOTION_TOKEN が設定されていません")
}
const client = createNotionClient(token)

const blockTrees = new Map<string, Array<BlockObjectResponse>>()
const headingsCache = new Map<string, ReturnType<typeof collectNotionTocHeadings>>()

const loadPage = async (pageId: string) => {
  const cached = blockTrees.get(pageId)
  if (cached) {
    return { blocks: cached, headings: headingsCache.get(pageId) ?? [] }
  }
  const tree = await request(() => fetchNotionBlockTree(client, pageId))
  const blocks = flattenNotionBlocks(tree)
  const headings = collectNotionTocHeadings(tree)
  blockTrees.set(pageId, blocks)
  headingsCache.set(pageId, headings)

  return { blocks, headings }
}

const main = async (notion: Client) => {
  const records = await readContents(sourcePath)
  const contentBySlug = new Map(records.map((record) => [record.slug, record]))
  const links = collectLegacyTocLinks(records).filter(
    (link) => slugs.size === 0 || slugs.has(link.sourceSlug),
  )
  process.stdout.write(
    `対象 ${MIGRATION_TARGET}: 旧目次リンク ${links.length} 件（記事 ${new Set(links.map((link) => link.sourceSlug)).size} 本）\n`,
  )

  const index = await request(() =>
    fetchNotionPageIndex(notion, {
      posts: values["posts-data-source"] ?? POSTS_DATA_SOURCE_ID,
      pages: values["pages-data-source"] ?? PAGES_DATA_SOURCE_ID,
    }),
  )
  const pageIdBySlug = new Map(index.map(({ revision }) => [revision.slug, revision.pageId]))

  const fixes: Array<TocAnchorFix> = []
  for (const link of links) {
    const targetPageId = link.targetSlug ? pageIdBySlug.get(link.targetSlug) : undefined
    const wordPressContent = link.targetSlug ? contentBySlug.get(link.targetSlug) : undefined
    const notionHeadings =
      targetPageId && link.kind === "inline" ? (await loadPage(targetPageId)).headings : null
    fixes.push(
      planTocAnchorFix(
        link,
        wordPressContent ? collectWordPressTocHeadings(wordPressContent.content) : null,
        notionHeadings,
      ),
    )
  }

  // 置換は「リンク元の記事」の block に対して行う。同じ記事に複数のリンクがあるので URL 単位でまとめる
  const replacementsBySlug = new Map<string, Map<string, string>>()
  for (const fix of fixes) {
    if (fix.status !== "ready" || !fix.newUrl) {
      continue
    }
    const replacements = replacementsBySlug.get(fix.sourceSlug) ?? new Map<string, string>()
    replacements.set(fix.legacyUrl, fix.newUrl)
    replacementsBySlug.set(fix.sourceSlug, replacements)
  }

  const updates: Array<{
    sourceSlug: string
    blockId: string
    blockType: string
    replacedUrls: Array<string>
  }> = []
  const unmatched: Array<{ sourceSlug: string; legacyUrl: string }> = []
  const alreadyApplied: Array<{ sourceSlug: string; newUrl: string }> = []
  const failures: Array<{ sourceSlug: string; blockId: string; error: string }> = []
  for (const [slug, replacements] of replacementsBySlug) {
    const pageId = pageIdBySlug.get(slug)
    if (!pageId) {
      process.stdout.write(`  ${slug}: Notion ページが見つかりません\n`)
      continue
    }
    const found = new Set<string>()
    for (const block of (await loadPage(pageId)).blocks) {
      const update = buildTocAnchorBlockUpdate(block, replacements)
      if (!update) {
        continue
      }
      for (const url of update.replacedUrls) {
        found.add(url)
      }
      updates.push({
        sourceSlug: slug,
        blockId: block.id,
        blockType: block.type,
        replacedUrls: update.replacedUrls,
      })
      if (apply) {
        try {
          await request(() => notion.blocks.update({ block_id: block.id, ...update.payload }))
        } catch (err) {
          // 1 block の失敗で run 全体を止めると、どこまで通ったのかが分からなくなる
          failures.push({
            sourceSlug: slug,
            blockId: block.id,
            error: err instanceof Error ? err.message.slice(0, 300) : String(err),
          })
        }
      }
    }
    // 解決できたのに Notion 本文側で見つからないものは、すでに置換済みか、本文が編集されたか。
    // 置換後の URL が本文にあれば前者なので、要注意なものだけを unmatched として残す
    const linkUrls = collectLinkUrls((await loadPage(pageId)).blocks)
    for (const [legacyUrl, newUrl] of replacements) {
      if (found.has(legacyUrl)) {
        continue
      }
      if (linkUrls.has(newUrl)) {
        alreadyApplied.push({ sourceSlug: slug, newUrl })
      } else {
        unmatched.push({ sourceSlug: slug, legacyUrl })
      }
    }
  }

  const statuses = fixes.reduce<Record<string, number>>((counts, fix) => {
    counts[fix.status] = (counts[fix.status] ?? 0) + 1

    return counts
  }, {})
  const report = {
    generatedAt: new Date().toISOString(),
    target: MIGRATION_TARGET,
    apply,
    source: sourcePath,
    statuses,
    plannedBlockUpdates: updates.length,
    replacedLinks: updates.reduce((total, update) => total + update.replacedUrls.length, 0),
    fixes,
    updates,
    unmatched,
    alreadyApplied,
    failures,
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")

  process.stdout.write(`\n内訳: ${JSON.stringify(statuses)}\n`)
  process.stdout.write(
    `${apply ? "更新した" : "更新する"} block: ${updates.length}（リンク ${report.replacedLinks} 本）\n`,
  )
  if (0 < alreadyApplied.length) {
    process.stdout.write(`すでに置換済みのリンク: ${alreadyApplied.length} 本\n`)
  }
  for (const { sourceSlug, blockId, error } of failures) {
    process.stdout.write(`  ⚠ block の更新に失敗: ${sourceSlug} の ${blockId} (${error})\n`)
  }
  for (const { sourceSlug, legacyUrl } of unmatched) {
    process.stdout.write(`  ⚠ Notion 本文に見つかりません: ${sourceSlug} の ${legacyUrl}\n`)
  }
  for (const fix of fixes) {
    if (fix.status !== "ready") {
      process.stdout.write(
        `  ${fix.status}: ${fix.sourceSlug} -> ${fix.targetSlug ?? "(外部)"} #toc${fix.anchorNumber}` +
          `${fix.wordPressHeading ? ` WP「${fix.wordPressHeading}」` : ""}` +
          `${fix.notionHeading ? ` Notion「${fix.notionHeading}」` : ""}\n`,
      )
    }
  }
  process.stdout.write(`レポート: ${reportPath}\n`)
  if (!apply) {
    process.stdout.write("dry-run です。実際に書き換えるには --apply を付けてください\n")
  }
  if (0 < failures.length) {
    process.exitCode = 1
  }
}

await main(client)
