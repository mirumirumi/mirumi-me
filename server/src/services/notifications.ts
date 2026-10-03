import type { InternalState, PublishMode } from "../lib/publishing"
import { createNotionPageUrl, formatJst } from "./comment-digest"

// Slack に送る文面。送るのは呼び出し側（createSlackNotifier）で、ここは組み立てだけ

const MAX_LISTED_PAGES = 20
const MAX_MESSAGE_CHARS = 300
export const STUCK_PUBLISH_THRESHOLD_MS = 2 * 60 * 60 * 1_000

export interface PublishFailureNoticeItem {
  pageId: string
  title: string
  slug: string
  message: string
}

export interface PublishFailureNotice {
  workflowId: string
  mode: PublishMode
  failures: Array<PublishFailureNoticeItem>
}

export interface StuckPublishPage {
  pageId: string
  title: string
  slug: string
  internalState: InternalState | null
  lastEditedTime: string
}

const MODE_LABELS: Record<PublishMode, string> = {
  partial: "公開ボタンの処理",
  full: "generate",
  bootstrap: "bootstrap",
}

const NEXT_ACTIONS: Record<PublishMode, string> = {
  partial: "Notion の 公開エラー を確かめて、直してから「公開」を押し直してください",
  full: "これらの記事は前に公開した内容で配信しています。直せば、次の generate か「公開」で戻ります",
  bootstrap: "これらの記事は 下書き に戻しました。直してから「公開」を押してください",
}

export const createSiteLabel = (appEnv: string | undefined): string => {
  return appEnv === "prd" ? "mirumi.me" : `mirumi.me (${appEnv ?? "dev"})`
}

export const publishModeLabel = (mode: PublishMode): string => {
  return MODE_LABELS[mode]
}

// 「generate で」「公開ボタンの処理で」のように、半角で終わる語のあとにだけ半角スペースを入れる
const withParticle = (label: string, particle: string): string => {
  return /[A-Za-z0-9]$/.test(label) ? `${label} ${particle}` : `${label}${particle}`
}

const truncate = (value: string): string => {
  const flat = value.replaceAll(/\s+/g, " ").trim()

  return flat.length <= MAX_MESSAGE_CHARS ? flat : `${flat.slice(0, MAX_MESSAGE_CHARS)}…`
}

const pageLine = (page: { title: string; slug: string }): string => {
  return `${page.title.trim() || "（無題）"}（${page.slug || "slug なし"}）`
}

const listPages = <T>(pages: Array<T>, render: (page: T) => Array<string>): Array<string> => {
  const listed = pages.slice(0, MAX_LISTED_PAGES).flatMap(render)
  const rest = pages.length - MAX_LISTED_PAGES

  return 0 < rest ? [...listed, `（ほか ${rest} 件）`] : listed
}

export const createPublishFailureMessage = (
  notice: PublishFailureNotice,
  siteLabel: string,
): string => {
  return [
    `[${siteLabel}] ${withParticle(MODE_LABELS[notice.mode], "で")} ${notice.failures.length} 件の記事が失敗しました`,
    ...listPages(notice.failures, (failure) => [
      `・${pageLine(failure)}: ${truncate(failure.message)}`,
      `  ${createNotionPageUrl(failure.pageId)}`,
    ]),
    NEXT_ACTIONS[notice.mode],
    `Workflow: ${notice.workflowId}`,
  ].join("\n")
}

export const createWorkflowErrorMessage = (input: {
  siteLabel: string
  label: string
  workflowId: string
  message: string
}): string => {
  return [
    `[${input.siteLabel}] ${withParticle(input.label, "が")}途中で止まりました`,
    `理由: ${truncate(input.message)}`,
    `Workflow: ${input.workflowId}`,
  ].join("\n")
}

export const createStuckPublishMessage = (
  pages: Array<StuckPublishPage>,
  siteLabel: string,
): string => {
  return [
    `[${siteLabel}] 公開待ち / 非公開待ち のまま 2 時間以上止まっている記事が ${pages.length} 件あります`,
    ...listPages(pages, (page) => [
      `・${pageLine(page)}: ${page.internalState ?? "状態なし"}（${formatJst(page.lastEditedTime)} から）`,
      `  ${createNotionPageUrl(page.pageId)}`,
    ]),
    "Webhook の取りこぼしなどで処理が始まっていません。Notion のボタンを押し直しても値が変わらず動かないので、POST /admin/publish に pageId を渡して流し直してください",
  ].join("\n")
}

export interface StuckPublishCheckDependencies {
  loadStuckPages(before: string): Promise<Array<StuckPublishPage>>
  notify(text: string): Promise<void>
  now(): Date
}

export const runStuckPublishCheck = async (
  dependencies: StuckPublishCheckDependencies,
  siteLabel: string,
): Promise<{ count: number; notified: boolean }> => {
  const before = new Date(dependencies.now().getTime() - STUCK_PUBLISH_THRESHOLD_MS).toISOString()
  const pages = await dependencies.loadStuckPages(before)
  if (pages.length === 0) {
    return { count: 0, notified: false }
  }
  await dependencies.notify(createStuckPublishMessage(pages, siteLabel))

  return { count: pages.length, notified: true }
}
