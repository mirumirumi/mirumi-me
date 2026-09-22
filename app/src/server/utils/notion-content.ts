import { resolveExternalBookmark } from "shared/bookmark"
import type {
  BuildPage,
  BuildPageSummary,
  CategoriesManifest,
  PageSummariesManifest,
  ThumbnailUrls,
} from "shared/build-manifest"
import {
  createBuildPage,
  createCategoriesManifest,
  createPageSummariesManifest,
  parseBuildPage,
} from "shared/build-manifest"
import {
  createInternalBookmarkLookup,
  type InternalBookmarkSource,
  resolveArticleEnrichment,
} from "shared/enrichment"
import { resolveThumbnailUrls } from "shared/media"
import {
  createNotionClient,
  fetchNotionArticle,
  fetchNotionPageIndex,
  type NotionDataSourceIds,
  type NotionPageIndexItem,
  parseNotionPageIndex,
} from "shared/notion"
import { renderArticleContent } from "shared/render"
import { resolvePublicRoute } from "shared/site-routes"
import { parseStaticXPostData, resolveXPost, type StaticXPostData } from "shared/x-post"

import { DiskStringCache } from "./disk-cache"

const INDEX_CACHE_KEY = "notion-development-index:v1"
const INDEX_FRESH_MS = 5 * 60 * 1_000
const PAGE_FRESH_MS = 30 * 60 * 1_000
const DEFAULT_OG_IMAGE_URL = "https://mirumi.me/assets/main-visual.png"

interface CachedNotionIndex {
  fetchedAt: string
  pages: Array<NotionPageIndexItem>
}

interface CachedBuildPage {
  fetchedAt: string
  sourceLastEditedTime: string
  page: BuildPage
}

interface DevelopmentContentEnvironment {
  NOTION_TOKEN: string
  NOTION_POSTS_DATA_SOURCE_ID: string
  NOTION_PAGES_DATA_SOURCE_ID: string
  WORKERS_API_ORIGIN: string
  CF_ACCESS_CLIENT_ID: string | null
  CF_ACCESS_CLIENT_SECRET: string | null
  CF_ACCESS_SERVICE_TOKEN_EXPIRES_AT: string | null
}

interface DevelopmentContentCache {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>
}

type DevelopmentFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const parseCachedIndex = (value: string | null): CachedNotionIndex | null => {
  if (!value) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.fetchedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.fetchedAt))
    ) {
      return null
    }

    return {
      fetchedAt: parsed.fetchedAt,
      pages: parseNotionPageIndex(parsed.pages),
    }
  } catch {
    return null
  }
}

const parseCachedBuildPage = (value: string | null): CachedBuildPage | null => {
  if (!value) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.fetchedAt !== "string" ||
      Number.isNaN(Date.parse(parsed.fetchedAt)) ||
      typeof parsed.sourceLastEditedTime !== "string"
    ) {
      return null
    }

    return {
      fetchedAt: parsed.fetchedAt,
      sourceLastEditedTime: parsed.sourceLastEditedTime,
      page: parseBuildPage(parsed.page),
    }
  } catch {
    return null
  }
}

const isFresh = (fetchedAt: string, maxAgeMs: number, now: Date): boolean => {
  return now.getTime() - Date.parse(fetchedAt) < maxAgeMs
}

const resolveDevelopmentThumbnailUrls = (url: string | null): ThumbnailUrls | null => {
  if (!url) {
    return null
  }
  const canonical = resolveThumbnailUrls(url)
  if (canonical) {
    return canonical
  }

  return { article: url, mobile: url, card: url }
}

const resolveEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): DevelopmentContentEnvironment => {
  const notionToken = environment.NOTION_TOKEN?.trim()
  const posts = environment.NOTION_POSTS_DATA_SOURCE_ID?.trim()
  const pages = environment.NOTION_PAGES_DATA_SOURCE_ID?.trim()
  if (!notionToken || !posts || !pages) {
    throw Error("ローカル Notion 開発用の環境変数がありません。app/.env.example を確認してください")
  }

  return {
    NOTION_TOKEN: notionToken,
    NOTION_POSTS_DATA_SOURCE_ID: posts,
    NOTION_PAGES_DATA_SOURCE_ID: pages,
    WORKERS_API_ORIGIN:
      environment.WORKERS_API_ORIGIN?.trim() ||
      "https://mirumi-me-dev.v2p04rubfuwnvttj.workers.dev",
    CF_ACCESS_CLIENT_ID: environment.CF_ACCESS_CLIENT_ID?.trim() || null,
    CF_ACCESS_CLIENT_SECRET: environment.CF_ACCESS_CLIENT_SECRET?.trim() || null,
    CF_ACCESS_SERVICE_TOKEN_EXPIRES_AT:
      environment.CF_ACCESS_SERVICE_TOKEN_EXPIRES_AT?.trim() || null,
  }
}

