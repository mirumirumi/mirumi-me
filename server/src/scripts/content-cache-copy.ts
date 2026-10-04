import { z } from "zod"

// dev の CONTENT_CACHE から prd へ写すもの。key に環境は入っていないので dev の値をそのまま使える。
// 空のまま bootstrap すると、X ポストを xAI で解決し直すことになる（費用がかかり、まれに失敗して公開が止まる）
export const CONTENT_CACHE_COPY_PREFIXES = ["x-post:v4:", "bookmark:v1:"] as const

// KV は 60 秒より先の有効期限しか受け付けない。写しているあいだに切れないよう余裕を持たせる
const MIN_REMAINING_SECONDS = 120

export interface KvKey {
  name: string
  // UNIX 秒。期限のない key は null
  expiration: number | null
  metadata: unknown
}

export interface ContentCacheCopyPlan {
  copy: Array<KvKey>
  // prd で解決し直した新しい値を、古い dev の値で戻さないため上書きしない
  existing: Array<string>
  expiring: Array<string>
}

export interface BulkPutEntry {
  key: string
  value: string
  expiration?: number
  metadata?: unknown
}

const kvKeyListSchema = z.array(
  z.object({
    name: z.string().min(1),
    expiration: z.number().int().positive().optional(),
    metadata: z.unknown().optional(),
  }),
)

export const parseKvKeyList = (value: unknown): Array<KvKey> => {
  return kvKeyListSchema.parse(value).map((key) => ({
    name: key.name,
    expiration: key.expiration ?? null,
    metadata: key.metadata ?? null,
  }))
}

export const planContentCacheCopy = (
  sourceKeys: Array<KvKey>,
  targetKeyNames: ReadonlySet<string>,
  nowSeconds: number,
): ContentCacheCopyPlan => {
  const plan: ContentCacheCopyPlan = { copy: [], existing: [], expiring: [] }
  for (const key of sourceKeys) {
    if (targetKeyNames.has(key.name)) {
      plan.existing.push(key.name)
    } else if (key.expiration !== null && key.expiration < nowSeconds + MIN_REMAINING_SECONDS) {
      plan.expiring.push(key.name)
    } else {
      plan.copy.push(key)
    }
  }

  return plan
}

const bulkGetOutputSchema = z.record(z.string(), z.string())

// `wrangler kv bulk get` は open beta で、stdout の先頭に注意書きを出してから JSON を出す
export const parseBulkGetOutput = (stdout: string): Record<string, string> => {
  const start = stdout.search(/^\{/m)
  if (start < 0) {
    throw Error("wrangler kv bulk get の出力に JSON がありません")
  }

  return bulkGetOutputSchema.parse(JSON.parse(stdout.slice(start)))
}

export const createBulkPutEntries = (
  keys: Array<KvKey>,
  values: Readonly<Record<string, string>>,
): Array<BulkPutEntry> => {
  const missing = keys.filter((key) => values[key.name] === undefined).map((key) => key.name)
  if (0 < missing.length) {
    throw Error(`値を取れなかった key があります: ${missing.join(", ")}`)
  }

  return keys.map((key) => ({
    key: key.name,
    value: values[key.name]!,
    ...(key.expiration === null ? {} : { expiration: key.expiration }),
    ...(key.metadata === null ? {} : { metadata: key.metadata }),
  }))
}
