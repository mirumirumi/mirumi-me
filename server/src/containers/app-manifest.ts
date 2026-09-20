import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { SiteObjectStore } from "./aws"

// Nuxt の app manifest（`_nuxt/builds/latest.json` と `builds/meta/<buildId>.json`）は、client が
// 遷移先の route を prerender 済みとみなして `_payload.json` を読むかどうかの根拠になる。
// partial publish の generate はその回に生成した route しか `prerendered` に載せないため、そのまま
// deploy すると他の記事へのサイト内遷移で payload を読まず、静的サイトにはない API を叩いて落ちる。
// 直前まで配信していた manifest との和集合を取り、サイト全体の route を載せてから deploy する

const LATEST_KEY = "_nuxt/builds/latest.json"
const metaKey = (id: string): string => {
  return `_nuxt/builds/meta/${id}.json`
}

interface AppManifest {
  id: string
  timestamp: number
  matcher: unknown
  prerendered: Array<string>
}

// Nuxt は "/" 以外を末尾スラッシュなしで持つ
const normalizeManifestRoute = (route: string): string => {
  return route === "/" ? route : route.replace(/\/$/, "")
}

export const mergePrerenderedRoutes = (
  current: Array<string>,
  previous: Array<string>,
  deletedRoutes: Array<string>,
): Array<string> => {
  const deleted = new Set(deletedRoutes.map(normalizeManifestRoute))
  const merged = new Set<string>()
  for (const route of [...current, ...previous]) {
    const normalized = normalizeManifestRoute(route)
    if (!deleted.has(normalized)) {
      merged.add(normalized)
    }
  }

  return [...merged]
}

const parseJson = (text: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(text)

    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    // 壊れた manifest は「前回なし」と同じ扱いにする
    return null
  }
}

const parseLatestId = (text: string): string | null => {
  const value = parseJson(text)

  return typeof value?.id === "string" ? value.id : null
}

const parseManifest = (text: string): AppManifest | null => {
  const value = parseJson(text)

  return typeof value?.id === "string" && Array.isArray(value.prerendered)
    ? (value as unknown as AppManifest)
    : null
}

const loadDeployedManifest = async (
  store: Pick<SiteObjectStore, "get">,
): Promise<AppManifest | null> => {
  const latest = await store.get(LATEST_KEY)
  if (!latest) {
    return null
  }
  const id = parseLatestId(new TextDecoder().decode(latest))
  if (!id) {
    return null
  }
  const meta = await store.get(metaKey(id))

  return meta ? parseManifest(new TextDecoder().decode(meta)) : null
}

export const completeAppManifest = async (
  outputDirectory: string,
  store: Pick<SiteObjectStore, "get">,
  deletedRoutes: Array<string>,
): Promise<void> => {
  const latestId = parseLatestId(await readFile(join(outputDirectory, LATEST_KEY), "utf8"))
  if (!latestId) {
    throw Error("generate が app manifest を出力していません")
  }
  const metaPath = join(outputDirectory, metaKey(latestId))
  const current = parseManifest(await readFile(metaPath, "utf8"))
  if (!current) {
    throw Error(`app manifest を読めません: ${metaPath}`)
  }
  const deployed = await loadDeployedManifest(store)
  if (!deployed) {
    return
  }
  const prerendered = mergePrerenderedRoutes(
    current.prerendered,
    deployed.prerendered,
    deletedRoutes,
  )
  await writeFile(metaPath, JSON.stringify({ ...current, prerendered }), "utf8")
}
