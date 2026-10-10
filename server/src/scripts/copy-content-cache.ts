import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"

import {
  CONTENT_CACHE_COPY_PREFIXES,
  createBulkPutEntries,
  type KvKey,
  parseBulkGetOutput,
  parseKvKeyList,
  planContentCacheCopy,
} from "./content-cache-copy"
import { type Env, WRANGLER_CONFIG } from "./wrangler"

// 本番リリースの準備で、dev の CONTENT_CACHE にある X ポストとブログカードの cache を prd へ写す。
// namespace は wrangler.jsonc の CONTENT_CACHE から引くので、prd の id を入れてから流す
const usage = "usage: bun server/src/scripts/copy-content-cache.ts [--dry-run]"

// KV の bulk get は 1 回 100 key まで
const BULK_GET_CHUNK_SIZE = 100

const listKeys = async (env: Env, prefix: string): Promise<Array<KvKey>> => {
  const output =
    await $`bunx wrangler kv key list --binding CONTENT_CACHE --env ${env} --remote --prefix ${prefix} --config ${WRANGLER_CONFIG}`
      .quiet()
      .text()

  return parseKvKeyList(JSON.parse(output))
}

const listTargetKeyNames = async (dryRun: boolean): Promise<Set<string>> => {
  try {
    const keys = await Promise.all(
      CONTENT_CACHE_COPY_PREFIXES.map((prefix) => listKeys("prd", prefix)),
    )

    return new Set(keys.flat().map((key) => key.name))
  } catch (err) {
    if (!dryRun) {
      throw err
    }
    console.warn(
      "prd の CONTENT_CACHE を読めませんでした（namespace の id がまだない、など）。空として数えます",
    )

    return new Set()
  }
}

const getValues = async (
  keys: Array<KvKey>,
  directory: string,
): Promise<Record<string, string>> => {
  const values: Record<string, string> = {}
  for (let start = 0; start < keys.length; start += BULK_GET_CHUNK_SIZE) {
    const file = join(directory, `keys-${start}.json`)
    await writeFile(
      file,
      JSON.stringify(keys.slice(start, start + BULK_GET_CHUNK_SIZE).map((key) => key.name)),
    )
    const output =
      await $`bunx wrangler kv bulk get ${file} --binding CONTENT_CACHE --env dev --remote --config ${WRANGLER_CONFIG}`
        .quiet()
        .text()
    Object.assign(values, parseBulkGetOutput(output))
  }

  return values
}

const confirmProduction = (count: number): boolean => {
  const answer = prompt(
    `prd の CONTENT_CACHE に ${count} 件を書きます。続けるなら yes と入力してください:`,
  )

  return answer === "yes"
}

const main = async () => {
  const args = Bun.argv.slice(2)
  if (args.some((arg) => arg !== "--dry-run")) {
    throw Error(usage)
  }
  const dryRun = args.includes("--dry-run")
  const sourceKeys = (
    await Promise.all(CONTENT_CACHE_COPY_PREFIXES.map((prefix) => listKeys("dev", prefix)))
  ).flat()
  const plan = planContentCacheCopy(
    sourceKeys,
    await listTargetKeyNames(dryRun),
    Math.floor(Date.now() / 1_000),
  )
  console.log(
    `dev: ${sourceKeys.length} 件 / 写す: ${plan.copy.length} 件 / prd にすでにある: ${plan.existing.length} 件 / 期限が近い: ${plan.expiring.length} 件`,
  )
  if (dryRun || plan.copy.length === 0) {
    return
  }
  if (!confirmProduction(plan.copy.length)) {
    throw Error("中止しました")
  }

  const directory = await mkdtemp(join(tmpdir(), "copy-content-cache-"))
  try {
    const entries = createBulkPutEntries(plan.copy, await getValues(plan.copy, directory))
    const file = join(directory, "entries.json")
    await writeFile(file, JSON.stringify(entries))
    await $`bunx wrangler kv bulk put ${file} --binding CONTENT_CACHE --env prd --remote --config ${WRANGLER_CONFIG}`
    console.log(`prd へ ${entries.length} 件を写しました`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

await main()
