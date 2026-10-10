import { readdir, readFile } from "node:fs/promises"
import { join, relative, sep } from "node:path"

import type { BuildPlan } from "shared/build-manifest"

import type { SiteObjectStore } from "./aws"

const IMMUTABLE_CACHE_CONTROL = "public,max-age=31536000,immutable"
const XML_FILES = [
  "feed.xml",
  "sitemap.xml",
  "sitemap-misc.xml",
  "post-sitemap.xml",
  "page-sitemap.xml",
]

const normalizeKey = (value: string): string => {
  return value.split(sep).join("/")
}

export const routeOutputKeys = (route: string): Array<string> => {
  const prefix = route === "/" ? "" : route.replace(/^\//, "")

  return [`${prefix}index.html`, `${prefix}_payload.json`]
}

export interface DeployOptions {
  // comment-refresh は集約 route も XML も更新しないため、生成物に XML があっても置かない
  xml: boolean
}

export const selectDeployKeys = (
  keys: Array<string>,
  plan: BuildPlan,
  options: DeployOptions = { xml: true },
): Array<string> => {
  if (plan.mode !== "partial") {
    return keys
  }

  const allowed = new Set(plan.routes.flatMap(routeOutputKeys))

  return keys.filter(
    (key) =>
      key.startsWith("_nuxt/") || (options.xml && XML_FILES.includes(key)) || allowed.has(key),
  )
}

export const cacheControlForKey = (key: string): string => {
  if (key.startsWith("_nuxt/") && !key.startsWith("_nuxt/builds/")) {
    return IMMUTABLE_CACHE_CONTROL
  }

  return "no-cache"
}

export const contentTypeForKey = (key: string): string => {
  if (key === "feed.xml") {
    return "application/rss+xml; charset=utf-8"
  }
  const extension = key.split(".").at(-1)?.toLowerCase()
  const types: Record<string, string> = {
    avif: "image/avif",
    css: "text/css; charset=utf-8",
    gif: "image/gif",
    html: "text/html; charset=utf-8",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "text/javascript; charset=utf-8",
    json: "application/json; charset=utf-8",
    map: "application/json; charset=utf-8",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    png: "image/png",
    svg: "image/svg+xml",
    ttf: "font/ttf",
    txt: "text/plain; charset=utf-8",
    webmanifest: "application/manifest+json",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
    xml: "application/xml; charset=utf-8",
  }

  return types[extension ?? ""] ?? "application/octet-stream"
}

const listFiles = async (directory: string): Promise<Array<string>> => {
  const files: Array<string> = []
  const walk = async (current: string) => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile()) {
        files.push(normalizeKey(relative(directory, path)))
      }
    }
  }
  await walk(directory)

  return files
}

const normalizedRoute = (route: string): string => {
  return route === "/" ? route : route.replace(/\/$/, "")
}

// CloudFront は wildcard の invalidation を同時に 15 件までしか受け付けない。
// exact path の上限は 3,000 件なので、絞る必要があるのは wildcard だけ
const MAX_WILDCARD_INVALIDATIONS = 15

// `/entries/*` は `/entries/page/2/*` の配下も含むため、親の wildcard があれば子の wildcard は要らない
const dropCoveredWildcards = (paths: Array<string>): Array<string> => {
  const prefixes = paths.filter((path) => path.endsWith("/*")).map((path) => path.slice(0, -2))

  return paths.filter((path) => {
    if (!path.endsWith("/*")) {
      return true
    }
    const own = path.slice(0, -2)

    return !prefixes.some((prefix) => prefix !== own && own.startsWith(`${prefix}/`))
  })
}

export const createInvalidationPaths = (
  plan: BuildPlan,
  deletedRoutes: Array<string>,
  includeXml: boolean,
): Array<string> => {
  if (plan.mode !== "partial") {
    return ["/*"]
  }

  const paths = new Set<string>()
  for (const route of [...plan.routes, ...deletedRoutes]) {
    const publicRoute = normalizedRoute(route.startsWith("/") ? route : `/${route}`)
    if (publicRoute === "/") {
      paths.add("/")
      paths.add("/_payload.json")
    } else {
      paths.add(publicRoute)
      paths.add(`${publicRoute}/*`)
    }
  }
  if (includeXml) {
    for (const filename of XML_FILES) {
      paths.add(`/${filename}`)
    }
  }
  // app manifest は immutable ではなく、古いものが CDN に残ると client が古い route 一覧で判定してしまう
  paths.add("/_nuxt/builds/*")

  const result = dropCoveredWildcards([...paths])
  if (MAX_WILDCARD_INVALIDATIONS < result.filter((path) => path.endsWith("/*")).length) {
    return ["/*"]
  }

  return result
}

export class SiteDeployer {
  readonly #store: SiteObjectStore

  constructor(store: SiteObjectStore) {
    this.#store = store
  }

  async deploy(
    outputDirectory: string,
    plan: BuildPlan,
    deletedRoutes: Array<string>,
    options: DeployOptions = { xml: true },
  ): Promise<Array<string>> {
    const keys = selectDeployKeys(await listFiles(outputDirectory), plan, options)
    const contentKeys = new Set(Object.keys(plan.pageIdsByRoute).flatMap(routeOutputKeys))
    const orderedKeys = keys.toSorted((left, right) => {
      return (
        this.#priority(left, contentKeys) - this.#priority(right, contentKeys) ||
        left.localeCompare(right)
      )
    })
    for (const key of orderedKeys) {
      await this.#store.put(key, {
        body: await readFile(join(outputDirectory, key)),
        contentType: contentTypeForKey(key),
        cacheControl: cacheControlForKey(key),
      })
    }
    for (const route of deletedRoutes) {
      for (const key of routeOutputKeys(route)) {
        await this.#store.delete(key)
      }
    }

    return createInvalidationPaths(
      plan,
      deletedRoutes,
      keys.some((key) => XML_FILES.includes(key)),
    )
  }

  #priority(key: string, contentKeys: Set<string>): number {
    if (key.startsWith("_nuxt/") && !key.startsWith("_nuxt/builds/")) {
      return 0
    }
    if (contentKeys.has(key)) {
      return key.endsWith("_payload.json") ? 1 : 2
    }
    if (key.startsWith("_nuxt/builds/")) {
      return 5
    }
    if (XML_FILES.includes(key)) {
      return 6
    }
    if (key.endsWith("_payload.json")) {
      return 3
    }
    if (key.endsWith("index.html")) {
      return 4
    }

    return 0
  }
}
