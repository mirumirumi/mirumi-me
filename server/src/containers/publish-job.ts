import { createHash } from "node:crypto"

import { collectAmazonAsins, createAmazonCardSignature } from "shared/amazon"
import type { BuildPage } from "shared/build-manifest"
import { createArticleExcerpt, createBuildPage } from "shared/build-manifest"
import { createNotionClient, fetchNotionArticle, fetchNotionPageRevision } from "shared/notion"
import { renderArticleContent } from "shared/render"

import type {
  DeployedPage,
  PreparedPageRevision,
  PublishFailure,
  PublishJobPageResult,
  PublishJobRequest,
  PublishJobSummary,
  SiteDeploymentState,
} from "../lib/publishing"
import {
  createPageSummariesManifestFromDeployment,
  omitIgnoredFixedPages,
  overlayDeploymentState,
  preparePageRevision,
} from "../lib/publishing"
import {
  DeploymentIndexRepository,
  type LoadedDeploymentIndex,
} from "../repositories/deployment-index"
import { S3DeploymentIndexStore, S3MediaObjectStore, S3SiteObjectStore } from "./aws"
import { generateSite } from "./build"
import type { ContainerConfig } from "./config"
import { SiteDeployer } from "./deploy"
import {
  createInternalBookmarkLookup,
  type InternalBookmarkSource,
  resolveArticleEnrichment,
} from "./enrichment"
import { MediaNormalizer } from "./images"
import type { SyncedArticleMedia } from "./media-sync"
import { createThumbnailGenerator, downloadImage, syncArticleMedia } from "./media-sync"
import {
  createSiteBuildPlan,
  findRemovedAggregateRoutes,
  findUnpublishedContentRoutes,
} from "./site-build"

const RETIRED_CONTENT_ROUTES = ["/what-is-this-blog/"]

const contentHash = (page: BuildPage): string => {
  return createHash("sha256").update(JSON.stringify(page)).digest("hex")
}

const buildHash = (state: SiteDeploymentState, workflowId: string): string => {
  return createHash("sha256")
    .update(workflowId)
    .update("\0")
    .update(JSON.stringify(state))
    .digest("hex")
    .slice(0, 32)
}

export const validateBootstrapIndex = (
  mode: PublishJobRequest["params"]["mode"],
  loaded: LoadedDeploymentIndex,
  requestedAt: string,
): void => {
  if (mode === "bootstrap" && loaded.etag !== null && loaded.state.updatedAt !== requestedAt) {
    throw Error("publish index が存在するため bootstrap できません")
  }
}

export const createPublishedPageSnapshot = (
  prepared: PreparedPageRevision,
  page: BuildPage,
  deployedAt: string,
  hash: string,
): DeployedPage => {
  if (prepared.action !== "publish" || !prepared.route || !prepared.effectivePublishedAt) {
    throw Error("公開 snapshot を作れない page です")
  }

  return {
    pageId: page.pageId,
    kind: page.kind,
    status: "published",
    route: prepared.route,
    slug: page.slug,
    title: page.title,
    excerpt: page.excerpt,
    category: page.category,
    publishedAt: prepared.effectivePublishedAt,
    updatedAt: page.updatedAt,
    thumbnailUrls: page.thumbnailUrls,
    ogImageUrl: page.ogImageUrl,
    deployedNotionEdit: prepared.revision.lastEditedTime,
    deployedAt,
    contentHash: hash,
  }
}

export const createUnpublishedPageSnapshot = (
  prepared: PreparedPageRevision,
  deployed: DeployedPage,
  deployedAt: string,
): DeployedPage => {
  if (prepared.action !== "unpublish") {
    throw Error("非公開 snapshot を作れない page です")
  }

  return {
    ...deployed,
    status: "unpublished",
    deployedNotionEdit: prepared.revision.lastEditedTime,
    deployedAt,
  }
}

const toPageFailure = (page: PreparedPageRevision, err: unknown): PublishFailure => {
  return {
    pageId: page.revision.pageId,
    code: "publish-failed",
    message: err instanceof Error ? err.message.slice(0, 400) : "公開処理に失敗しました",
  }
}

export const preparePages = (
  request: PublishJobRequest,
  state: SiteDeploymentState,
): { pages: Array<PreparedPageRevision>; failed: Array<PublishFailure> } => {
  const pages: Array<PreparedPageRevision> = []
  const failed: Array<PublishFailure> = []
  // preparePageRevision は publish index としか衝突を見ないので、同じ batch 内の重複はここで弾く。
  // 見逃すと build がすべて終わったあと overlayDeploymentState が job ごと落とす
  const claimedRoutes = new Map<string, string>()
  for (const requested of request.pages) {
    const prepared = preparePageRevision(
      requested.revision,
      request.params.mode,
      request.params.requestedAt,
      state,
    )
    const issues = [...prepared.issues]
    if (prepared.action === "publish" && prepared.route) {
      const claimedBy = claimedRoutes.get(prepared.route)
      if (claimedBy && claimedBy !== prepared.revision.pageId) {
        issues.push({
          pageId: prepared.revision.pageId,
          code: "route-collision",
          message: `同じ route を持つ page が同時に指定されています: ${prepared.route}`,
        })
      } else {
        claimedRoutes.set(prepared.route, prepared.revision.pageId)
      }
    }
    if (0 < issues.length) {
      const issue = issues[0]!
      failed.push({
        pageId: issue.pageId,
        code: issue.code,
        message: issues.map(({ message }) => message).join(" / "),
      })
    } else {
      pages.push(prepared)
    }
  }

  return { pages, failed }
}

