import type { BuildPage } from "shared/build-manifest"
import { createSearchText } from "shared/render"
import {
  parseSearchIndex,
  SEARCH_INDEX_KEY,
  type SearchIndex,
  type SearchIndexPost,
} from "shared/search"

import type { PublishMode, SiteDeploymentState } from "../lib/publishing"
import type { SiteObjectStore } from "./aws"

// 公開中の記事（固定ページは除く）だけを載せる。この job で作り直した記事は新しい本文で差し替え、
// 作り直さなかった記事（失敗した、snapshot が無かったなど）は前の値を引き継ぐ
export const updateSearchIndex = (
  current: SearchIndex | null,
  builtPages: Array<BuildPage>,
  state: SiteDeploymentState,
  updatedAt: string,
): SearchIndex => {
  const publishedPosts = new Map(
    Object.values(state.pages)
      .filter((page) => page.status === "published" && page.kind === "post")
      .map((page) => [page.pageId, page]),
  )
  const posts = new Map<string, SearchIndexPost>()
  for (const post of current?.posts ?? []) {
    if (publishedPosts.has(post.pageId)) {
      posts.set(post.pageId, post)
    }
  }
  for (const page of builtPages) {
    const deployed = publishedPosts.get(page.pageId)
    if (!deployed) {
      continue
    }
    posts.set(page.pageId, {
      pageId: page.pageId,
      slug: deployed.slug,
      title: deployed.title,
      publishedAt: deployed.publishedAt,
      updatedAt: deployed.updatedAt,
      text: createSearchText(page.contentHtml),
    })
  }

  return { schemaVersion: 1, updatedAt, posts: [...posts.values()] }
}

interface SearchIndexRefresh {
  mode: PublishMode
  store: Pick<SiteObjectStore, "get" | "put">
  builtPages: Array<BuildPage>
  state: SiteDeploymentState
  updatedAt: string
}

const loadSearchIndex = async (
  store: Pick<SiteObjectStore, "get">,
): Promise<SearchIndex | null> => {
  const body = await store.get(SEARCH_INDEX_KEY)

  return body ? parseSearchIndex(JSON.parse(new TextDecoder().decode(body))) : null
}

// 公開ボタンは今ある索引の差し替えだけをする。索引が無いか壊れているときに公開ボタンで作ると、
// その job の記事だけの索引になってしまうので、一から作るのは全記事を作り直す generate / bootstrap に任せる
export const refreshSearchIndex = async (refresh: SearchIndexRefresh) => {
  let current: SearchIndex | null
  try {
    current = await loadSearchIndex(refresh.store)
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "search_index_unreadable",
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    if (refresh.mode === "partial") {
      return
    }
    current = null
  }
  if (refresh.mode === "partial" && !current) {
    console.warn(JSON.stringify({ event: "search_index_missing" }))

    return
  }
  const next = updateSearchIndex(current, refresh.builtPages, refresh.state, refresh.updatedAt)
  await refresh.store.put(SEARCH_INDEX_KEY, {
    body: new TextEncoder().encode(JSON.stringify(next)),
    contentType: "application/json; charset=utf-8",
    cacheControl: "no-store",
  })
}
