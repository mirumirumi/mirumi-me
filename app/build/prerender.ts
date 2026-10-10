import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { BuildPlan } from "shared/build-manifest"
import { BUILD_MANIFEST_FILES, parseBuildPlan } from "shared/build-manifest"

interface PrerenderConfiguration {
  buildPlan: BuildPlan | null
  prerenderRoutes: Array<string>
  isAllowedPrerenderRoute: (route: string) => boolean
}

export const createPrerenderConfiguration = (
  environment?: Record<string, string | undefined>,
): PrerenderConfiguration => {
  const resolvedEnvironment = environment ?? process.env
  const manifestDirectory = resolvedEnvironment.MIRUMI_BUILD_MANIFEST_DIR
  const requestedBuildMode = resolvedEnvironment.MIRUMI_BUILD_MODE
  if ((manifestDirectory && !requestedBuildMode) || (!manifestDirectory && requestedBuildMode)) {
    throw Error("MIRUMI_BUILD_MANIFEST_DIR と MIRUMI_BUILD_MODE は同時に指定してください")
  }

  const buildPlan = manifestDirectory
    ? parseBuildPlan(
        JSON.parse(readFileSync(join(manifestDirectory, BUILD_MANIFEST_FILES.plan), "utf8")),
      )
    : null
  if (buildPlan && buildPlan.mode !== requestedBuildMode) {
    throw Error("MIRUMI_BUILD_MODE が build plan と一致しません")
  }

  const prerenderRoutes = buildPlan?.routes ?? []
  const allowedPrerenderRoutes = new Set(
    prerenderRoutes.flatMap((route) => {
      return route !== "/" && route.endsWith("/") ? [route, route.slice(0, -1)] : [route]
    }),
  )
  const isAllowedPrerenderRoute = (route: string): boolean => {
    if (allowedPrerenderRoutes.has(route)) {
      return true
    }
    if (route.endsWith("/_payload.json")) {
      return allowedPrerenderRoutes.has(route.slice(0, -"_payload.json".length))
    }

    return false
  }

  return { buildPlan, prerenderRoutes, isAllowedPrerenderRoute }
}
