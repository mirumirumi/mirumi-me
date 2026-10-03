import {
  type BuildPageSummary,
  createPageSummariesManifest,
  type PageSummariesManifest,
  type PublishMode,
  type ThumbnailUrls,
} from "shared/build-manifest"
import type { ArticleCategory } from "shared/content"
import { resolveCardImageUrl } from "shared/media"
import type { InternalState, PageKind, PageRevision } from "shared/notion"
import {
  isIgnoredFixedPageSlug,
  isReservedPostSlug,
  isValidSlug,
  resolvePublicRoute,
} from "shared/site-routes"

export type { PublishMode, ThumbnailUrls } from "shared/build-manifest"
export type { InternalState, PageKind, PageRevision } from "shared/notion"

export type PublishAction = "publish" | "unpublish" | "noop"
export type PublishSource = "notion-webhook" | "admin" | "release"

export interface PublishWorkflowParams {
  mode: PublishMode
  source: PublishSource
  requestId: string
  requestedAt: string
  pageIds: Array<string>
}

export interface DeployedPage {
  pageId: string
  kind: PageKind
  status: "published" | "unpublished"
  route: string
  slug: string
  title: string
  excerpt: string | null
  category: ArticleCategory | null
  publishedAt: string
  updatedAt: string | null
  thumbnailUrls: ThumbnailUrls | null
  ogImageUrl: string
  deployedNotionEdit: string
  deployedAt: string
  contentHash: string
  // Notion 由来の内容だけのハッシュ。再公開で内容が変わったかの判定に使う。
  // この項目を持たない時期の index は null で読む
  sourceHash: string | null
}

export interface SiteDeploymentState {
  schemaVersion: 1
  updatedAt: string
  pages: Record<string, DeployedPage>
  routeOwners: Record<string, string>
}

export const createPageSummariesManifestFromDeployment = (
  pages: Array<DeployedPage>,
): PageSummariesManifest => {
  const summaries = pages.flatMap((page): Array<BuildPageSummary> => {
    if (page.status !== "published" || page.kind !== "post" || !page.category) {
      return []
    }

    return [
      {
        pageId: page.pageId,
        slug: page.slug,
        title: page.title,
        excerpt: page.excerpt ?? "",
        publishedAt: page.publishedAt,
        updatedAt: page.updatedAt,
        category: page.category,
        thumbnailUrls: page.thumbnailUrls,
        cardImageUrl: resolveCardImageUrl(page.thumbnailUrls, page.ogImageUrl),
      },
    ]
  })

  return createPageSummariesManifest(summaries)
}

export type DeploymentPageState =
  | {
      pageId: string
      status: "published"
      deployedAt: string
      publishedAt: string
    }
  | {
      pageId: string
      status: "unpublished"
    }
  | {
      pageId: string
      status: "missing"
    }

export const PUBLISH_VALIDATION_CODES = [
  "invalid-state",
  "missing-title",
  "invalid-slug",
  "reserved-slug",
  "missing-category",
  "invalid-category",
  "unexpected-category",
  "unknown-page-route",
  "invalid-date",
  "missing-published-at",
  "slug-changed",
  "route-collision",
  "not-published",
] as const

export type PublishValidationCode = (typeof PUBLISH_VALIDATION_CODES)[number]

export interface PublishValidationIssue {
  pageId: string
  code: PublishValidationCode
  message: string
}

export interface PreparedPageRevision {
  revision: PageRevision
  action: PublishAction
  route: string | null
  effectivePublishedAt: string | null
  issues: Array<PublishValidationIssue>
}

export const PUBLISH_FAILURE_CODES = [
  ...PUBLISH_VALIDATION_CODES,
  "page-not-found",
  "invalid-page",
  "publish-failed",
] as const

export type PublishFailureCode = (typeof PUBLISH_FAILURE_CODES)[number]

export interface PublishFailure {
  pageId: string
  code: PublishFailureCode
  message: string
}

export interface PublishJobRequest {
  workflowId: string
  params: PublishWorkflowParams
  pages: Array<PreparedPageRevision>
}

export type PublishJobPageResult =
  | {
      pageId: string
      action: "publish"
      deployedAt: string
      publishedAt: string
      contentHash: string
      // 内容が変わった再公開で決めた新しい 更新日。Notion へ書き戻すときだけ値が入る
      updatedAt: string | null
      // build に使った本文の hash（createFetchedArticleHash）。公開ボタンでは、Notion へ書き戻す直前に
      // 取り直した本文と比べる。rollout 中の古い Container は返さないので null がありうる
      fetchedHash: string | null
    }
  | {
      pageId: string
      action: "unpublish"
      deployedAt: string
      contentHash: null
    }

