import { isNotionAPIResponseError, isNotionClientError } from "shared/notion"

// Notion API のレートリミットは平均 3 リクエスト/秒
const REQUEST_INTERVAL = 400

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

interface RequestOptions<T> {
  // create のように「失敗したように見えて実は通っていた」があり得る送信では、再試行の前に結果を探す。
  // 見つかればそれを返し、二重に作らない
  recover?: () => Promise<T | null>
}

// upload.ts の request() と同じ間隔制御と再試行。comments 系の command で共有する
export const request = async <T>(
  send: () => Promise<T>,
  options: RequestOptions<T> = {},
): Promise<T> => {
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
      const recovered = options.recover ? await options.recover() : null
      if (recovered !== null) {
        return recovered
      }
    }
  }
}
