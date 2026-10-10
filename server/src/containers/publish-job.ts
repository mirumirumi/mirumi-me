import { createHash } from "node:crypto"

import { collectAmazonAsins, createAmazonCardSignature } from "shared/amazon"
import type { BuildPage } from "shared/build-manifest"
import { createArticleExcerpt, createBuildPage } from "shared/build-manifest"
import type { BuildComment } from "shared/comments"
import type { ArticleContent, ContentBlock } from "shared/content"
import { createNotionClient, fetchNotionArticle, fetchNotionPageRevision } from "shared/notion"
import { renderArticleContent } from "shared/render"
import { resolvePublicRoute } from "shared/site-routes"

import { createArticleSourceHash, createFetchedArticleHash } from "../lib/article-hash"
import type {
  DeployedPage,
  PreparedPageRevision,
  PublishFailure,
  PublishJobPageResult,
  PublishJobRequest,
  PublishJobSummary,
  SiteDeploymentState,
  UnpublishedPageReferences,
} from "../lib/publishing"
import {
  createPageSummariesManifestFromDeployment,
  isPageRevisionUnchanged,
  omitIgnoredFixedPages,
  overlayDeploymentState,
  preparePageRevision,
} from "../lib/publishing"
import {
  DeploymentIndexRepository,
  type LoadedDeploymentIndex,
} from "../repositories/deployment-index"
import { completeAppManifest } from "./app-manifest"
import { S3DeploymentIndexStore, S3MediaObjectStore, S3SiteObjectStore } from "./aws"
import { generateSite } from "./build"
import { replaceSnapshotComments } from "./comment-refresh-job"
import { NotionPublishCommentSource, type PublishCommentSource } from "./comments"
import type { ContainerConfig } from "./config"
import { SiteDeployer } from "./deploy"
import {
  createInternalBookmarkLookup,
  type InternalBookmarkSource,
  resolveArticleEnrichment,
} from "./enrichment"
import { MediaNormalizer } from "./images"
import { JobProgressReporter } from "./job-progress"
import type { SyncedArticleMedia } from "./media-sync"
import {
  createThumbnailGenerator,
  downloadImage,
  downloadMediaFile,
  syncAppStoreIcons,
  syncArticleMedia,
} from "./media-sync"
import { createBuildPageContentHash, PublishedPageSnapshotStore } from "./published-pages"
import { refreshSearchIndex } from "./search-index"
import {
  createSiteBuildPlan,
  findRemovedAggregateRoutes,
  findUnpublishedContentRoutes,
} from "./site-build"
import {
  findUnpublishedReferences,
  UNPUBLISHED_REFERENCE_SEARCH_TIMEOUT_MS,
} from "./unpublished-references"

const RETIRED_CONTENT_ROUTES = ["/what-is-this-blog/"]