export interface PublishJobSummary {
  workflowId: string
  buildHash: string
  pages: Array<PublishJobPageResult>
  failed: Array<PublishFailure>
  // generate の途中で Notion 側が触られたので、Notion の本文では作り直さなかった page。
  // 最後に公開した版（snapshot）から作り直すので、未公開の編集は出ない
  skipped: Array<string>
  // generate で、最後に公開した版からも作り直せず、前のアプリの HTML のまま残した page
  stale: Array<string>
  updatedPaths: Array<string>
}

// full / bootstrap は結果を待たずに受け付けるため、状態を polling で取りに行く。
// unknown は Container が job を見失った状態（再作成された、など）
export type PublishJobState =
  | { status: "running" }
  | { status: "done"; summary: PublishJobSummary }
  | { status: "failed"; message: string }
  | { status: "unknown" }

export interface PublishWorkflowFailure {
  pageId: string
  code: PublishFailureCode
}

export interface PublishWorkflowResult {
  workflowId: string
  status: "completed" | "completed-with-errors"
  publishedPageIds: Array<string>
  unpublishedPageIds: Array<string>
  failed: Array<PublishWorkflowFailure>
  // generate が未公開の変更を見つけて、Notion の本文では作り直さなかった page（最後に公開した版で作り直す）
  skippedPageIds: Array<string>
  // generate で、最後に公開した版からも作り直せず、前のアプリの HTML のまま残した page
  stalePageIds: Array<string>
}

const isValidDate = (value: string): boolean => {
  return !Number.isNaN(Date.parse(value))
}

const issue = (
  revision: PageRevision,
  code: PublishValidationCode,
  message: string,
): PublishValidationIssue => {
  return { pageId: revision.pageId, code, message }
}

export const resolvePublishAction = (
  state: InternalState | null,
  mode: PublishMode,
): PublishAction => {
  if (mode === "partial") {
    if (state === "公開待ち") {
      return "publish"
    }
    if (state === "非公開待ち") {
      return "unpublish"
    }

    return "noop"
  }
  if (state === "公開中") {
    return "publish"
  }

  return "noop"
}

// 公開エラー をどこで書いたかを文面の先頭で残す。generate は自分で書いたものだけを、作り直せたときに消す
export const GENERATE_PUBLISH_ERROR_PREFIX = "generate で失敗しました"
export const BOOTSTRAP_PUBLISH_ERROR_PREFIX = "bootstrap で失敗しました"

export const isGeneratePublishError = (error: string): boolean => {
  return error.startsWith(GENERATE_PUBLISH_ERROR_PREFIX)
}

// generate が Notion の今の本文で作り直してよいのは、最後に公開した本文から誰も触っていない記事だけ。
// 公開ボタンが失敗した記事は、書き戻しで最後の書き手が integration になるが、公開できなかった編集が本文に残っている
const hasUnpublishedChanges = (revision: PageRevision, publisherUserId: string): boolean => {
  if (revision.lastEditedBy !== publisherUserId) {
    return true
  }

  return revision.publishError !== "" && !isGeneratePublishError(revision.publishError)
}

export const selectGenerateRevisions = (
  revisions: Array<PageRevision>,
  publisherUserId: string,
): { revisions: Array<PageRevision>; skippedPageIds: Array<string> } => {
  const selected: Array<PageRevision> = []
  const skippedPageIds: Array<string> = []
  for (const revision of revisions) {
    if (revision.internalState === "公開中" && hasUnpublishedChanges(revision, publisherUserId)) {
      skippedPageIds.push(revision.pageId)
    } else {
      selected.push(revision)
    }
  }

  return { revisions: selected, skippedPageIds }
}

export const isPageRevisionUnchanged = (expected: PageRevision, current: PageRevision): boolean => {
  return (
    expected.lastEditedTime === current.lastEditedTime &&
    expected.lastEditedBy === current.lastEditedBy &&
    expected.internalState === current.internalState &&
    expected.publishError === current.publishError
  )
}

export const createEmptyDeploymentState = (updatedAt: string): SiteDeploymentState => {
  return {
    schemaVersion: 1,
    updatedAt,
    pages: {},
    routeOwners: {},
  }
}

export const omitIgnoredFixedPages = (state: SiteDeploymentState): SiteDeploymentState => {
  const pages = Object.fromEntries(
    Object.entries(state.pages).filter(([, page]) => {
      return page.kind !== "page" || !isIgnoredFixedPageSlug(page.slug)
    }),
  )

  return {
    ...state,
    pages,
    routeOwners: Object.fromEntries(Object.values(pages).map((page) => [page.route, page.pageId])),
  }
}

