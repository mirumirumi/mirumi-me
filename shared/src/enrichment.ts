import type { AppStoreApp } from "./app-store"
import type { BookmarkCardData } from "./bookmark"
import type { ArticleContent, ContentBlock, MediaBlock } from "./content"
import { parseShortcodeAttributes } from "./shortcode"
import { extractXPostId, type StaticXPostData } from "./x-post"

export interface InternalBookmarkSource {
  route: string
  title: string
  description: string | null
  label: string
}

export interface ArticleEnrichment {
  bookmarks: Readonly<Record<string, BookmarkCardData>>
  xPosts: Readonly<Record<string, StaticXPostData>>
  // アプリ紹介カードの `ios` の値（書いたまま）ごとの App Store の値
  apps: Readonly<Record<string, AppStoreApp>>
}

export interface ArticleEnrichmentResolvers {
  externalBookmark: (url: string) => Promise<BookmarkCardData>
  xPost: (postId: string) => Promise<StaticXPostData>
  appStore: (url: string) => Promise<AppStoreApp>
}

export const createInternalBookmarkLookup = (
  pages: Array<InternalBookmarkSource>,
): ReadonlyMap<string, BookmarkCardData> => {
  return new Map(
    pages.map((page) => [
      page.route,
      {
        kind: "internal" as const,
        url: new URL(page.route, "https://mirumi.me").href,
        title: page.title,
        description: page.description,
        // 内部ブログカードは thumbnail の有無にかかわらず画像を出さない（現行サイトの仕様）
        imageUrl: null,
        // 内部カードの footer はカテゴリ名なので favicon は使わない
        faviconUrl: null,
        label: page.label,
      },
    ]),
  )
}

const internalRoute = (value: string): string | null => {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.hostname !== "mirumi.me") {
      return null
    }
    const path = url.pathname === "/" ? "/" : `${url.pathname.replace(/\/$/, "")}/`

    return path
  } catch {
    return null
  }
}

const collectEnrichmentBlocks = (
  blocks: Array<ContentBlock>,
): Array<Omit<MediaBlock, "type"> & { type: "bookmark" | "embed" }> => {
  const found: Array<Omit<MediaBlock, "type"> & { type: "bookmark" | "embed" }> = []
  for (const block of blocks) {
    if (block.type === "bookmark" || block.type === "embed") {
      found.push(block as Omit<MediaBlock, "type"> & { type: "bookmark" | "embed" })
    }
    found.push(...collectEnrichmentBlocks(block.children))
  }

  return found
}

// 移行した 103 件は name と icon を焼き込んであるので引かない。新しく書く記事は `[app ios="…"]` だけでよい
const collectAppStoreUrls = (blocks: Array<ContentBlock>): Array<string> => {
  const urls: Array<string> = []
  for (const block of blocks) {
    if (block.type === "paragraph") {
      const text = block.richText
        .map((item) => item.content)
        .join("")
        .trim()
      if (/^\[app\b/.test(text)) {
        const attributes = parseShortcodeAttributes(text)
        if (attributes.ios && (!attributes.name || !attributes.icon)) {
          urls.push(attributes.ios)
        }
      }
    }
    urls.push(...collectAppStoreUrls(block.children))
  }

  return [...new Set(urls)]
}

export const resolveArticleEnrichment = async (
  article: ArticleContent,
  internalBookmarks: ReadonlyMap<string, BookmarkCardData>,
  resolvers: ArticleEnrichmentResolvers,
): Promise<ArticleEnrichment> => {
  const bookmarks: Record<string, BookmarkCardData> = {}
  const xPosts: Record<string, StaticXPostData> = {}
  const apps: Record<string, AppStoreApp> = {}
  for (const url of collectAppStoreUrls(article.blocks)) {
    try {
      apps[url] = await resolvers.appStore(url)
    } catch (err) {
      // 引けなかったアプリは render 側の警告に委ねる。原因はここでしか分からない
      console.warn(
        JSON.stringify({
          event: "app_store_unresolved",
          url,
          error: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }
  for (const block of collectEnrichmentBlocks(article.blocks)) {
    if (block.type === "bookmark") {
      const route = internalRoute(block.url)
      if (route) {
        const card = internalBookmarks.get(route)
        if (!card) {
          // 未公開 route への内部リンクで記事全体を落とさない。render 側が警告と代替表示を出す
          console.warn(
            JSON.stringify({ event: "internal_bookmark_unresolved", blockId: block.id, route }),
          )
          continue
        }
        bookmarks[block.id] = card
      } else {
        try {
          bookmarks[block.id] = await resolvers.externalBookmark(block.url)
        } catch (err) {
          // 外部サイト 1 つの不調で記事全体を落とさない。X post と同じく render 側の警告に委ねる
          console.warn(
            JSON.stringify({
              event: "external_bookmark_unresolved",
              blockId: block.id,
              url: block.url,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        }
      }
      continue
    }

    const postId = extractXPostId(block.url)
    if (postId) {
      try {
        xPosts[block.id] = await resolvers.xPost(postId)
      } catch (err) {
        // 解決できなかった X post は render 側で警告になるが、原因はここでしか分からない
        console.warn(
          JSON.stringify({
            event: "x_post_unresolved",
            blockId: block.id,
            postId,
            error: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    }
  }

  return { bookmarks, xPosts, apps }
}
