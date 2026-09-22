import { readFile, rename, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { isFullPage } from "@notionhq/client"

import { createNotionClient } from "shared/notion"
import { COMMENT_PROPERTIES, resolveCommentDataSourceSchema } from "shared/notion-comments"

import {
  type CommentImportOperation,
  type CommentImportState,
  createCommentPageParameters,
  createCommentTrashParameters,
  createCommentUpdateParameters,
  planCommentImport,
  type WordPressCommentRecord,
} from "./comments-import-core"
import { COMMENTS_DATA_SOURCE_ID } from "./config"
import { request } from "./notion-request"

// 記事 import とは別の再開可能な command。事前 bulk と最終 cutover の差分照合を同じ state で行う。
// 承認済みだけを投入し、承認済みから外れた row は trash にする（hard delete はしない）
const sourcePath = fileURLToPath(new URL("../comments.ndjson", import.meta.url))

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string" },
    "data-source": { type: "string", default: COMMENTS_DATA_SOURCE_ID },
    state: { type: "string", default: "comments-import-state.json" },
  },
})
const dryRun = values["dry-run"] ?? false
const limit = values.limit === undefined ? null : Number.parseInt(values.limit, 10)
if (limit !== null && !Number.isInteger(limit)) {
  throw Error("--limit には整数を指定してください")
}
const dataSourceId = values["data-source"] ?? COMMENTS_DATA_SOURCE_ID
// 動作確認と本番で状態ファイルを分けられるようにする（混ざると本番分が投入済み扱いになる）
const statePath = fileURLToPath(
  new URL(`../${values.state ?? "comments-import-state.json"}`, import.meta.url),
)

const readRecords = async (): Promise<Array<WordPressCommentRecord>> => {
  let raw: string
  try {
    raw = await readFile(sourcePath, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw Error("comments.ndjson がありません。先に fetch-comments を実行してください")
    }
    throw err
  }

  return raw
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WordPressCommentRecord)
}

const readState = async (): Promise<CommentImportState> => {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as CommentImportState
  } catch (err) {
    // 初回はファイルがなくて当然。それ以外の読み取り失敗を握りつぶすと全件を作り直してしまうので落とす
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {}
    }
    throw err
  }
}

// 書き込み中に落ちても壊れたファイルが残らないよう、一時ファイルへ書いてから置き換える
const writeState = async (state: CommentImportState) => {
  const temporaryPath = `${statePath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  await rename(temporaryPath, statePath)
}

const token = process.env.NOTION_TOKEN
if (!token) {
  throw Error("NOTION_TOKEN が設定されていません")
}

const client = createNotionClient(token)
const records = await readRecords()
const state = await readState()
const plan = planCommentImport(records, state)
process.stdout.write(
  [
    `対象: ${records.length} 件（承認済みのみ）`,
    `投入先: comments=${dataSourceId}`,
    `状態: ${statePath}`,
    `計画: create ${plan.counts.create} / update ${plan.counts.update} / skip ${plan.counts.skip} / trash ${plan.counts.trash}`,
    "",
  ].join("\n"),
)
if (dryRun) {
  process.exit(0)
}

// schema が設計と違えば 1 件も投入しない
await resolveCommentDataSourceSchema(client, dataSourceId)
const notifiedAt = new Date().toISOString()

const resolveParentPageId = (record: WordPressCommentRecord): string | null => {
  if (record.parentId === null) {
    return null
  }
  const parent = state[String(record.parentId)]
  if (!parent?.pageId) {
    throw Error(`親コメントが未投入です: ${record.id} -> ${record.parentId}`)
  }

  return parent.pageId
}

// pending のまま page ID を失った row は、作成済みの孤児が Notion に無いか legacy ID で探す
const findOrphanPageId = async (legacyCommentId: number): Promise<string | null> => {
  const response = await request(() =>
    client.dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        property: COMMENT_PROPERTIES.legacyCommentId,
        number: { equals: legacyCommentId },
      },
      page_size: 2,
      result_type: "page",
    }),
  )
  const pages = response.results.filter((result) => isFullPage(result) && !result.in_trash)
  if (1 < pages.length) {
    throw Error(`legacy-comment-id が重複しています: ${legacyCommentId}`)
  }

  return pages[0]?.id ?? null
}

const execute = async (operation: CommentImportOperation) => {
  if (operation.kind === "skip") {
    return
  }
  if (operation.kind === "trash") {
    await request(() => client.pages.update(createCommentTrashParameters(operation.pageId)))
    const previous = state[String(operation.legacyCommentId)]
    if (previous) {
      state[String(operation.legacyCommentId)] = { ...previous, status: "trashed" }
    }
    await writeState(state)
    return
  }
  const key = String(operation.record.id)
  const parentPageId = resolveParentPageId(operation.record)
  if (operation.kind === "update") {
    await request(() =>
      client.pages.update(
        createCommentUpdateParameters(operation.pageId, operation.record, parentPageId, notifiedAt),
      ),
    )
    state[key] = { pageId: operation.pageId, sourceHash: operation.sourceHash, status: "done" }
    await writeState(state)
    return
  }
  let pageId = operation.resume ? await findOrphanPageId(operation.record.id) : null
  if (pageId) {
    await request(() =>
      client.pages.update(
        createCommentUpdateParameters(pageId!, operation.record, parentPageId, notifiedAt),
      ),
    )
  } else {
    // 応答を受け取る前に落ちても「作ったかもしれない」と分かるよう、送信前に pending を残す
    state[key] = { pageId: null, sourceHash: operation.sourceHash, status: "pending" }
    await writeState(state)
    pageId = await request(
      async () => {
        const page = await client.pages.create(
          createCommentPageParameters(dataSourceId, operation.record, parentPageId, notifiedAt),
        )

        return page.id
      },
      // timeout などで応答を落としただけなら作成済みなので、再試行の前に探して二重作成を避ける
      { recover: () => findOrphanPageId(operation.record.id) },
    )
  }
  state[key] = { pageId, sourceHash: operation.sourceHash, status: "done" }
  await writeState(state)
}

let executed = 0
const executable = plan.operations.filter((operation) => operation.kind !== "skip")
const target = limit === null ? executable : executable.slice(0, limit)
for (const operation of target) {
  try {
    await execute(operation)
  } catch (err) {
    const id = "record" in operation ? operation.record.id : operation.legacyCommentId
    throw Error(`${operation.kind} に失敗しました: legacy-comment-id ${id}`, { cause: err })
  }
  executed += 1
  const id = "record" in operation ? operation.record.id : operation.legacyCommentId
  process.stdout.write(`${executed}/${target.length} ${operation.kind} ${id}\n`)
}

await writeState(state)
process.stdout.write(
  `実行: ${executed} 件 / skip: ${plan.counts.skip} 件${limit === null ? "" : `（--limit ${limit}）`}\n状態: ${statePath}\n`,
)
