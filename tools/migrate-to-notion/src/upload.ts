import { readFile, rename, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import type { AppendBlockChildrenResponse, BlockObjectRequest, Client } from "@notionhq/client"
import { collectPaginatedAPI } from "@notionhq/client"

import {
  createNotionClient,
  isNotionAPIResponseError,
  isNotionClientError,
  isNotionObjectNotFound,
  isNotionValidationError,
} from "shared/notion"

import { planBlockBatches } from "./batch"
import { PAGES_DATA_SOURCE_ID, POSTS_DATA_SOURCE_ID } from "./config"
import { convertWordPressContent } from "./convert"
import { readContents } from "./read"
import { selectConversions, type UploadOptions } from "./select"
import type { NotionPageInput, UploadState } from "./types"

// Notion API のレートリミットは平均 3 リクエスト/秒
const REQUEST_INTERVAL = 400

const sourcePath = fileURLToPath(
  new URL("../blog-content-block-survey/contents.ndjson", import.meta.url),
)

const { values } = parseArgs({
  options: {
    slug: { type: "string", multiple: true, default: [] },
    limit: { type: "string" },
    redo: { type: "boolean", default: false },
    "posts-data-source": { type: "string", default: POSTS_DATA_SOURCE_ID },
    "pages-data-source": { type: "string", default: PAGES_DATA_SOURCE_ID },
    state: { type: "string", default: "upload-state.json" },
  },
})
const options: UploadOptions = {
  slugs: values.slug ?? [],
  limit: values.limit === undefined ? null : Number.parseInt(values.limit, 10),
  redo: values.redo ?? false,
  postsDataSourceId: values["posts-data-source"] ?? POSTS_DATA_SOURCE_ID,
  pagesDataSourceId: values["pages-data-source"] ?? PAGES_DATA_SOURCE_ID,
  statePath: values.state ?? "upload-state.json",
}
if (options.limit !== null && !Number.isInteger(options.limit)) {
  throw Error("--limit には整数を指定してください")
}
// 動作確認と本番で状態ファイルを分けられるようにする（混ざると本番分が投入済み扱いになる）
const statePath = fileURLToPath(new URL(`../${options.statePath}`, import.meta.url))

// SDK は POST / PATCH を 429 と 529 でしか再試行しないので、一時的な失敗はこちらで拾う。
// 内容が悪い系（validation_error など）は何度投げても通らないため対象にしない
const RETRIABLE = new Set([
  "rate_limited",
  "service_overload",
  "internal_server_error",
  "service_unavailable",
  "bad_gateway",
  "gateway_timeout",
  "conflict_error",
])
const MAX_ATTEMPTS = 4

const isRetriable = (err: unknown): boolean => {
  if (!isNotionClientError(err)) {
    return false
  }
  // ネットワーク断とクライアント側タイムアウトは APIResponseError にならない
  if (!isNotionAPIResponseError(err)) {
    return true
  }

  return RETRIABLE.has(err.code)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let nextRequestAt = 0

const request = async <T>(send: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    const wait = nextRequestAt - Date.now()
    if (0 < wait) {
      await sleep(wait)
    }
    nextRequestAt = Date.now() + REQUEST_INTERVAL

    try {
      return await send()
    } catch (err) {
      if (MAX_ATTEMPTS <= attempt || !isRetriable(err)) {
        throw err
      }
      const backoff = REQUEST_INTERVAL * 2 ** attempt
      process.stdout.write(`  再試行 ${attempt}/${MAX_ATTEMPTS - 1}（${backoff}ms 後）\n`)
      await sleep(backoff)
    }
  }
}

const readState = async (): Promise<UploadState> => {
  let raw: string
  try {
    raw = await readFile(statePath, "utf8")
  } catch (err) {
    // 初回はファイルがなくて当然。それ以外の読み取り失敗を握りつぶすと
    // 状態を失ったまま全件を作り直してしまうので、そのまま落とす
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {}
    }
    throw err
  }

  return JSON.parse(raw) as UploadState
}

// 書き込み中に落ちても壊れたファイルが残らないよう、一時ファイルへ書いてから置き換える
const writeState = async (state: UploadState) => {
  const temporaryPath = `${statePath}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`)
  await rename(temporaryPath, statePath)
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

// 既にゴミ箱に入っている／消えているページを掃除しようとして全体を止めたくないので、
// 「対象が見つからない」「もう捨てられている」系は成功扱いにする
const trashPage = async (client: Client, pageId: string) => {
  try {
    await request(() => client.pages.update({ page_id: pageId, in_trash: true }))
  } catch (err) {
    if (!isNotionObjectNotFound(err) && !isNotionValidationError(err)) {
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
const conversions = selectConversions(
  (await readContents(sourcePath)).map(convertWordPressContent),
  options,
)
process.stdout.write(
  [
    `対象: ${conversions.length} 件`,
    `投入先: posts=${options.postsDataSourceId} / pages=${options.pagesDataSourceId}`,
    `状態: ${statePath}`,
    options.redo ? "投入済みのページもゴミ箱へ入れて作り直します" : "",
    "",
  ].join("\n"),
)
let uploaded = 0
let skipped = 0

for (const input of conversions) {
  const key = String(input.sourceId)
  const previous = state[key]
  // --redo なら投入済みでも作り直す。古いページはこのあと必ずゴミ箱に入れるので重複しない
  if (previous?.status === "done" && !options.redo) {
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
    // Notion のエラーはどのブロックが原因かを body に持っているので、原因ごと引き継ぐ
    throw Error(`${input.slug} (${input.sourceId}) の投入に失敗しました`, { cause: err })
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
