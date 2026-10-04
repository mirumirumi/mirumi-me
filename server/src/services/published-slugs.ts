import { z } from "zod"

import { type AwsSigningCredentials, signAwsRequest } from "../lib/aws-signature"
import type { DeployedPage } from "../lib/publishing"
import type { Fetcher } from "../lib/types"
import {
  type DeploymentIndexRepository,
  type DeploymentIndexStore,
  type DeploymentIndexStoredObject,
} from "../repositories/deployment-index"

interface SignedS3StoreOptions {
  fetcher: Fetcher
  region: string
  bucket: string
  credentials: AwsSigningCredentials
}

// Worker から publish index を読むための最小の S3 client。書き込みは Container の直列 job だけが行う
export class SignedS3DeploymentIndexStore implements DeploymentIndexStore {
  readonly #options: SignedS3StoreOptions

  constructor(options: SignedS3StoreOptions) {
    this.#options = options
  }

  async get(key: string): Promise<DeploymentIndexStoredObject | null> {
    const { fetcher, region, bucket, credentials } = this.#options
    const url = new URL(`https://${bucket}.s3.${region}.amazonaws.com/${key}`)
    const headers = await signAwsRequest(
      { method: "GET", url, headers: {}, body: null },
      { region, service: "s3", credentials },
    )
    const response = await fetcher(url, { method: "GET", headers })
    if (response.status === 404) {
      await response.body?.cancel()

      return null
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`publish index の取得に失敗しました: ${response.status}`)
    }
    const etag = response.headers.get("ETag")
    if (!etag) {
      await response.body?.cancel()
      throw Error("publish index の ETag がありません")
    }

    return { body: await response.text(), etag }
  }

  async put(): Promise<string> {
    throw Error("Worker から publish index は書き込みません")
  }
}

export interface PublishedSlugCache {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>
}

interface PublishedSlugResolverOptions {
  repository: Pick<DeploymentIndexRepository, "load">
  cache: PublishedSlugCache | null
  now?: () => Date
}

interface PublishedValueSetConfig {
  cacheKey: string
  // 公開中の page から集める値。対象でない page は null
  select(page: DeployedPage): string | null
  refreshFailedEvent: string
  cacheWriteFailedEvent: string
}

const CACHE_TTL_SECONDS = 5 * 60
// cache に無い値は公開直後の page かもしれないので 1 回だけ index を読み直す。
// でたらめな値の連打で S3 を叩き続けないよう、読み直しは 1 分に 1 回までにする
const REFRESH_INTERVAL_MS = 60 * 1_000

const cachedValuesSchema = z.strictObject({
  version: z.literal(1),
  fetchedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  values: z.array(z.string()),
})

interface CachedValues {
  fetchedAt: string
  values: Set<string>
}

// publish index から公開中の page の値（記事の slug、route など）を集め、KV に短く cache して照合する
class PublishedValueSet {
  readonly #repository: Pick<DeploymentIndexRepository, "load">
  readonly #cache: PublishedSlugCache | null
  readonly #now: () => Date
  readonly #config: PublishedValueSetConfig

  constructor(options: PublishedSlugResolverOptions, config: PublishedValueSetConfig) {
    this.#repository = options.repository
    this.#cache = options.cache
    this.#now = options.now ?? (() => new Date())
    this.#config = config
  }

  async has(value: string): Promise<boolean> {
    const cached = await this.#readCache()
    if (cached?.values.has(value)) {
      return true
    }
    const now = this.#now()
    if (cached && now.getTime() - Date.parse(cached.fetchedAt) < REFRESH_INTERVAL_MS) {
      return false
    }

    let values: Set<string>
    try {
      values = await this.#loadFromIndex()
    } catch (err) {
      // index を読めない間も cache がある限り受付は続ける。cache も無ければ受付側で 5xx にする
      if (!cached) {
        throw err
      }
      console.warn(
        JSON.stringify({
          event: this.#config.refreshFailedEvent,
          error: err instanceof Error ? err.name : "UnknownError",
        }),
      )

      return false
    }
    await this.#writeCache({ fetchedAt: now.toISOString(), values })

    return values.has(value)
  }

  async #loadFromIndex(): Promise<Set<string>> {
    const loaded = await this.#repository.load(false, "1970-01-01T00:00:00.000Z")

    return new Set(
      Object.values(loaded.state.pages).flatMap((page) => {
        const value = page.status === "published" ? this.#config.select(page) : null

        return value === null ? [] : [value]
      }),
    )
  }

  async #readCache(): Promise<CachedValues | null> {
    if (!this.#cache) {
      return null
    }
    try {
      const raw = await this.#cache.get(this.#config.cacheKey)
      if (!raw) {
        return null
      }
      const parsed = cachedValuesSchema.safeParse(JSON.parse(raw))

      return parsed.success
        ? { fetchedAt: parsed.data.fetchedAt, values: new Set(parsed.data.values) }
        : null
    } catch {
      return null
    }
  }

  async #writeCache(value: CachedValues): Promise<void> {
    if (!this.#cache) {
      return
    }
    try {
      await this.#cache.put(
        this.#config.cacheKey,
        JSON.stringify({ version: 1, fetchedAt: value.fetchedAt, values: [...value.values] }),
        { expirationTtl: CACHE_TTL_SECONDS },
      )
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: this.#config.cacheWriteFailedEvent,
          error: err instanceof Error ? err.name : "UnknownError",
        }),
      )
    }
  }
}

// コメントの受付で、公開中の記事の slug かを確かめる
export class PublishedSlugResolver {
  readonly #values: PublishedValueSet

  constructor(options: PublishedSlugResolverOptions) {
    this.#values = new PublishedValueSet(options, {
      cacheKey: "published-post-slugs:v2",
      select: (page) => (page.kind === "post" ? page.slug : null),
      refreshFailedEvent: "published_slugs_refresh_failed",
      cacheWriteFailedEvent: "published_slugs_cache_write_failed",
    })
  }

  async isPublishedPostSlug(slug: string): Promise<boolean> {
    return this.#values.has(slug)
  }
}

// PV の受付で、公開中のページ（記事と固定ページ）の route かを確かめる
export class PublishedRouteResolver {
  readonly #values: PublishedValueSet

  constructor(options: PublishedSlugResolverOptions) {
    this.#values = new PublishedValueSet(options, {
      cacheKey: "published-routes:v1",
      select: (page) => page.route,
      refreshFailedEvent: "published_routes_refresh_failed",
      cacheWriteFailedEvent: "published_routes_cache_write_failed",
    })
  }

  async isPublishedRoute(route: string): Promise<boolean> {
    return this.#values.has(route)
  }
}
