import {
  type PreparedSearchPost,
  parseSearchIndex,
  prepareSearchPosts,
  SEARCH_INDEX_KEY,
  type SearchIndex,
} from "shared/search"

import { type AwsSigningCredentials, signAwsRequest } from "../lib/aws-signature"
import type { Fetcher } from "../lib/types"

// isolate のメモリに持った索引を、この間隔ごとに ETag つきの条件つき GET で確かめる。
// isolate がどれだけ生き残るかは決まっていないので、公開のあと古い結果を返しうる時間に上限をつけるためのもの。
// 変わっていなければ 304 の小さい応答 1 回で済み、検索 1 回の待ち時間にもほぼ響かない。短くしても、
// 公開した直後に検索することはまれなので得るものが少なく、長くすると長生きした isolate で古い結果が長引く
export const SEARCH_INDEX_REFRESH_INTERVAL_MS = 60 * 1_000

export type SearchIndexLoadResult =
  | { status: "loaded"; etag: string; index: SearchIndex }
  | { status: "unchanged" }
  | { status: "missing" }

export interface SearchIndexSource {
  load(etag: string | null): Promise<SearchIndexLoadResult>
}

interface SignedS3SearchIndexSourceOptions {
  fetcher: Fetcher
  region: string
  bucket: string
  credentials: AwsSigningCredentials
}

export class SignedS3SearchIndexSource implements SearchIndexSource {
  readonly #options: SignedS3SearchIndexSourceOptions

  constructor(options: SignedS3SearchIndexSourceOptions) {
    this.#options = options
  }

  async load(etag: string | null): Promise<SearchIndexLoadResult> {
    const { fetcher, region, bucket, credentials } = this.#options
    const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${SEARCH_INDEX_KEY}`)
    const headers = await signAwsRequest(
      { method: "GET", url, headers: etag ? { "If-None-Match": etag } : {}, body: null },
      { region, service: "s3", credentials },
    )
    const response = await fetcher(url, { method: "GET", headers })
    if (response.status === 304) {
      await response.body?.cancel()

      return { status: "unchanged" }
    }
    if (response.status === 404) {
      await response.body?.cancel()

      return { status: "missing" }
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`検索の索引の取得に失敗しました: ${response.status}`)
    }
    const responseEtag = response.headers.get("ETag")
    if (!responseEtag) {
      await response.body?.cancel()
      throw Error("検索の索引の ETag がありません")
    }

    return { status: "loaded", etag: responseEtag, index: parseSearchIndex(await response.json()) }
  }
}

interface SearchIndexCacheOptions {
  source: SearchIndexSource
  now?: () => number
}

interface CachedSearchIndex {
  etag: string | null
  posts: Array<PreparedSearchPost>
  checkedAt: number
}

export class SearchIndexCache {
  readonly #source: SearchIndexSource
  readonly #now: () => number
  #cached: CachedSearchIndex | null = null
  #refreshing: Promise<Array<PreparedSearchPost>> | null = null

  constructor(options: SearchIndexCacheOptions) {
    this.#source = options.source
    this.#now = options.now ?? (() => Date.now())
  }

  async posts(): Promise<Array<PreparedSearchPost>> {
    const cached = this.#cached
    if (cached && this.#now() - cached.checkedAt < SEARCH_INDEX_REFRESH_INTERVAL_MS) {
      return cached.posts
    }
    // isolate が立ち上がった直後に検索が重なっても、S3 を読むのは 1 回にする
    if (!this.#refreshing) {
      this.#refreshing = this.#refresh().finally(() => {
        this.#refreshing = null
      })
    }

    return this.#refreshing
  }

  async #refresh(): Promise<Array<PreparedSearchPost>> {
    const cached = this.#cached
    let result: SearchIndexLoadResult
    try {
      result = await this.#source.load(cached?.etag ?? null)
    } catch (err) {
      // 持っている索引があれば、古くても答え続ける。次に確かめるのは間隔のあと
      if (!cached) {
        throw err
      }
      console.warn(
        JSON.stringify({
          event: "search_index_refresh_failed",
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      cached.checkedAt = this.#now()

      return cached.posts
    }
    if (result.status === "unchanged" && cached) {
      cached.checkedAt = this.#now()

      return cached.posts
    }
    if (result.status === "loaded") {
      this.#cached = {
        etag: result.etag,
        posts: prepareSearchPosts(result.index.posts),
        checkedAt: this.#now(),
      }

      return this.#cached.posts
    }
    // 新しいコードで最初の generate が終わるまでは索引がない。そのあいだは 0 件として答える
    console.warn(JSON.stringify({ event: "search_index_missing" }))
    this.#cached = { etag: null, posts: [], checkedAt: this.#now() }

    return []
  }
}
