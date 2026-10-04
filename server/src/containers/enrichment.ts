import { z } from "zod"

import { type AppStoreCache, createAppStoreLookup, resolveAppStoreApp } from "shared/app-store"
import type { BookmarkCardData } from "shared/bookmark"
import { parseBookmarkCardData } from "shared/bookmark"
import type { ArticleContent } from "shared/content"
import {
  type ArticleEnrichment,
  createInternalBookmarkLookup,
  type InternalBookmarkSource,
  resolveArticleEnrichment as resolveSharedArticleEnrichment,
} from "shared/enrichment"
import { parseStaticXPostData } from "shared/x-post"

import type { Fetcher } from "../lib/types"
import { APP_STORE_CACHE_BRIDGE_URL } from "./app-store-cache-bridge"

export { createInternalBookmarkLookup, type InternalBookmarkSource }

// Worker 側は外部サイト 5 秒、xAI 45 秒で打ち切るため、その外側として少しだけ長く取る。
// ここを無期限にすると Worker の invocation が先に終わったときに Container が永久に待ち続ける
const BRIDGE_TIMEOUT_MS = 60_000

const fetchJson = async (url: URL, fetcher: Fetcher): Promise<unknown> => {
  const response = await fetcher(url, { signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS) })
  if (!response.ok) {
    await response.body?.cancel()
    throw Error(`Worker enrichment bridge が失敗しました: ${response.status}`)
  }

  return response.json()
}

const appStoreCacheValueSchema = z.strictObject({ value: z.string().nullable() })

// App Store の cache は Worker の KV に置き、Container からは橋渡しで読み書きだけを頼む
const createAppStoreCacheBridge = (fetcher: Fetcher): AppStoreCache => {
  return {
    get: async (key) => {
      const url = new URL(APP_STORE_CACHE_BRIDGE_URL)
      url.searchParams.set("key", key)

      return appStoreCacheValueSchema.parse(await fetchJson(url, fetcher)).value
    },
    put: async (key, value, options) => {
      const response = await fetcher(new URL(APP_STORE_CACHE_BRIDGE_URL), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value, expirationTtl: options?.expirationTtl }),
        signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
      })
      await response.body?.cancel()
      if (!response.ok) {
        throw Error(`App Store の cache を書けませんでした: ${response.status}`)
      }
    },
  }
}

export const resolveArticleEnrichment = async (
  article: ArticleContent,
  internalBookmarks: ReadonlyMap<string, BookmarkCardData>,
  fetcher: Fetcher = fetch,
): Promise<ArticleEnrichment> => {
  return resolveSharedArticleEnrichment(article, internalBookmarks, {
    externalBookmark: async (url) => {
      const bridge = new URL("http://bindings.internal/bookmark")
      bridge.searchParams.set("url", url)

      return parseBookmarkCardData(await fetchJson(bridge, fetcher))
    },
    xPost: async (postId) => {
      return parseStaticXPostData(
        await fetchJson(new URL(`/x-post/${postId}`, "http://bindings.internal"), fetcher),
      )
    },
    // iTunes は Container から引く。Worker から引くと Apple がほとんど 403 で断る
    appStore: async (url) => {
      return resolveAppStoreApp(url, createAppStoreCacheBridge(fetcher), {
        lookup: createAppStoreLookup((input, init) => fetcher(input, init)),
      })
    },
  })
}