const warnAccessTokenExpiration = (environment: DevelopmentContentEnvironment) => {
  if (!environment.CF_ACCESS_CLIENT_ID || !environment.CF_ACCESS_CLIENT_SECRET) {
    console.warn("ローカル X post 解決用の Cloudflare Access service token がありません")

    return
  }
  if (!environment.CF_ACCESS_SERVICE_TOKEN_EXPIRES_AT) {
    console.warn("Cloudflare Access service token の有効期限が記録されていません")

    return
  }
  const expiresAt = Date.parse(environment.CF_ACCESS_SERVICE_TOKEN_EXPIRES_AT)
  if (Number.isNaN(expiresAt)) {
    console.warn("CF_ACCESS_SERVICE_TOKEN_EXPIRES_AT の形式が不正です")

    return
  }
  const remainingDays = Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1_000))
  if (remainingDays < 0) {
    console.warn("Cloudflare Access service token の有効期限が切れています")
  } else if (remainingDays < 31) {
    console.warn(`Cloudflare Access service token の期限まで ${remainingDays} 日です`)
  }
}

export class NotionDevelopmentContentReader {
  readonly #environment: DevelopmentContentEnvironment
  readonly #notion: ReturnType<typeof createNotionClient>
  readonly #dataSources: NotionDataSourceIds
  readonly #cache: DevelopmentContentCache
  readonly #fetcher: DevelopmentFetcher
  #indexRequest: Promise<Array<NotionPageIndexItem>> | null = null
  readonly #pageRequests = new Map<string, Promise<BuildPage>>()

  constructor(
    environment: NodeJS.ProcessEnv = process.env,
    cache: DevelopmentContentCache = new DiskStringCache(),
    fetcher: DevelopmentFetcher = fetch,
  ) {
    this.#environment = resolveEnvironment(environment)
    this.#notion = createNotionClient(this.#environment.NOTION_TOKEN)
    this.#dataSources = {
      posts: this.#environment.NOTION_POSTS_DATA_SOURCE_ID,
      pages: this.#environment.NOTION_PAGES_DATA_SOURCE_ID,
    }
    this.#cache = cache
    this.#fetcher = fetcher
    warnAccessTokenExpiration(this.#environment)
  }

