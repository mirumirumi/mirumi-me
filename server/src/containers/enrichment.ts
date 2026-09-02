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

const fetchJson = async (url: URL, fetcher: Fetcher): Promise<unknown> => {
  const response = await fetcher(url)
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