interface PreparedPublishArticle {
  prepared: PreparedPageRevision
  media: SyncedArticleMedia
}

const loadPublishArticle = async (
  prepared: PreparedPageRevision,
  state: SiteDeploymentState,
  config: ContainerConfig,
  mediaNormalizer: MediaNormalizer,
): Promise<PreparedPublishArticle> => {
  const notion = createNotionClient(config.notionToken)
  const fetched = await fetchNotionArticle(notion, prepared.revision.pageId)
  const article = {
    ...fetched,
    title: prepared.revision.title,
    slug: prepared.revision.slug,
    publishedAt: prepared.effectivePublishedAt,
    updatedAt: prepared.revision.updatedAt,
    category: prepared.revision.category,
  }
  const deployed = state.pages[prepared.revision.pageId]
  const reusableOgImage =
    !article.thumbnailUrl && deployed?.thumbnailUrls === null && deployed.title === article.title
      ? deployed.ogImageUrl
      : null
  return {
    prepared,
    media: await syncArticleMedia(
      article,
      mediaNormalizer,
      downloadImage,
      createThumbnailGenerator(config.thumbnailFunctionUrl),
      reusableOgImage,
    ),
  }
}

const createBuildPageForPublish = async (
  source: PreparedPublishArticle,
  internalBookmarks: ReturnType<typeof createInternalBookmarkLookup>,
  config: ContainerConfig,
): Promise<BuildPage> => {
  const { prepared, media } = source
  const asins = collectAmazonAsins(media.article.blocks)
  const amazonCardSignatures = Object.fromEntries(
    await Promise.all(
      asins.map(async (asin) => [
        asin,
        await createAmazonCardSignature(asin, config.amazonCardSigningSecret),
      ]),
    ),
  )
  const enrichment = await resolveArticleEnrichment(media.article, internalBookmarks)
  const rendered = renderArticleContent(media.article, {
    amazonCardSignatures,
    bookmarks: enrichment.bookmarks,
    xPosts: enrichment.xPosts,
  })
  if (config.appEnv === "prd" && 0 < rendered.warnings.length) {
    throw Error(`production render warning: ${rendered.warnings.join(" / ")}`)
  }

  return createBuildPage({
    kind: prepared.revision.kind,
    article: media.article,
    rendered,
    thumbnailUrls: media.thumbnailUrls,
    ogImageUrl: media.ogImageUrl,
  })
}

const createInternalBookmarkSources = (
  state: SiteDeploymentState,
  articles: Array<PreparedPublishArticle>,
  preparedPages: Array<PreparedPageRevision>,
): Array<InternalBookmarkSource> => {
  const unpublishedIds = new Set(
    preparedPages.flatMap((page): Array<string> => {
      return page.action === "unpublish" ? [page.revision.pageId] : []
    }),
  )
  const sources = new Map<string, InternalBookmarkSource>()
  for (const page of Object.values(state.pages)) {
    if (page.status !== "published" || unpublishedIds.has(page.pageId)) {
      continue
    }
    sources.set(page.route, {
      route: page.route,
      title: page.title,
      description: page.excerpt,
      imageUrl: page.thumbnailUrls?.card ?? null,
      label: page.category?.name ?? "みるめも",
    })
  }
  for (const { prepared, media } of articles) {
    if (!prepared.route) {
      continue
    }
    sources.set(prepared.route, {
      route: prepared.route,
      title: media.article.title,
      description: createArticleExcerpt(media.article),
      imageUrl: media.thumbnailUrls?.card ?? null,
      label: media.article.category?.name ?? "みるめも",
    })
  }

  return [...sources.values()]
}

const confirmFreshness = async (pages: Array<PreparedPageRevision>, config: ContainerConfig) => {
  const notion = createNotionClient(config.notionToken)
  const dataSources = {
    posts: config.notionPostsDataSourceId,
    pages: config.notionPagesDataSourceId,
  }
  for (const page of pages) {
    const current = await fetchNotionPageRevision(notion, page.revision.pageId, dataSources)
    if (
      current.lastEditedTime !== page.revision.lastEditedTime ||
      current.internalState !== page.revision.internalState
    ) {
      throw Error(`build 中に Notion page が変更されました: ${page.revision.pageId}`)
    }
  }
}

