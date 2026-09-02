import { z } from "zod"

import type { SiteDeploymentState } from "../lib/publishing"
import { createEmptyDeploymentState } from "../lib/publishing"

export const DEPLOYMENT_INDEX_KEY = "_internal/publish-index-v1.json"

const MAX_DEPLOYMENT_INDEX_BYTES = 800 * 1_024

const dateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
const categorySchema = z.strictObject({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})
const thumbnailUrlsSchema = z.strictObject({
  article: z.url(),
  mobile: z.url(),
  card: z.url(),
})
const deployedPageSchema = z.strictObject({
  pageId: z.guid(),
  kind: z.enum(["post", "page"]),
  status: z.enum(["published", "unpublished"]),
  route: z.string().startsWith("/"),
  slug: z.string(),
  title: z.string(),
  excerpt: z.string().nullable(),
  category: categorySchema.nullable(),
  publishedAt: dateTimeSchema,
  updatedAt: dateTimeSchema.nullable(),
  thumbnailUrls: thumbnailUrlsSchema.nullable(),
  ogImageUrl: z.url(),
  deployedNotionEdit: dateTimeSchema,
  deployedAt: dateTimeSchema,
  contentHash: z.string().min(1),
})
const deploymentStateSchema: z.ZodType<SiteDeploymentState> = z
  .strictObject({
    schemaVersion: z.literal(1),
    updatedAt: dateTimeSchema,
    pages: z.record(z.guid(), deployedPageSchema),
    routeOwners: z.record(z.string().startsWith("/"), z.guid()),
  })
  .superRefine((state, context) => {
    for (const [pageId, page] of Object.entries(state.pages)) {
      if (page.pageId !== pageId || state.routeOwners[page.route] !== pageId) {
        context.addIssue({ code: "custom", message: "page と route ownership が一致しません" })
      }
    }
    for (const [route, pageId] of Object.entries(state.routeOwners)) {
      if (state.pages[pageId]?.route !== route) {
        context.addIssue({ code: "custom", message: "route ownership の参照先が不正です" })
      }
    }
  })

export interface DeploymentIndexStoredObject {
  body: string
  etag: string
}

export interface DeploymentIndexWriteCondition {
  ifMatch: string | null
  ifNoneMatch: boolean
}

export interface DeploymentIndexStore {
  get(key: string): Promise<DeploymentIndexStoredObject | null>
  put(key: string, body: string, condition: DeploymentIndexWriteCondition): Promise<string>
}

export interface LoadedDeploymentIndex {
  state: SiteDeploymentState
  etag: string | null
}

export class DeploymentIndexRepository {
  readonly #store: DeploymentIndexStore

  constructor(store: DeploymentIndexStore) {
    this.#store = store
  }

  async load(allowMissing: boolean, emptyUpdatedAt: string): Promise<LoadedDeploymentIndex> {
    const stored = await this.#store.get(DEPLOYMENT_INDEX_KEY)
    if (!stored) {
      if (!allowMissing) {
        throw Error("publish index が存在しません")
      }

      return { state: createEmptyDeploymentState(emptyUpdatedAt), etag: null }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(stored.body)
    } catch {
      throw Error("publish index の JSON が壊れています")
    }

    const result = deploymentStateSchema.safeParse(parsed)
    if (!result.success) {
      throw Error("publish index の schema が不正です", { cause: result.error })
    }

    return { state: result.data, etag: stored.etag }
  }

  async save(state: SiteDeploymentState, etag: string | null): Promise<string> {
    const body = JSON.stringify(state)
    if (MAX_DEPLOYMENT_INDEX_BYTES < new TextEncoder().encode(body).byteLength) {
      throw Error("publish index が 800 KiB の上限を超えています")
    }

    return this.#store.put(DEPLOYMENT_INDEX_KEY, body, {
      ifMatch: etag,
      ifNoneMatch: etag === null,
    })
  }
}
