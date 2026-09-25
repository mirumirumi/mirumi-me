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
  })
}