// 前回の配信から内容が変わった再公開でだけ 更新日 を requestedAt にする。
// full は Notion へ書き戻さないため、ここで決めると HTML と index だけが動いて Notion と食い違う。
// 初回公開や、sourceHash を持たない古い index からの再公開では決めない（更新日が動くのは安全側に倒す）。
// 予約公開の記事を公開日より前に直したときは、更新日が公開日より前になるので決めない
export const resolveUpdatedAt = (
  mode: PublishJobRequest["params"]["mode"],
  deployed: Pick<DeployedPage, "sourceHash"> | undefined,
  sourceHash: string,
  publishedAt: string | null,
  requestedAt: string,
): string | null => {
  if (mode === "full" || !deployed?.sourceHash || deployed.sourceHash === sourceHash) {
    return null
  }
  if (!publishedAt || Date.parse(requestedAt) <= Date.parse(publishedAt)) {
    return null
  }

  return requestedAt
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
  sourceHash: string,
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
    sourceHash,
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

// generate はサイト全体を今のアプリで作り直す。Notion の今の本文から作り直さなかった公開中の page
// （未公開の編集がある、公開待ち、途中で触られた、失敗した）は、最後に公開した版（snapshot）から作り直す。
// 今のアプリがその route を持たない page（固定ページの改名など）は作れないので、前のアプリの HTML のまま残す
export const selectSnapshotRebuildPages = (
  state: SiteDeploymentState,
  freshPageIds: Set<string>,
): { pages: Array<DeployedPage>; stale: Array<string> } => {
  const pages: Array<DeployedPage> = []
  const stale: Array<string> = []
  for (const page of Object.values(state.pages)) {
    if (page.status !== "published" || freshPageIds.has(page.pageId)) {
      continue
    }
    if (resolvePublicRoute(page.kind, page.slug) === page.route) {
      pages.push(page)
    } else {
      stale.push(page.pageId)
    }
  }

  return { pages, stale }
}

// generate に渡されるのは、Workflow が読み込んだ時点で未公開の変更がない記事だけ。本文を取り終えるまでに
// 誰かが触っていたら、取った本文に公開していない編集が混ざりうるので、作り直さずに配信中の版を残す
class PageChangedDuringGenerateError extends Error {}

const notionDataSources = (config: ContainerConfig) => {
  return {
    posts: config.notionPostsDataSourceId,
    pages: config.notionPagesDataSourceId,
  }
}

interface PreparedPublishArticle {
  prepared: PreparedPageRevision
  media: SyncedArticleMedia
  sourceHash: string
  // 内容が変わった再公開で決めた新しい 更新日。HTML、index、Notion 書き戻しが同じ値を使う
  updatedAt: string | null
  // その時点の approved comments。sourceHash には含めない（コメントの増減で 更新日 を動かさない）
  comments: Array<BuildComment>
  // 取ったときの本文の hash。公開ボタンの build の最後に、取り直した本文と比べる
  fetchedHash: string
}

const loadPublishArticle = async (
  prepared: PreparedPageRevision,
  state: SiteDeploymentState,
  config: ContainerConfig,
  mediaNormalizer: MediaNormalizer,
  params: PublishJobRequest["params"],
  commentSource: PublishCommentSource,
): Promise<PreparedPublishArticle> => {
  const notion = createNotionClient(config.notionToken)
  const fetched = await fetchNotionArticle(notion, prepared.revision.pageId)
  // 取り終えたあとの編集は本文に入らないので、確かめるのはここで一度だけでよい
  if (params.mode === "full") {
    const current = await fetchNotionPageRevision(
      notion,
      prepared.revision.pageId,
      notionDataSources(config),
    )
    if (!isPageRevisionUnchanged(prepared.revision, current)) {
      throw new PageChangedDuringGenerateError(prepared.revision.pageId)
    }
  }
  const fetchedHash = createFetchedArticleHash(fetched)
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
  const media = await syncArticleMedia(
    article,
    mediaNormalizer,
    { image: downloadImage, file: downloadMediaFile },
    createThumbnailGenerator(config.thumbnailFunctionUrl),
    reusableOgImage,
  )
  const sourceHash = createArticleSourceHash(media.article)
  const updatedAt = resolveUpdatedAt(
    params.mode,
    deployed,
    sourceHash,
    article.publishedAt,
    params.requestedAt,
  )

  // コメントを持つのは記事だけ。固定ページは comments データソースを読まない
  const comments =
    prepared.revision.kind === "post" ? await commentSource.loadForSlug(article.slug) : []

  return {
    prepared,
    media: updatedAt ? { ...media, article: { ...media.article, updatedAt } } : media,
    sourceHash,
    updatedAt,
    comments,
    fetchedHash,
  }
}

const createBuildPageForPublish = async (
  source: PreparedPublishArticle,
  internalBookmarks: ReturnType<typeof createInternalBookmarkLookup>,
  mediaNormalizer: MediaNormalizer,
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
    apps: await syncAppStoreIcons(enrichment.apps, mediaNormalizer, downloadImage),
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
    comments: source.comments,
  })
}

// 非公開にした記事を指す内部ブログカードは、指している記事を次に Notion の本文から作り直すまで残る。
// 非公開にした時点で気づけるよう、Slack で知らせる材料を返す。非公開そのものはもう済んでいるので、ここでは失敗させない
const findReferencesToUnpublished = async (
  builtPages: Array<PreparedPageRevision>,
  previousState: SiteDeploymentState,
  nextState: SiteDeploymentState,
  buildPages: Array<BuildPage>,
  snapshotStore: PublishedPageSnapshotStore,
): Promise<Array<UnpublishedPageReferences>> => {
  const unpublished = builtPages.flatMap((page): Array<DeployedPage> => {
    const deployed = previousState.pages[page.revision.pageId]

    return page.action === "unpublish" && deployed ? [deployed] : []
  })
  if (unpublished.length === 0) {
    return []
  }
  try {
    return await findUnpublishedReferences({
      unpublished,
      state: nextState,
      builtPages: new Map(buildPages.map((page) => [page.pageId, page])),
      loadSnapshot: (pageId, contentHash) => snapshotStore.load(pageId, contentHash),
      signal: AbortSignal.timeout(UNPUBLISHED_REFERENCE_SEARCH_TIMEOUT_MS),
    })
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "unpublished_reference_search_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    )

    return []
  }
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
      label: page.category?.name ?? "",
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
      label: media.article.category?.name ?? "",
    })
  }

  return [...sources.values()]
}

