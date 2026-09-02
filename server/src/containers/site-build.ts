import type { BuildPageSummary, BuildPlan } from "shared/build-manifest"

import type { PreparedPageRevision, PublishMode } from "../lib/publishing"

const POSTS_PER_PAGE = 13
const FULL_STATIC_ROUTES = ["/contact/", "/s/"]

interface CreateSiteBuildPlanInput {
  workflowId: string
  mode: PublishMode
  generatedAt: string
  summaries: Array<BuildPageSummary>
  changedPages: Array<PreparedPageRevision>
}

const paginatedRoutes = (baseRoute: string, count: number): Array<string> => {
  if (count === 0) {
    return [baseRoute, `${baseRoute}page/1/`]
  }
  const pageCount = Math.ceil(count / POSTS_PER_PAGE)

  return [
    baseRoute,
    ...Array.from({ length: pageCount }, (_, index) => `${baseRoute}page/${index + 1}/`),
  ]
}

export const createEntriesRoutes = (summaries: Array<BuildPageSummary>): Array<string> => {
  return paginatedRoutes("/entries/", summaries.length)
}

const aggregateRoutes = (summaries: Array<BuildPageSummary>): Array<string> => {
  const categoryCounts = new Map<string, number>()
  for (const summary of summaries) {
    categoryCounts.set(summary.category.slug, (categoryCounts.get(summary.category.slug) ?? 0) + 1)
  }

  return [
    "/",
    ...createEntriesRoutes(summaries),
    "/entry-list/",
    ...[...categoryCounts]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([slug, count]) => paginatedRoutes(`/category/${slug}/`, count)),
  ]
}

export const findRemovedAggregateRoutes = (
  previous: Array<BuildPageSummary>,
  next: Array<BuildPageSummary>,
): Array<string> => {
  const nextRoutes = new Set(aggregateRoutes(next))

  return aggregateRoutes(previous).filter((route) => !nextRoutes.has(route))
}

export const findUnpublishedContentRoutes = (pages: Array<PreparedPageRevision>): Array<string> => {
  return pages.flatMap((page): Array<string> => {
    if (page.action !== "unpublish" || !page.route) {
      return []
    }

    return [page.route]
  })
}

export const createSiteBuildPlan = ({
  workflowId,
  mode,
  generatedAt,
  summaries,
  changedPages,
}: CreateSiteBuildPlanInput): BuildPlan => {
  const contentRoutes = changedPages.flatMap((page): Array<string> => {
    if (page.action !== "publish" || !page.route) {
      return []
    }

    return [page.route]
  })
  const hasPostChange = changedPages.some(({ revision }) => revision.kind === "post")
  const routes = [
    ...contentRoutes,
    ...(mode !== "partial" || hasPostChange ? aggregateRoutes(summaries) : []),
    ...(mode === "full" || mode === "bootstrap" ? FULL_STATIC_ROUTES : []),
  ]
  const uniqueRoutes = [...new Set(routes)]
  const pageIdsByRoute = Object.fromEntries(
    changedPages.flatMap((page): Array<[string, string]> => {
      if (page.action !== "publish" || !page.route) {
        return []
      }

      return [[page.route, page.revision.pageId]]
    }),
  )

  return {
    schemaVersion: 1,
    workflowId,
    mode,
    generatedAt,
    routes: uniqueRoutes,
    pageIdsByRoute,
  }
}
