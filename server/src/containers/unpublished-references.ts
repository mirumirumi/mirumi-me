import type { BuildPage } from "shared/build-manifest"
import { findInternalBlogcardRoutes } from "shared/render"

import type {
  DeployedPage,
  SiteDeploymentState,
  UnpublishedPageReferences,
  UnpublishedPageReferrer,
} from "../lib/publishing"

// 公開中の記事は数百あり、1 本ずつ snapshot を読むと非公開の job が長引くので並べて読む。
// 並べすぎると Bun の node:https が止まりやすくなるので控えめにする（aws.ts の runAwsOperation）
const SNAPSHOT_READ_CONCURRENCY = 8
// 探すのはおまけなので、非公開そのものを待たせすぎない。S3 の読み込みが 1 回止まってやり直しても収まる長さにする
export const UNPUBLISHED_REFERENCE_SEARCH_TIMEOUT_MS = 3 * 60 * 1_000

export interface UnpublishedReferenceSearch {
  unpublished: Array<Pick<DeployedPage, "pageId" | "route">>
  // 非公開を反映したあとの index
  state: SiteDeploymentState
  // この job で作った page。snapshot を読みに行かず、作った本文で調べる
  builtPages: ReadonlyMap<string, BuildPage>
  loadSnapshot(pageId: string, contentHash: string): Promise<BuildPage | null>
  // 打ち切ったら、読み終わるのを待たずに失敗させ、残りの記事は読まない
  signal: AbortSignal
}

const readContentHtml = async (
  page: DeployedPage,
  search: UnpublishedReferenceSearch,
): Promise<string | null> => {
  const built = search.builtPages.get(page.pageId)
  if (built) {
    return built.contentHtml
  }
  try {
    const snapshot = await search.loadSnapshot(page.pageId, page.contentHash)
    if (!snapshot) {
      console.warn(
        JSON.stringify({ event: "unpublished_reference_check_skipped", pageId: page.pageId }),
      )
    }

    return snapshot?.contentHtml ?? null
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "unpublished_reference_check_skipped",
        pageId: page.pageId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )

    return null
  }
}

// 非公開にした page を内部ブログカードで指している、公開中の page を集める。見つかった page だけを返す
export const findUnpublishedReferences = async (
  search: UnpublishedReferenceSearch,
): Promise<Array<UnpublishedPageReferences>> => {
  const unpublishedIds = new Set(search.unpublished.map((page) => page.pageId))
  const targetRoutes = new Set(search.unpublished.map((page) => page.route))
  const candidates = Object.values(search.state.pages).filter((page) => {
    return page.status === "published" && !unpublishedIds.has(page.pageId)
  })
  const referrersByRoute = new Map<string, Array<UnpublishedPageReferrer>>()
  let cursor = 0
  const worker = async () => {
    while (!search.signal.aborted && cursor < candidates.length) {
      const page = candidates[cursor++]!
      const html = await readContentHtml(page, search)
      if (!html) {
        continue
      }
      for (const route of findInternalBlogcardRoutes(html)) {
        if (!targetRoutes.has(route)) {
          continue
        }
        referrersByRoute.set(route, [
          ...(referrersByRoute.get(route) ?? []),
          { pageId: page.pageId, title: page.title, slug: page.slug },
        ])
      }
    }
  }
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(Error("非公開にした記事を指す記事を、時間内に探しきれませんでした"))
    if (search.signal.aborted) {
      onAbort()
    }
    search.signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    await Promise.race([
      Promise.all(
        Array.from({ length: Math.min(SNAPSHOT_READ_CONCURRENCY, candidates.length) }, worker),
      ),
      aborted,
    ])
  } finally {
    if (onAbort) {
      search.signal.removeEventListener("abort", onAbort)
    }
  }

  return search.unpublished.flatMap((page): Array<UnpublishedPageReferences> => {
    const referrers = referrersByRoute.get(page.route)
    if (!referrers) {
      return []
    }

    return [
      {
        pageId: page.pageId,
        route: page.route,
        referrers: referrers.toSorted((a, b) => a.slug.localeCompare(b.slug)),
      },
    ]
  })
}