const confirmFreshness = async (
  pages: Array<PreparedPageRevision>,
  articleById: Map<string, PreparedPublishArticle>,
  mode: PublishJobRequest["params"]["mode"],
  config: ContainerConfig,
) => {
  const notion = createNotionClient(config.notionToken)
  for (const page of pages) {
    const current = await fetchNotionPageRevision(
      notion,
      page.revision.pageId,
      notionDataSources(config),
    )
    if (!isPageRevisionUnchanged(page.revision, current)) {
      throw Error(`build 中に Notion page が変更されました: ${page.revision.pageId}`)
    }
    // ボタンを押した同じ分のうちの編集は revision では見分けられないので、公開ボタンでは本文も取り直す。
    // 1 記事なので数秒で済む。bootstrap は全記事の取り直しになるうえ、記事を触らない前提なので行わない
    const source = articleById.get(page.revision.pageId)
    if (mode === "partial" && source) {
      const refetched = await fetchNotionArticle(notion, page.revision.pageId)
      if (createFetchedArticleHash(refetched) !== source.fetchedHash) {
        throw Error(`build 中に Notion page が変更されました: ${page.revision.pageId}`)
      }
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
  const progress = new JobProgressReporter(
    new S3SiteObjectStore(awsConfig, config.siteBucketName),
    request.workflowId,
  )
  await progress.report("prepare", 0, 0)
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
      skipped: [],
      stale: [],
      updatedPaths: [],
      unpublishedReferences: [],
    }
  }

  const mediaNormalizer = new MediaNormalizer(
    new S3MediaObjectStore(awsConfig, config.mediaBucketName),
  )
  // schema 違いや取り切れない query はここで job ごと落とす。コメント 0 件で公開してはいけない
  const commentSource = await NotionPublishCommentSource.create(
    createNotionClient(config.notionToken),
    config.notionCommentsDataSourceId,
  )
  if (request.params.mode !== "partial") {
    await commentSource.preloadAll()
  }
  const failed = [...prepared.failed]
  const skipped: Array<string> = []
  const publishArticles: Array<PreparedPublishArticle> = []
  const loadedPages: Array<PreparedPageRevision> = []
  // 1 page の失敗で batch 全体を落とすと、どの page が原因か Notion 側に出せなくなる
  for (const page of prepared.pages) {
    await progress.report("load-articles", loadedPages.length, prepared.pages.length)
    if (page.action !== "publish") {
      loadedPages.push(page)
      continue
    }
    try {
      publishArticles.push(
        await loadPublishArticle(
          page,
          deploymentState,
          config,
          mediaNormalizer,
          request.params,
          commentSource,
        ),
      )
      loadedPages.push(page)
    } catch (err) {
      if (err instanceof PageChangedDuringGenerateError) {
        skipped.push(page.revision.pageId)
        continue
      }
      failed.push(toPageFailure(page, err))
    }
  }
  const internalBookmarks = createInternalBookmarkLookup(
    createInternalBookmarkSources(deploymentState, publishArticles, loadedPages),
  )
  const buildPages: Array<BuildPage> = []
  const snapshots: Array<DeployedPage> = []
  const publishedSnapshots: Array<{ page: BuildPage; contentHash: string }> = []
  const results: Array<PublishJobPageResult> = []
  const builtPages: Array<PreparedPageRevision> = []
  const publishArticleById = new Map(
    publishArticles.map((article) => [article.prepared.revision.pageId, article]),
  )
  for (const page of loadedPages) {
    await progress.report("build-pages", buildPages.length, loadedPages.length)
    try {
      if (page.action === "publish") {
        const source = publishArticleById.get(page.revision.pageId)
        if (!source) {
          throw Error(`build 対象の記事本文がありません: ${page.revision.pageId}`)
        }
        const buildPage = await createBuildPageForPublish(
          source,
          internalBookmarks,
          mediaNormalizer,
          config,
        )
        const hash = createBuildPageContentHash(buildPage)
        buildPages.push(buildPage)
        publishedSnapshots.push({ page: buildPage, contentHash: hash })
        snapshots.push(
          createPublishedPageSnapshot(
            page,
            buildPage,
            request.params.requestedAt,
            hash,
            source.sourceHash,
          ),
        )
        results.push({
          pageId: page.revision.pageId,
          action: "publish",
          deployedAt: request.params.requestedAt,
          publishedAt: page.effectivePublishedAt!,
          contentHash: hash,
          updatedAt: source.updatedAt,
          fetchedHash: source.fetchedHash,
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
  const snapshotPages: Array<BuildPage> = []
  const rebuiltSnapshots: Array<DeployedPage> = []
  const stale: Array<string> = []
  if (request.params.mode === "full") {
    const freshPageIds = new Set(
      builtPages.flatMap((page) => (page.action === "publish" ? [page.revision.pageId] : [])),
    )
    const selected = selectSnapshotRebuildPages(deploymentState, freshPageIds)
    stale.push(...selected.stale)
    const snapshotReader = new PublishedPageSnapshotStore(
      new S3SiteObjectStore(awsConfig, config.siteBucketName),
    )
    for (const deployed of selected.pages) {
      try {
        const snapshot = await snapshotReader.load(deployed.pageId, deployed.contentHash)
        if (!snapshot) {
          stale.push(deployed.pageId)
          continue
        }
        // 本文は Notion を読み直さないので未公開の編集は混ざらない。コメントだけはコメント反映と同じく今の承認済みにする
        const buildPage =
          deployed.kind === "post"
            ? replaceSnapshotComments(snapshot, await commentSource.loadForSlug(deployed.slug))
            : snapshot
        const hash = createBuildPageContentHash(buildPage)
        snapshotPages.push(buildPage)
        if (hash !== deployed.contentHash) {
          publishedSnapshots.push({ page: buildPage, contentHash: hash })
        }
        // 記事本文の版（deployedNotionEdit / sourceHash）は動かさず、配信物の hash と時刻だけを進める
        rebuiltSnapshots.push({
          ...deployed,
          contentHash: hash,
          deployedAt: request.params.requestedAt,
        })
      } catch (err) {
        console.warn(
          JSON.stringify({
            event: "snapshot_rebuild_failed",
            pageId: deployed.pageId,
            message: err instanceof Error ? err.message : String(err),
          }),
        )
        stale.push(deployed.pageId)
      }
    }
  }
  if (builtPages.length === 0 && snapshotPages.length === 0) {
    return {
      workflowId: request.workflowId,
      buildHash: buildHash(deploymentState, request.workflowId),
      pages: [],
      failed,
      skipped,
      stale,
      updatedPaths: [],
      unpublishedReferences: [],
    }
  }

  const nextState = overlayDeploymentState(
    deploymentState,
    [...snapshots, ...rebuiltSnapshots],
    request.params.requestedAt,
  )
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
    snapshotPages: rebuiltSnapshots.map(({ pageId, route }) => ({ pageId, route })),
  })
  await progress.report("generate", 0, plan.routes.length)
  const generated = await generateSite({
    workflowId: request.workflowId,
    plan,
    pages: [...buildPages, ...snapshotPages],
    deploymentState: nextState,
    workersApiOrigin: config.workersApiOrigin,
    appEnv: config.appEnv,
  })
  // generate は本文を取った直後に page ごとに確かめ済み。ここで 1 page の編集を理由に全体を止めると、
  // 1 時間かかる generate が、そのあいだの執筆や公開ボタンひとつで丸ごとやり直しになる
  if (request.params.mode !== "full") {
    await confirmFreshness(builtPages, publishArticleById, request.params.mode, config)
  }
  const deletedContentRoutes = findUnpublishedContentRoutes(builtPages)
  const deletedRoutes = [
    ...new Set([
      ...deletedContentRoutes,
      ...findRemovedAggregateRoutes(previousSummaries.pages, summaries.pages),
      ...RETIRED_CONTENT_ROUTES,
    ]),
  ]
  const siteStore = new S3SiteObjectStore(awsConfig, config.siteBucketName)
  // generate も、失敗した記事と飛ばした記事は作り直さないので manifest に載らない。載っていない route へ
  // サイト内遷移すると本文が空になるため、配信中の manifest から引き継ぐ。bootstrap の配信中の manifest は
  // WordPress 時代の Nuxt が作ったものなので引き継がない
  if (plan.mode !== "bootstrap") {
    await completeAppManifest(generated.outputDirectory, siteStore, deletedRoutes)
  }
  await progress.report("deploy", 0, plan.routes.length)
  // comment-refresh が index の contentHash から現在版を引けるよう、配信物より先に snapshot を置く
  const snapshotStore = new PublishedPageSnapshotStore(siteStore)
  for (const { page, contentHash } of publishedSnapshots) {
    await snapshotStore.save(page, contentHash)
  }
  const updatedPaths = await new SiteDeployer(siteStore).deploy(
    generated.outputDirectory,
    plan,
    deletedRoutes,
  )
  await repository.save(nextState, loaded.etag)
  // 検索の索引を更新できなくても、配信はもう済んでいるので公開は失敗にしない。次の公開か generate で追いつく
  try {
    await refreshSearchIndex({
      mode: request.params.mode,
      store: siteStore,
      builtPages: [...buildPages, ...snapshotPages],
      state: nextState,
      updatedAt: request.params.requestedAt,
    })
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "search_index_refresh_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  }
  const unpublishedReferences = await findReferencesToUnpublished(
    builtPages,
    deploymentState,
    nextState,
    buildPages,
    snapshotStore,
  )
  await progress.report("done", results.length, prepared.pages.length)

  return {
    workflowId: request.workflowId,
    buildHash: buildHash(nextState, request.workflowId),
    pages: results,
    failed,
    skipped,
    stale,
    updatedPaths,
    unpublishedReferences,
  }
}
