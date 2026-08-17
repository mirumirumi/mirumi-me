import { readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { AppendBlockChildrenResponse, BlockObjectRequest, Client } from "@notionhq/client"
import { collectPaginatedAPI } from "@notionhq/client"

import { createNotionClient, isNotionObjectNotFound } from "shared/notion"

import { planBlockBatches } from "./batch"
import { convertWordPressContent } from "./convert"
import { readContents } from "./read"
import type { NotionPageInput, UploadState } from "./types"

// Notion API のレートリミットは平均 3 リクエスト/秒
const REQUEST_INTERVAL = 400

const sourcePath = fileURLToPath(
  new URL("../blog-content-block-survey/contents.ndjson", import.meta.url),
)
const statePath = fileURLToPath(new URL("../upload-state.json", import.meta.url))

let nextRequestAt = 0

const request = async <T>(send: () => Promise<T>): Promise<T> => {
  const wait = nextRequestAt - Date.now()
  if (0 < wait) {
    await new Promise((resolve) => setTimeout(resolve, wait))
  }
  nextRequestAt = Date.now() + REQUEST_INTERVAL

  return send()
}

const readState = async (): Promise<UploadState> => {
  try {
    return JSON.parse(await readFile(statePath, "utf8")) as UploadState
  } catch {
    return {}
  }
}

const writeState = async (state: UploadState) => {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

// append のレスポンスにはそのリクエストで作った最上位のブロックしか含まれないため、
// それより深い親を指す経路は children の取得で辿る
const resolveBlockId = async (
  client: Client,
  results: AppendBlockChildrenResponse["results"],
  path: Array<number>,
): Promise<string> => {
  const [head, ...rest] = path
  const first = results[head ?? 0]
  if (!first) {
    throw Error(`切り離した子の親ブロックが見つかりません: ${path.join(".")}`)
  }

  let id = first.id
  for (const index of rest) {
    const children = await request(() =>
      collectPaginatedAPI(client.blocks.children.list, { block_id: id, page_size: 100 }),
    )
    const child = children[index]
    if (!child) {
      throw Error(`切り離した子の親ブロックが見つかりません: ${path.join(".")}`)
    }
    id = child.id
  }

  return id
}

const appendBlocks = async (
  client: Client,
  parentId: string,
  blocks: Array<BlockObjectRequest>,
) => {
  for (const batch of planBlockBatches(blocks)) {
    const response = await request(() =>
      client.blocks.children.append({ block_id: parentId, children: batch.children }),
    )
    for (const { path, children } of batch.deferred) {
      await appendBlocks(client, await resolveBlockId(client, response.results, path), children)
    }
  }
}

// ページを作った直後に落ちても孤児が残らないよう、本文を入れる前に ID を控える
const uploadPage = async (
  client: Client,
  input: NotionPageInput,
  onCreated: (pageId: string) => Promise<void>,
) => {
  const page = await request(() =>
    client.pages.create({ parent: input.parent, properties: input.properties }),
  )
  await onCreated(page.id)
  await appendBlocks(client, page.id, input.children)
}

const trashPage = async (client: Client, pageId: string) => {
  try {
    await request(() => client.pages.update({ page_id: pageId, in_trash: true }))
  } catch (err) {
    if (!isNotionObjectNotFound(err)) {
      throw err
    }
  }
}

const token = process.env.NOTION_TOKEN
if (!token) {
  throw Error("NOTION_TOKEN が設定されていません")
}

const client = createNotionClient(token)
const state = await readState()
const conversions = (await readContents(sourcePath)).map(convertWordPressContent)
let uploaded = 0
let skipped = 0

for (const input of conversions) {
  const key = String(input.sourceId)
  const previous = state[key]
  if (previous?.status === "done") {
    skipped += 1
    continue
  }
  // 途中で落ちたページは中身が欠けているため、作り直す前にゴミ箱へ入れる
  if (previous) {
    await trashPage(client, previous.pageId)
  }

  try {
    await uploadPage(client, input, async (pageId) => {
      state[key] = { pageId, slug: input.slug, status: "pending" }
      await writeState(state)
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw Error(`${input.slug} (${input.sourceId}) の投入に失敗しました: ${message}`)
  }

  const created = state[key]
  if (created) {
    state[key] = { ...created, status: "done" }
  }
  await writeState(state)
  uploaded += 1
  process.stdout.write(`${uploaded + skipped}/${conversions.length} ${input.slug}\n`)
}

await writeState(state)
process.stdout.write(`投入: ${uploaded} 件 / スキップ: ${skipped} 件\n状態: ${statePath}\n`)
