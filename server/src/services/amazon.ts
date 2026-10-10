import { z } from "zod"

import type { AmazonCardError, AmazonCardItem, AmazonItemsResponse } from "shared/amazon"

import type { Fetcher } from "../lib/types"

const ITEM_CACHE_TTL_SECONDS = 86_400
const UNAVAILABLE_CACHE_TTL_SECONDS = 3_600
const TRANSIENT_ERROR_CACHE_TTL_SECONDS = 300
const TOKEN_REFRESH_MARGIN_SECONDS = 300
const FETCH_TIMEOUT_MS = 10_000
// KV の expirationTtl は 60 秒未満を受け付けない
const MIN_CACHE_TTL_SECONDS = 60
const AMAZON_ASIN = /^[A-Z0-9]{10}$/

const amazonCardImageSchema = z.strictObject({
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
const amazonCardItemSchema = z.strictObject({
  asin: z.string().regex(AMAZON_ASIN),
  title: z.string().min(1),
  detailPageUrl: z.url(),
  image: amazonCardImageSchema.nullable(),
  byLine: z.string().min(1).nullable(),
})
const amazonCardErrorSchema = z.strictObject({
  asin: z.string().regex(AMAZON_ASIN),
  code: z.string().min(1),
})
const cachedItemSchema = z.strictObject({
  version: z.literal(1),
  fetchedAt: z.iso.datetime(),
  item: amazonCardItemSchema,
})
const cachedErrorSchema = z.strictObject({
  version: z.literal(1),
  expiresAt: z.iso.datetime(),
  error: amazonCardErrorSchema,
})
const cachedTokenSchema = z.strictObject({
  version: z.literal(1),
  accessToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
})
const oauthResponseSchema = z.looseObject({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
  expires_in: z.number().int().positive(),
})
const displayValueSchema = z.looseObject({
  displayValue: z.string().min(1),
})
const contributorSchema = z.looseObject({
  name: z.string().min(1),
})
const rawAmazonItemSchema = z.looseObject({
  asin: z.string().regex(AMAZON_ASIN),
  detailPageURL: z.url(),
  images: z
    .looseObject({
      primary: z
        .looseObject({
          large: amazonCardImageSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  itemInfo: z.looseObject({
    title: displayValueSchema,
    byLineInfo: z
      .looseObject({
        brand: displayValueSchema.optional(),
        manufacturer: displayValueSchema.optional(),
        contributors: z.array(contributorSchema).optional(),
      })
      .optional(),
  }),
})
const itemResultsSchema = z.looseObject({
  items: z.array(rawAmazonItemSchema).optional(),
})
const amazonErrorSchema = z.looseObject({
  code: z.string().min(1),
  message: z.string(),
})
const getItemsResponseSchema = z.looseObject({
  itemResults: itemResultsSchema.optional(),
  itemsResult: itemResultsSchema.optional(),
  errors: z.array(amazonErrorSchema).optional(),
})

export interface AmazonCache {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options: { expirationTtl: number }): Promise<unknown>
}

export interface AmazonServiceConfig {
  credentialId: string
  credentialSecret: string
  credentialVersion: string
  marketplace: string
  partnerTag: string
}

interface AmazonServiceOptions {
  cache: AmazonCache
  config: AmazonServiceConfig
  fetcher: Fetcher
  now: () => number
}

interface CachedAmazonResult {
  item: AmazonCardItem | null
  error: AmazonCardError | null
}

interface RawAmazonError {
  code: string
  message: string
}

export class AmazonService {
  readonly #cache: AmazonCache
  readonly #config: AmazonServiceConfig
  readonly #fetcher: Fetcher
  readonly #now: () => number

  constructor(options: AmazonServiceOptions) {
    this.#cache = options.cache
    this.#config = options.config
    this.#fetcher = options.fetcher
    this.#now = options.now
  }

  static async createTokenCacheKey(config: AmazonServiceConfig): Promise<string> {
    const credentialHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(config.credentialId),
    )
    const hash = [...new Uint8Array(credentialHash)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("")

    return `amazon-token:v1:${config.credentialVersion}:${hash}`
  }

  async getItems(asins: Array<string>): Promise<AmazonItemsResponse> {
    this.#validateAsins(asins)

    const itemsByAsin = new Map<string, AmazonCardItem>()
    const errorsByAsin = new Map<string, AmazonCardError>()
    await Promise.all(
      asins.map(async (asin) => {
        const cached = await this.#loadCachedResult(asin)
        if (cached.item) {
          itemsByAsin.set(asin, cached.item)
        } else if (cached.error) {
          errorsByAsin.set(asin, cached.error)
        }
      }),
    )
    const missingAsins = asins.filter((asin) => {
      return !itemsByAsin.has(asin) && !errorsByAsin.has(asin)
    })
    if (0 < missingAsins.length) {
      const loaded = await this.#fetchItems(missingAsins)
      for (const item of loaded.items) {
        itemsByAsin.set(item.asin, item)
      }
      for (const error of loaded.errors) {
        errorsByAsin.set(error.asin, error)
      }
    }

    return {
      items: asins.flatMap((asin) => {
        const item = itemsByAsin.get(asin)

        return item ? [item] : []
      }),
      errors: asins.flatMap((asin) => {
        const error = errorsByAsin.get(asin)

        return error ? [error] : []
      }),
    }
  }

  #validateAsins(asins: Array<string>) {
    if (asins.length === 0 || 10 < asins.length) {
      throw Error("ASIN は 1〜10 件で指定してください")
    }
    if (new Set(asins).size !== asins.length || asins.some((asin) => !AMAZON_ASIN.test(asin))) {
      throw Error("ASIN の形式または重複が不正です")
    }
  }

  #createItemCacheKey(asin: string): string {
    return `amazon-item:v1:${this.#config.marketplace}:${asin}`
  }

  async #loadCachedResult(asin: string): Promise<CachedAmazonResult> {
    let value: string | null
    try {
      value = await this.#cache.get(this.#createItemCacheKey(asin))
    } catch {
      return { item: null, error: null }
    }
    if (!value) {
      return { item: null, error: null }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      return { item: null, error: null }
    }
    const cachedItem = cachedItemSchema.safeParse(parsed)
    if (cachedItem.success) {
      const age = this.#now() - Date.parse(cachedItem.data.fetchedAt)
      if (cachedItem.data.item.asin === asin && age < ITEM_CACHE_TTL_SECONDS * 1_000) {
        return { item: cachedItem.data.item, error: null }
      }

      return { item: null, error: null }
    }
    const cachedError = cachedErrorSchema.safeParse(parsed)
    if (
      cachedError.success &&
      cachedError.data.error.asin === asin &&
      this.#now() < Date.parse(cachedError.data.expiresAt)
    ) {
      return { item: null, error: cachedError.data.error }
    }

    return { item: null, error: null }
  }

  async #fetchItems(asins: Array<string>): Promise<AmazonItemsResponse> {
    let accessToken: string
    try {
      accessToken = await this.#getAccessToken()
    } catch {
      return this.#cacheUnavailable(asins)
    }

    let response: Response
    try {
      response = await this.#fetcher("https://creatorsapi.amazon/catalog/v1/getItems", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-marketplace": this.#config.marketplace,
        },
        body: JSON.stringify({
          itemIds: asins,
          itemIdType: "ASIN",
          marketplace: this.#config.marketplace,
          partnerTag: this.#config.partnerTag,
          resources: ["images.primary.large", "itemInfo.title", "itemInfo.byLineInfo"],
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "amazon_items_request_failed",
          error: err instanceof Error ? err.name : "UnknownError",
          message: err instanceof Error ? err.message.slice(0, 200) : null,
        }),
      )

      return this.#cacheUnavailable(asins)
    }
    if (!response.ok) {
      console.warn(
        JSON.stringify({ event: "amazon_items_response_failed", status: response.status }),
      )
      await response.body?.cancel()

      return this.#cacheUnavailable(asins)
    }

    let parsed: unknown
    try {
      parsed = await response.json()
    } catch {
      return this.#cacheUnavailable(asins)
    }
    const result = getItemsResponseSchema.safeParse(parsed)
    if (!result.success) {
      return this.#cacheUnavailable(asins)
    }

    const rawItems = result.data.itemResults?.items ?? result.data.itemsResult?.items ?? []
    const requested = new Set(asins)
    const items = rawItems
      .filter((item) => requested.has(item.asin))
      .map((item) => this.#normalizeItem(item))
    const errors = this.#normalizeErrors(asins, items, result.data.errors ?? [])
    await Promise.all([
      ...items.map((item) => this.#cacheItem(item)),
      ...errors.map((error) => this.#cacheError(error, UNAVAILABLE_CACHE_TTL_SECONDS)),
    ])

    return { items, errors }
  }

  #normalizeItem(item: z.infer<typeof rawAmazonItemSchema>): AmazonCardItem {
    const byLineInfo = item.itemInfo.byLineInfo
    const contributors = byLineInfo?.contributors?.map(({ name }) => name)

    return {
      asin: item.asin,
      title: item.itemInfo.title.displayValue,
      detailPageUrl: item.detailPageURL,
      image: item.images?.primary?.large ?? null,
      byLine:
        byLineInfo?.brand?.displayValue ??
        byLineInfo?.manufacturer?.displayValue ??
        (contributors && 0 < contributors.length ? contributors.join("、") : null),
    }
  }

  #normalizeErrors(
    asins: Array<string>,
    items: Array<AmazonCardItem>,
    errors: Array<RawAmazonError>,
  ): Array<AmazonCardError> {
    const received = new Set(items.map(({ asin }) => asin))
    const missing = asins.filter((asin) => !received.has(asin))
    // Creators API は error を ASIN ごとに返さないため message 内の ASIN で引き当てる。
    // 引き当てられなくても、欠けた ASIN と error がどちらも 1 件ならそれが原因とみなせる
    const soleError = missing.length === 1 && errors.length === 1 ? errors[0] : undefined

    return missing.map((asin) => {
      const error = errors.find(({ message }) => message.includes(asin)) ?? soleError

      return { asin, code: error?.code ?? "amazon-unavailable" }
    })
  }

  async #cacheItem(item: AmazonCardItem) {
    try {
      await this.#cache.put(
        this.#createItemCacheKey(item.asin),
        JSON.stringify({
          version: 1,
          fetchedAt: new Date(this.#now()).toISOString(),
          item,
        }),
        { expirationTtl: ITEM_CACHE_TTL_SECONDS },
      )
    } catch {
      return
    }
  }

  async #cacheError(error: AmazonCardError, expirationTtl: number) {
    try {
      await this.#cache.put(
        this.#createItemCacheKey(error.asin),
        JSON.stringify({
          version: 1,
          expiresAt: new Date(this.#now() + expirationTtl * 1_000).toISOString(),
          error,
        }),
        { expirationTtl },
      )
    } catch {
      return
    }
  }

  async #cacheUnavailable(asins: Array<string>): Promise<AmazonItemsResponse> {
    const response = this.#unavailable(asins)
    await Promise.all(
      response.errors.map((error) => this.#cacheError(error, TRANSIENT_ERROR_CACHE_TTL_SECONDS)),
    )

    return response
  }

  async #getAccessToken(): Promise<string> {
    const cacheKey = await AmazonService.createTokenCacheKey(this.#config)
    let cachedValue: string | null = null
    try {
      cachedValue = await this.#cache.get(cacheKey)
    } catch {
      cachedValue = null
    }
    if (cachedValue) {
      try {
        const cached = cachedTokenSchema.safeParse(JSON.parse(cachedValue))
        if (
          cached.success &&
          this.#now() + TOKEN_REFRESH_MARGIN_SECONDS * 1_000 < Date.parse(cached.data.expiresAt)
        ) {
          return cached.data.accessToken
        }
      } catch {
        cachedValue = null
      }
    }

    let response: Response
    try {
      response = await this.#fetcher(this.#getTokenEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: this.#config.credentialId,
          client_secret: this.#config.credentialSecret,
          scope: "creatorsapi::default",
        }),
      })
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "amazon_oauth_request_failed",
          error: err instanceof Error ? err.name : "UnknownError",
          message: err instanceof Error ? err.message.slice(0, 200) : null,
        }),
      )

      throw Error("Amazon OAuth token を取得できませんでした")
    }
    if (!response.ok) {
      console.warn(
        JSON.stringify({ event: "amazon_oauth_response_failed", status: response.status }),
      )
      await response.body?.cancel()
      throw Error("Amazon OAuth token を取得できませんでした")
    }

    const token = oauthResponseSchema.parse(await response.json())
    const expirationTtl = Math.max(
      MIN_CACHE_TTL_SECONDS,
      token.expires_in - TOKEN_REFRESH_MARGIN_SECONDS,
    )
    try {
      await this.#cache.put(
        cacheKey,
        JSON.stringify({
          version: 1,
          accessToken: token.access_token,
          expiresAt: new Date(this.#now() + token.expires_in * 1_000).toISOString(),
        }),
        { expirationTtl },
      )
    } catch {
      return token.access_token
    }

    return token.access_token
  }

  #getTokenEndpoint(): string {
    const endpoints: Record<string, string> = {
      "3.1": "https://api.amazon.com/auth/o2/token",
      "3.2": "https://api.amazon.co.uk/auth/o2/token",
      "3.3": "https://api.amazon.co.jp/auth/o2/token",
    }
    const endpoint = endpoints[this.#config.credentialVersion]
    if (!endpoint) {
      throw Error("Amazon credential version が不正です")
    }

    return endpoint
  }

  #unavailable(asins: Array<string>): AmazonItemsResponse {
    return {
      items: [],
      errors: asins.map((asin) => ({ asin, code: "amazon-unavailable" })),
    }
  }
}