export const runContainerPublishJob = async (
  request: PublishJobRequest,
  config: ContainerConfig,
): Promise<PublishJobSummary> => {
  const awsConfig = {
    region: config.awsRegion,
    accessKeyId: config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  }
  const repository = new DeploymentIndexRepository(
    new S3DeploymentIndexStore(awsConfig, config.siteBucketName),
  )
  const loaded = await repository.load(
    request.params.mode === "bootstrap",
    request.params.requestedAt,
  )
  validateBootstrapIndex(request.params.mode, loaded, request.params.requestedAt)
  const deploymentState = omitIgnoredFixedPages(loaded.state)
  const prepared = preparePages(request, deploymentState)
  if (prepared.pages.length === 0) {
    return {
      workflowId: request.workflowId,
      buildHash: buildHash(deploymentState, request.workflowId),
      pages: [],
      failed: prepared.failed,
      updatedPaths: [],
    }
  }

  const mediaNormalizer = new MediaNormalizer(
    new S3MediaObjectStore(awsConfig, config.mediaBucketName),
  )
  const failed = [...prepared.failed]
  const publishArticles: Array<PreparedPublishArticle> = []
  const loadedPages: Array<PreparedPageRevision> = []
  // 1 page の失敗で batch 全体を落とすと、どの page が原因か Notion 側に出せなくなる
  for (const page of prepared.pages) {
    if (page.action !== "publish") {
      loadedPages.push(page)
      continue
    }
    try {
      publishArticles.push(await loadPublishArticle(page, deploymentState, config, mediaNormalizer))
      loadedPages.push(page)
    } catch (err) {
      failed.push(toPageFailure(page, err))
    }
  }
  const internalBookmarks = createInternalBookmarkLookup(
    createInternalBookmarkSources(deploymentState, publishArticles, loadedPages),
  )
  const buildPages: Array<BuildPage> = []
  const snapshots: Array<DeployedPage> = []
  const results: Array<PublishJobPageResult> = []
  const builtPages: Array<PreparedPageRevision> = []
  const publishArticleById = new Map(
    publishArticles.map((article) => [article.prepared.revision.pageId, article]),
  )
  for (const page of loadedPages) {
    try {
      if (page.action === "publish") {
        const source = publishArticleById.get(page.revision.pageId)
        if (!source) {
          throw Error(`build 対象の記事本文がありません: ${page.revision.pageId}`)
        }
        const buildPage = await createBuildPageForPublish(source, internalBookmarks, config)
        const hash = contentHash(buildPage)
        buildPages.push(buildPage)
        snapshots.push(
          createPublishedPageSnapshot(page, buildPage, request.params.requestedAt, hash),
        )
        results.push({
          pageId: page.revision.pageId,
          action: "publish",
          deployedAt: request.params.requestedAt,
          publishedAt: page.effectivePublishedAt!,
          contentHash: hash,
        })
      } else {
        const deployed = deploymentState.pages[page.revision.pageId]
        if (!deployed) {
          throw Error(`非公開対象が publish index にありません: ${page.revision.pageId}`)
        }
        snapshots.push(createUnpublishedPageSnapshot(page, deployed, request.params.requestedAt))
        results.push({
          pageId: page.revision.pageId,
          action: "unpublish",
          deployedAt: request.params.requestedAt,
          contentHash: null,
        })
      }
      builtPages.push(page)
    } catch (err) {
      failed.push(toPageFailure(page, err))
    }
  }
  if (builtPages.length === 0) {
    return {
      workflowId: request.workflowId,
      buildHash: buildHash(deploymentState, request.workflowId),
      pages: [],
      failed,
      updatedPaths: [],
    }
  }

  const nextState = overlayDeploymentState(deploymentState, snapshots, request.params.requestedAt)
  const previousSummaries = createPageSummariesManifestFromDeployment(
    Object.values(deploymentState.pages),
  )
  const summaries = createPageSummariesManifestFromDeployment(Object.values(nextState.pages))
  const plan = createSiteBuildPlan({
    workflowId: request.workflowId,
    mode: request.params.mode,
    generatedAt: request.params.requestedAt,
    summaries: summaries.pages,
    changedPages: builtPages,
  })
  const generated = await generateSite({
    workflowId: request.workflowId,
    plan,
    pages: buildPages,
    deploymentState: nextState,
    workersApiOrigin: config.workersApiOrigin,
    appEnv: config.appEnv,
  })
  await confirmFreshness(builtPages, config)
  const deletedContentRoutes = findUnpublishedContentRoutes(builtPages)
  const deletedRoutes = [
    ...new Set([
      ...deletedContentRoutes,
      ...findRemovedAggregateRoutes(previousSummaries.pages, summaries.pages),
      ...RETIRED_CONTENT_ROUTES,
    ]),
  ]
  const updatedPaths = await new SiteDeployer(
    new S3SiteObjectStore(awsConfig, config.siteBucketName),
  ).deploy(generated.outputDirectory, plan, deletedRoutes)
  await repository.save(nextState, loaded.etag)

  return {
    workflowId: request.workflowId,
    buildHash: buildHash(nextState, request.workflowId),
    pages: results,
    failed,
    updatedPaths,
  }
}