  async readPageByRoute(route: string): Promise<BuildPage> {
    const index = await this.#loadIndex()
    const source = index.find(({ revision }) => {
      return (
        this.#isPublished(revision) && resolvePublicRoute(revision.kind, revision.slug) === route
      )
    })
    if (!source) {
      throw Error(`${route} はローカル Notion の build 対象ページではありません`)
    }
    const current = this.#pageRequests.get(source.revision.pageId)
    if (current) {
      return current
    }
    const request = this.#loadPage(source, index).finally(() => {
      this.#pageRequests.delete(source.revision.pageId)
    })
    this.#pageRequests.set(source.revision.pageId, request)

    return request
  }

  async readPageSummaries(): Promise<PageSummariesManifest> {
    const index = await this.#loadIndex()
    const summaries = index.flatMap(({ revision, thumbnailUrl }): Array<BuildPageSummary> => {
      if (
        revision.kind !== "post" ||
        !this.#isPublished(revision) ||
        !revision.category ||
        !resolvePublicRoute(revision.kind, revision.slug)
      ) {
        return []
      }

      // ローカル開発は自動生成 Lambda を通らないため、thumbnail がない記事のカード画像はない
      const thumbnailUrls = resolveDevelopmentThumbnailUrls(thumbnailUrl)

      return [
        {
          pageId: revision.pageId,
          slug: revision.slug,
          title: revision.title,
          excerpt: "",
          publishedAt: revision.publishedAt!,
          updatedAt: revision.updatedAt,
          category: revision.category,
          thumbnailUrls,
          cardImageUrl: thumbnailUrls?.card ?? null,
        },
      ]
    })

    return createPageSummariesManifest(summaries)
  }

  async readCategories(): Promise<CategoriesManifest> {
    const summaries = await this.readPageSummaries()

    return createCategoriesManifest(summaries.pages.map(({ category }) => category))
  }

  async #loadIndex(): Promise<Array<NotionPageIndexItem>> {
    if (this.#indexRequest) {
      return this.#indexRequest
    }
    this.#indexRequest = this.#refreshIndex().finally(() => {
      this.#indexRequest = null
    })

    return this.#indexRequest
  }

  async #refreshIndex(): Promise<Array<NotionPageIndexItem>> {
    const now = new Date()
    const cached = parseCachedIndex(await this.#cache.get(INDEX_CACHE_KEY))
    if (cached && isFresh(cached.fetchedAt, INDEX_FRESH_MS, now)) {
      return cached.pages
    }

    try {
      const pages = await fetchNotionPageIndex(this.#notion, this.#dataSources)
      await this.#cache.put(
        INDEX_CACHE_KEY,
        JSON.stringify({ version: 1, fetchedAt: now.toISOString(), pages }),
      )

      return pages
    } catch (err) {
      if (cached) {
        console.warn("Notion index の更新に失敗したためローカル cache を使います", err)

        return cached.pages
      }
      throw err
    }
  }

  async #loadPage(
    source: NotionPageIndexItem,
    index: Array<NotionPageIndexItem>,
  ): Promise<BuildPage> {
    const key = `notion-development-page:v1:${source.revision.pageId}`
    const now = new Date()
    const cached = parseCachedBuildPage(await this.#cache.get(key))
    if (
      cached &&
      cached.sourceLastEditedTime === source.revision.lastEditedTime &&
      isFresh(cached.fetchedAt, PAGE_FRESH_MS, now)
    ) {
      return cached.page
    }

    try {
      const fetched = await fetchNotionArticle(this.#notion, source.revision.pageId)
      const article = {
        ...fetched,
        title: source.revision.title,
        slug: source.revision.slug,
        publishedAt: source.revision.publishedAt,
        updatedAt: source.revision.updatedAt,
        category: source.revision.category,
      }
      const enrichment = await resolveArticleEnrichment(
        article,
        createInternalBookmarkLookup(this.#createInternalBookmarkSources(index)),
        {
          externalBookmark: async (url) => {
            return resolveExternalBookmark(url, this.#cache)
          },
          xPost: async (postId) => {
            return resolveXPost(postId, this.#cache, (id) => this.#fetchXPost(id))
          },
        },
      )
      const thumbnailUrls = resolveDevelopmentThumbnailUrls(source.thumbnailUrl)
      const page = createBuildPage({
        kind: source.revision.kind,
        article,
        rendered: renderArticleContent(article, {
          amazonCardSignatures: {},
          allowUnsignedAmazonCards: true,
          bookmarks: enrichment.bookmarks,
          xPosts: enrichment.xPosts,
        }),
        thumbnailUrls,
        ogImageUrl: thumbnailUrls?.article ?? DEFAULT_OG_IMAGE_URL,
        // ローカル dev はコメントを扱わない。Notion の comments を読む実装は作らず常に 0 件にする
        comments: [],
      })
      await this.#cache.put(
        key,
        JSON.stringify({
          version: 1,
          fetchedAt: now.toISOString(),
          sourceLastEditedTime: source.revision.lastEditedTime,
          page,
        }),
      )

      return page
    } catch (err) {
      if (cached) {
        console.warn(`${source.revision.slug} の更新に失敗したためローカル cache を使います`, err)

        return cached.page
      }
      throw err
    }
  }

  #createInternalBookmarkSources(index: Array<NotionPageIndexItem>): Array<InternalBookmarkSource> {
    return index.flatMap(({ revision, thumbnailUrl }): Array<InternalBookmarkSource> => {
      const route = resolvePublicRoute(revision.kind, revision.slug)
      if (!route || !this.#isPublished(revision)) {
        return []
      }

      return [
        {
          route,
          title: revision.title,
          description: null,
          label: revision.category?.name ?? "みるめも",
        },
      ]
    })
  }

  async #fetchXPost(postId: string): Promise<StaticXPostData> {
    if (!this.#environment.CF_ACCESS_CLIENT_ID || !this.#environment.CF_ACCESS_CLIENT_SECRET) {
      throw Error("Cloudflare Access service token がありません")
    }
    const endpoint = new URL("/_dev/x-post", this.#environment.WORKERS_API_ORIGIN)
    const response = await this.#fetcher(endpoint, {
      method: "POST",
      headers: {
        "CF-Access-Client-Id": this.#environment.CF_ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": this.#environment.CF_ACCESS_CLIENT_SECRET,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ postId }),
      signal: AbortSignal.timeout(25_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`X post の開発用 endpoint が失敗しました: ${response.status}`)
    }

    return parseStaticXPostData(await response.json())
  }

  #isPublished(revision: NotionPageIndexItem["revision"]): boolean {
    return (
      revision.internalState === "公開中" &&
      revision.title.trim() !== "" &&
      revision.publishedAt !== null
    )
  }
}