export const validatePageRevisionMetadata = (
  revision: PageRevision,
  mode: PublishMode,
  requestedAt: string,
): PreparedPageRevision => {
  const issues: Array<PublishValidationIssue> = []
  const action = resolvePublishAction(revision.internalState, mode)
  const route = resolvePublicRoute(revision.kind, revision.slug)

  if (mode === "partial" && action === "noop") {
    issues.push(issue(revision, "invalid-state", "internal-state が公開待ち状態ではありません"))
  }
  // generate / bootstrap で internal-state が空なのは、貼り付けなどでテンプレートを通らずにできた row で、
  // 下書きと同じく何もしない。公開したことのある page で空なのは壊れているので失敗にする。
  // ここは Worker の preflight でも通り publish index を持たないので、公開したかは Notion の last-deploy で見る
  if (mode !== "partial" && !revision.internalState && revision.lastDeploy) {
    issues.push(issue(revision, "invalid-state", "internal-state が空です"))
  }
  if (mode !== "partial" && action === "noop") {
    return { revision, action, route, effectivePublishedAt: revision.publishedAt, issues }
  }
  if (!revision.title.trim()) {
    issues.push(issue(revision, "missing-title", "title が空です"))
  }
  if (!isValidSlug(revision.slug)) {
    issues.push(issue(revision, "invalid-slug", "slug の形式が不正です"))
  } else if (revision.kind === "post" && isReservedPostSlug(revision.slug)) {
    issues.push(issue(revision, "reserved-slug", "記事に予約 slug は使えません"))
  }

  if (revision.kind === "post") {
    if (!revision.category) {
      issues.push(issue(revision, "missing-category", "記事には category が必要です"))
    } else if (!isValidSlug(revision.category.slug)) {
      issues.push(issue(revision, "invalid-category", "category slug の形式が不正です"))
    }
  } else if (revision.category) {
    issues.push(issue(revision, "unexpected-category", "固定ページに category は指定できません"))
  }

  if (revision.kind === "page" && isValidSlug(revision.slug) && !route) {
    issues.push(issue(revision, "unknown-page-route", "固定ページの route mapping がありません"))
  }

  for (const value of [
    revision.lastEditedTime,
    revision.lastDeploy,
    revision.lastNotionEdit,
    revision.publishedAt,
    revision.updatedAt,
  ]) {
    if (value && !isValidDate(value)) {
      issues.push(issue(revision, "invalid-date", `日付の形式が不正です: ${value}`))
    }
  }

  let effectivePublishedAt = revision.publishedAt
  if (action === "publish" && !effectivePublishedAt) {
    if (mode === "partial" && isValidDate(requestedAt)) {
      effectivePublishedAt = requestedAt
    } else {
      issues.push(issue(revision, "missing-published-at", "公開日がありません"))
    }
  }

  return { revision, action, route, effectivePublishedAt, issues }
}

export const overlayDeploymentState = (
  state: SiteDeploymentState,
  changes: Array<DeployedPage>,
  updatedAt: string,
): SiteDeploymentState => {
  const next: SiteDeploymentState = {
    schemaVersion: 1,
    updatedAt,
    pages: { ...state.pages },
    routeOwners: { ...state.routeOwners },
  }

  for (const page of changes) {
    const current = next.pages[page.pageId]
    if (current && current.route !== page.route) {
      throw Error(`公開済み page の route は変更できません: ${page.pageId}`)
    }

    const owner = next.routeOwners[page.route]
    if (owner && owner !== page.pageId) {
      throw Error(`route は別の page が所有しています: ${page.route}`)
    }

    next.pages[page.pageId] = page
    next.routeOwners[page.route] = page.pageId
  }

  return next
}

export const preparePageRevision = (
  revision: PageRevision,
  mode: PublishMode,
  requestedAt: string,
  deploymentState: SiteDeploymentState,
): PreparedPageRevision => {
  const prepared = validatePageRevisionMetadata(revision, mode, requestedAt)
  const issues = [...prepared.issues]
  const { action, route } = prepared
  const deployed = deploymentState.pages[revision.pageId]

  if (deployed && deployed.slug !== revision.slug) {
    issues.push(issue(revision, "slug-changed", "公開済み page の slug は変更できません"))
  }
  if (route) {
    const owner = deploymentState.routeOwners[route]
    if (owner && owner !== revision.pageId) {
      issues.push(issue(revision, "route-collision", "route は別の page が所有しています"))
    }
  }
  // すでに非公開の page をもう一度非公開にするのは失敗にしない（応答が失われたあとのやり直しも、
  // 非公開の記事でうっかりボタンを押したときも同じ）。一度も公開していない page だけを断る
  if (action === "unpublish" && !deployed) {
    issues.push(issue(revision, "not-published", "未公開の page は非公開にできません"))
  }

  let { effectivePublishedAt } = prepared
  if (action === "unpublish" && deployed) {
    effectivePublishedAt = deployed.publishedAt
  }

  return { revision, action, route, effectivePublishedAt, issues }
}
