import { createHash } from "node:crypto"

import type { BuildPage } from "shared/build-manifest"
import { parseBuildPage } from "shared/build-manifest"

import { PUBLISHED_PAGES_PREFIX, publishedPageSnapshotKey } from "../lib/published-pages"
import type { SiteObjectStore } from "./aws"

export { PUBLISHED_PAGES_PREFIX, publishedPageSnapshotKey }

// 公開済み BuildPage の content-addressed snapshot。comment-refresh が Notion の未公開編集を混ぜずに
// 「いま配信中の記事」を再 build するための派生物で、Notion の代替正本ではない。
// `_internal/*` は CloudFront から取得できないため、古い snapshot は削除しない
const MAX_SNAPSHOT_BYTES = 4 * 1_024 * 1_024

export const createBuildPageContentHash = (page: BuildPage): string => {
  return createHash("sha256").update(JSON.stringify(page)).digest("hex")
}

export class PublishedPageSnapshotStore {
  readonly #store: Pick<SiteObjectStore, "get" | "put">

  constructor(store: Pick<SiteObjectStore, "get" | "put">) {
    this.#store = store
  }

  async save(page: BuildPage, contentHash: string): Promise<void> {
    await this.#store.put(publishedPageSnapshotKey(page.pageId, contentHash), {
      body: new TextEncoder().encode(JSON.stringify(page)),
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store",
    })
  }

  async load(pageId: string, contentHash: string): Promise<BuildPage | null> {
    const key = publishedPageSnapshotKey(pageId, contentHash)
    const body = await this.#store.get(key)
    if (!body) {
      return null
    }
    if (MAX_SNAPSHOT_BYTES < body.byteLength) {
      throw Error(`published page snapshot が上限を超えています: ${key}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(body))
    } catch {
      throw Error(`published page snapshot の JSON が壊れています: ${key}`)
    }
    const page = parseBuildPage(parsed)
    if (page.pageId !== pageId || createBuildPageContentHash(page) !== contentHash) {
      throw Error(`published page snapshot の内容が key と一致しません: ${key}`)
    }

    return page
  }
}
