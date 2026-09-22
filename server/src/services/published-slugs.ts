import { z } from "zod"

import { type AwsSigningCredentials, signAwsRequest } from "../lib/aws-signature"
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

const CACHE_KEY = "published-post-slugs:v1"
const CACHE_TTL_SECONDS = 5 * 60
// cache に無い slug は公開直後の記事かもしれないので 1 回だけ index を読み直す。
// でたらめな slug の連打で S3 を叩き続けないよう、読み直しは 1 分に 1 回までにする
const REFRESH_INTERVAL_MS = 60 * 1_000

const cachedSlugsSchema = z.strictObject({
  version: z.literal(1),
  fetchedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  slugs: z.array(z.string()),
})

interface CachedSlugs {
  fetchedAt: string
  slugs: Set<string>
}

export class PublishedSlugResolver {
  readonly #repository: Pick<DeploymentIndexRepository, "load">
  readonly #cache: PublishedSlugCache | null
  readonly #now: () => Date

  constructor(options: PublishedSlugResolverOptions) {
    this.#repository = options.repository
    this.#cache = options.cache
    this.#now = options.now ?? (() => new Date())
  }

  async isPublishedPostSlug(slug: string): Promise<boolean> {
    const cached = await this.#readCache()
    if (cached?.slugs.has(slug)) {
      return true
    }
    const now = this.#now()
    if (cached && now.getTime() - Date.parse(cached.fetchedAt) < REFRESH_INTERVAL_MS) {
      return false
    }

    let slugs: Set<string>
    try {
      slugs = await this.#loadFromIndex()
    } catch (err) {
      // index を読めない間も cache がある限り受付は続ける。cache も無ければ受付側で 5xx にする
      if (!cached) {
        throw err
      }
      console.warn(
        JSON.stringify({
          event: "published_slugs_refresh_failed",
          error: err instanceof Error ? err.name : "UnknownError",
        }),
      )

      return false
    }
    await this.#writeCache({ fetchedAt: now.toISOString(), slugs })

    return slugs.has(slug)
  }

  async #loadFromIndex(): Promise<Set<string>> {
    const loaded = await this.#repository.load(false, "1970-01-01T00:00:00.000Z")

    return new Set(
      Object.values(loaded.state.pages)
        .filter((page) => page.kind === "post" && page.status === "published")
        .map((page) => page.slug),
    )
  }

  async #readCache(): Promise<CachedSlugs | null> {
    if (!this.#cache) {
      return null
    }
    try {
      const raw = await this.#cache.get(CACHE_KEY)
      if (!raw) {
        return null
      }
      const parsed = cachedSlugsSchema.safeParse(JSON.parse(raw))

      return parsed.success
        ? { fetchedAt: parsed.data.fetchedAt, slugs: new Set(parsed.data.slugs) }
        : null
    } catch {
      return null
    }
  }

  async #writeCache(value: CachedSlugs): Promise<void> {
    if (!this.#cache) {
      return
    }
    try {
      await this.#cache.put(
        CACHE_KEY,
        JSON.stringify({ version: 1, fetchedAt: value.fetchedAt, slugs: [...value.slugs] }),
        { expirationTtl: CACHE_TTL_SECONDS },
      )
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "published_slugs_cache_write_failed",
          error: err instanceof Error ? err.name : "UnknownError",
        }),
      )
    }
  }
}
