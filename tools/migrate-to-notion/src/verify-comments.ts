import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { isFullPage, type PageObjectResponse } from "@notionhq/client"

import { createNotionClient } from "shared/notion"
import { COMMENT_PROPERTIES, parseCommentPage } from "shared/notion-comments"

import { createCommentSourceHash, type WordPressCommentRecord } from "./comments-import-core"
import { COMMENTS_DATA_SOURCE_ID } from "./config"
import { request } from "./notion-request"

// 最終 snapshot（comments.ndjson）と Notion の approved row を hash で照合する完了条件の確認。
// ここだけはメールも読む（WordPress の空文字と Notion の値なしを同値として比較するため）
const sourcePath = fileURLToPath(new URL("../comments.ndjson", import.meta.url))

const { values } = parseArgs({
  options: {
    "data-source": { type: "string", default: COMMENTS_DATA_SOURCE_ID },
  },
})
const dataSourceId = values["data-source"] ?? COMMENTS_DATA_SOURCE_ID

const token = process.env.NOTION_TOKEN
if (!token) {
  throw Error("NOTION_TOKEN が設定されていません")
}
const client = createNotionClient(token)

const fetchAllPages = async (): Promise<Array<PageObjectResponse>> => {
  const pages: Array<PageObjectResponse> = []
  let cursor: string | null = null
  while (true) {
    const response = await request(() =>
      client.dataSources.query({
        data_source_id: dataSourceId,
        page_size: 100,
        result_type: "page",
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    )
    if (response.request_status?.type === "incomplete") {
      throw Error("query が途中で打ち切られました")
    }
    for (const result of response.results) {
      if (isFullPage(result) && !result.in_trash) {
        pages.push(result)
      }
    }
    if (!response.has_more || !response.next_cursor) {
      return pages
    }
    cursor = response.next_cursor
  }
}

const getEmail = (page: PageObjectResponse): string => {
  const property = page.properties[COMMENT_PROPERTIES.email]

  return property?.type === "email" ? (property.email ?? "") : ""
}

const getNumber = (page: PageObjectResponse, name: string): number | null => {
  const property = page.properties[name]

  return property?.type === "number" ? property.number : null
}

const exported = (await readFile(sourcePath, "utf8"))
  .trimEnd()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as WordPressCommentRecord)
const exportedById = new Map(exported.map((record) => [record.id, record]))

const pages = await fetchAllPages()
const legacyIdByPageId = new Map<string, number>()
for (const page of pages) {
  const legacyId = getNumber(page, COMMENT_PROPERTIES.legacyCommentId)
  if (legacyId !== null) {
    legacyIdByPageId.set(page.id, legacyId)
  }
}

const problems: Array<string> = []
const notionApprovedById = new Map<number, WordPressCommentRecord>()
for (const page of pages) {
  const record = parseCommentPage(page)
  const legacyId = getNumber(page, COMMENT_PROPERTIES.legacyCommentId)
  if (record.state !== "approved") {
    continue
  }
  if (legacyId === null) {
    // 移行後に公開フォームや owner reply で増えた row は照合対象外
    continue
  }
  if (notionApprovedById.has(legacyId)) {
    problems.push(`legacy-comment-id が重複: ${legacyId}`)
    continue
  }
  const parentLegacyId = record.parentPageId
    ? (legacyIdByPageId.get(record.parentPageId) ?? null)
    : null
  if (record.parentPageId && parentLegacyId === null) {
    problems.push(`親の legacy-comment-id を解決できない: ${legacyId}`)
  }
  notionApprovedById.set(legacyId, {
    id: legacyId,
    postId: getNumber(page, COMMENT_PROPERTIES.legacyPostId) ?? 0,
    postSlug: record.slug,
    parentId: parentLegacyId,
    isOwner: record.isOwner,
    author: record.authorName,
    email: getEmail(page),
    createdAt: new Date(record.createdAt).toISOString(),
    content: record.content,
  })
}

let matched = 0
for (const record of exported) {
  const notion = notionApprovedById.get(record.id)
  if (!notion) {
    problems.push(`Notion に無い: ${record.id} (${record.postSlug})`)
    continue
  }
  if (createCommentSourceHash(notion) !== createCommentSourceHash(record)) {
    problems.push(`hash 不一致: ${record.id} (${record.postSlug})`)
    continue
  }
  matched += 1
}
for (const legacyId of notionApprovedById.keys()) {
  if (!exportedById.has(legacyId)) {
    problems.push(`Notion にだけ approved で残っている: ${legacyId}`)
  }
}

const countBySlug = (records: Iterable<WordPressCommentRecord>): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const record of records) {
    counts.set(record.postSlug, (counts.get(record.postSlug) ?? 0) + 1)
  }

  return counts
}
const exportedCounts = countBySlug(exported)
const notionCounts = countBySlug(notionApprovedById.values())
for (const [slug, count] of exportedCounts) {
  if (notionCounts.get(slug) !== count) {
    problems.push(
      `記事別件数が不一致: ${slug} export=${count} notion=${notionCounts.get(slug) ?? 0}`,
    )
  }
}

process.stdout.write(
  [
    `export: ${exported.length} 件 / Notion approved（legacy）: ${notionApprovedById.size} 件 / 一致: ${matched} 件`,
    `記事数: export ${exportedCounts.size} / Notion ${notionCounts.size}`,
    problems.length === 0 ? "問題なし" : `問題 ${problems.length} 件:`,
    ...problems.map((problem) => `  - ${problem}`),
    "",
  ].join("\n"),
)
process.exit(problems.length === 0 ? 0 : 1)
