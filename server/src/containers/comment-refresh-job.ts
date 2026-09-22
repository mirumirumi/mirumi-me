import { createHash } from "node:crypto"

import type { BuildPage, BuildPlan } from "shared/build-manifest"
import { parseBuildPage } from "shared/build-manifest"
import type { BuildComment } from "shared/comments"
import { createNotionClient } from "shared/notion"

import type { CommentRefreshJobRequest, CommentRefreshJobSummary } from "../lib/comment-refresh"
import type { DeployedPage, SiteDeploymentState } from "../lib/publishing"
import { omitIgnoredFixedPages, overlayDeploymentState } from "../lib/publishing"
import { DeploymentIndexRepository } from "../repositories/deployment-index"
import { completeAppManifest } from "./app-manifest"
import { S3DeploymentIndexStore, S3SiteObjectStore } from "./aws"
import { generateSite } from "./build"
import { NotionPublishCommentSource, type PublishCommentSource } from "./comments"
import type { ContainerConfig } from "./config"
import { createInvalidationPaths, SiteDeployer } from "./deploy"
import { JobProgressReporter } from "./job-progress"
import { createBuildPageContentHash, PublishedPageSnapshotStore } from "./published-pages"

export const findPublishedPostBySlug = (
  state: SiteDeploymentState,
  slug: string,
): DeployedPage | null => {
  return (
    Object.values(state.pages).find((page) => {
      return page.kind === "post" && page.status === "published" && page.slug === slug
    }) ?? null
  )
}

// 配信中の snapshot の comments だけを差し替える。本文は Notion を読み直さないので未公開の編集は混ざらない
export const replaceSnapshotComments = (
  snapshot: BuildPage,
  comments: Array<BuildComment>,
): BuildPage => {
  return parseBuildPage({ ...snapshot, comments })
}

export const createCommentRefreshPlan = (
  workflowId: string,
  generatedAt: string,
  deployed: Pick<DeployedPage, "route" | "pageId">,
): BuildPlan => {
  return {
    schemaVersion: 1,
    workflowId,
    mode: "partial",
    generatedAt,
    routes: [deployed.route],
    pageIdsByRoute: { [deployed.route]: deployed.pageId },
  }
}

// 記事本文の版（deployedNotionEdit / sourceHash）は動かさず、配信物の hash と時刻だけを進める
export const createCommentRefreshedSnapshot = (
  deployed: DeployedPage,
  contentHash: string,
  deployedAt: string,
): DeployedPage => {
  return { ...deployed, contentHash, deployedAt }
}

// Container の応答だけが失われて Workflow の step が retry されると、前回試行が S3 と index を更新済みなので
// comments は「変更なし」に見える。index の deployedAt が自分の requestedAt なら invalidation だけをやり直す
export const isRefreshedByThisRequest = (
  deployed: Pick<DeployedPage, "deployedAt">,
  request: Pick<CommentRefreshJobRequest, "requestedAt">,
): boolean => {
  return deployed.deployedAt === request.requestedAt
}

const buildHash = (workflowId: string, contentHash: string | null): string => {
  return createHash("sha256")
    .update(workflowId)
    .update("\0")
    .update(contentHash ?? "")
    .digest("hex")
    .slice(0, 32)
}

interface CommentRefreshDependencies {
  loadCommentSource: () => Promise<PublishCommentSource>
}

export const runContainerCommentRefreshJob = async (
  request: CommentRefreshJobRequest,
  config: ContainerConfig,
  dependencies: CommentRefreshDependencies = {
    loadCommentSource: () =>
      NotionPublishCommentSource.create(
        createNotionClient(config.notionToken),
        config.notionCommentsDataSourceId,
      ),
  },
): Promise<CommentRefreshJobSummary> => {
  const awsConfig = {
    region: config.awsRegion,
    accessKeyId: config.awsAccessKeyId,
    secretAccessKey: config.awsSecretAccessKey,
  }
  const repository = new DeploymentIndexRepository(
    new S3DeploymentIndexStore(awsConfig, config.siteBucketName),
  )
  const siteStore = new S3SiteObjectStore(awsConfig, config.siteBucketName)
  const progress = new JobProgressReporter(siteStore, request.workflowId)
  await progress.report("prepare", 0, 1)
  const loaded = await repository.load(false, request.requestedAt)
  const state = omitIgnoredFixedPages(loaded.state)
  const deployed = findPublishedPostBySlug(state, request.slug)
  if (!deployed) {
    await progress.report("done", 0, 1)

    return {
      workflowId: request.workflowId,
      slug: request.slug,
      status: "skipped",
      reason: "publish index に公開中の記事がありません",
      pageId: null,
      contentHash: null,
      buildHash: buildHash(request.workflowId, null),
      updatedPaths: [],
    }
  }

  const snapshotStore = new PublishedPageSnapshotStore(siteStore)
  const snapshot = await snapshotStore.load(deployed.pageId, deployed.contentHash)
  if (!snapshot) {
    throw Error(
      `公開済み snapshot がありません。記事を再公開するか full build を通してください: ${request.slug}`,
    )
  }
  await progress.report("load-articles", 0, 1)
  const commentSource = await dependencies.loadCommentSource()
  const page = replaceSnapshotComments(snapshot, await commentSource.loadForSlug(request.slug))
  const contentHash = createBuildPageContentHash(page)
  const plan = createCommentRefreshPlan(request.workflowId, request.requestedAt, deployed)
  if (contentHash === deployed.contentHash) {
    await progress.report("done", 1, 1)
    const repeated = isRefreshedByThisRequest(deployed, request)

    return {
      workflowId: request.workflowId,
      slug: request.slug,
      status: repeated ? "refreshed" : "unchanged",
      reason: null,
      pageId: deployed.pageId,
      contentHash,
      buildHash: buildHash(request.workflowId, contentHash),
      updatedPaths: repeated ? createInvalidationPaths(plan, [], false) : [],
    }
  }

  await progress.report("generate", 0, 1)
  const generated = await generateSite({
    workflowId: request.workflowId,
    plan,
    pages: [page],
    deploymentState: state,
    workersApiOrigin: config.workersApiOrigin,
    appEnv: config.appEnv,
    xml: false,
  })
  // generate 中に承認・非表示が重なった場合は deploy しない。Workflow の retry が最新の集合で作り直す
  const confirmed = replaceSnapshotComments(snapshot, await commentSource.loadForSlug(request.slug))
  if (createBuildPageContentHash(confirmed) !== contentHash) {
    throw Error(`build 中にコメントが変更されました: ${request.slug}`)
  }
  await completeAppManifest(generated.outputDirectory, siteStore, [])
  await progress.report("deploy", 0, 1)
  await snapshotStore.save(page, contentHash)
  const updatedPaths = await new SiteDeployer(siteStore).deploy(
    generated.outputDirectory,
    plan,
    [],
    {
      xml: false,
    },
  )
  const nextState = overlayDeploymentState(
    state,
    [createCommentRefreshedSnapshot(deployed, contentHash, request.requestedAt)],
    request.requestedAt,
  )
  await repository.save(nextState, loaded.etag)
  await progress.report("done", 1, 1)

  return {
    workflowId: request.workflowId,
    slug: request.slug,
    status: "refreshed",
    reason: null,
    pageId: deployed.pageId,
    contentHash,
    buildHash: buildHash(request.workflowId, contentHash),
    updatedPaths,
  }
}
