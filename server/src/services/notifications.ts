import type { StuckPublishWindow } from "shared/notion"

import type { InternalState, PublishMode, UnpublishedPageReferrer } from "../lib/publishing"
import { createNotionPageUrl, formatJst } from "./comment-digest"

// Slack に送る文面。送るのは呼び出し側（createSlackNotifier）で、ここは組み立てだけ

const MAX_LISTED_PAGES = 20
const MAX_MESSAGE_CHARS = 300
// 毎朝の確認：2 時間以上止まっている記事をすべて出す（直していなければ翌朝も出る）
export const STUCK_PUBLISH_THRESHOLD_MS = 2 * 60 * 60 * 1_000
// 30 分ごとの確認：止まってから 30 分たった記事を 1 回だけ出す。間隔は wrangler.jsonc の Cron と同じにする
export const STUCK_PUBLISH_ALERT_THRESHOLD_MS = 30 * 60 * 1_000
export const STUCK_PUBLISH_ALERT_INTERVAL_MS = 30 * 60 * 1_000

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

export interface UnpublishedReferenceNotice {
  workflowId: string
  pages: Array<{
    pageId: string
    title: string
    slug: string
    referrers: Array<UnpublishedPageReferrer>
  }>
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

export const createUnpublishedReferenceMessage = (
  notice: UnpublishedReferenceNotice,
  siteLabel: string,
): string => {
  const referrerCount = new Set(
    notice.pages.flatMap((page) => page.referrers.map((referrer) => referrer.pageId)),
  ).size

  return [
    `[${siteLabel}] 非公開にした記事を、${referrerCount} 件の記事が内部ブログカードで指しています`,
    ...notice.pages.flatMap((page) => [
      `・${pageLine(page)}を指している記事`,
      ...listPages(page.referrers, (referrer) => [
        `  ・${pageLine(referrer)}`,
        `    ${createNotionPageUrl(referrer.pageId)}`,
      ]),
    ]),
    "これらの記事は、次に「公開」を押したときや generate で作り直すときにカードを解決できず、prd では 公開エラー になります。カードを消すか普通のリンクにしてから「公開」を押してください",
    `Workflow: ${notice.workflowId}`,
  ].join("\n")
}

export const createStuckPublishMessage = (
  pages: Array<StuckPublishPage>,
  siteLabel: string,
  durationLabel: string,
): string => {
  return [
    `[${siteLabel}] 公開待ち / 非公開待ち のまま ${durationLabel}以上止まっている記事が ${pages.length} 件あります`,
    ...listPages(pages, (page) => [
      `・${pageLine(page)}: ${page.internalState ?? "状態なし"}（${formatJst(page.lastEditedTime)} から）`,
      `  ${createNotionPageUrl(page.pageId)}`,
    ]),
    "Webhook の取りこぼしなどで処理が始まっていません。ボタンを押し直しても値が変わらないので動きません。internal-state を押す前の値（下書き / 公開中 / 非公開）に戻し、2 分ほどあけてからもう一度ボタンを押してください（すぐ押すと、戻した変更とまとめて届いて、また始まらないことがあります）。POST /admin/publish に pageId を渡して流し直すこともできます",
  ].join("\n")
}

export interface StuckPublishCheckDependencies {
  loadStuckPages(window: StuckPublishWindow): Promise<Array<StuckPublishPage>>
  notify(text: string): Promise<void>
  now(): Date
}

const notifyStuckPages = async (
  dependencies: StuckPublishCheckDependencies,
  window: StuckPublishWindow,
  siteLabel: string,
  durationLabel: string,
): Promise<{ count: number; notified: boolean }> => {
  const pages = await dependencies.loadStuckPages(window)
  if (pages.length === 0) {
    return { count: 0, notified: false }
  }
  await dependencies.notify(createStuckPublishMessage(pages, siteLabel, durationLabel))

  return { count: pages.length, notified: true }
}

const minutesAgo = (now: Date, ms: number): string => {
  return new Date(now.getTime() - ms).toISOString()
}

export const runStuckPublishCheck = async (
  dependencies: StuckPublishCheckDependencies,
  siteLabel: string,
): Promise<{ count: number; notified: boolean }> => {
  const before = minutesAgo(dependencies.now(), STUCK_PUBLISH_THRESHOLD_MS)

  return notifyStuckPages(dependencies, { before, onOrAfter: null }, siteLabel, "2 時間")
}

// 確認のたびに「止まってから 30〜60 分の記事」だけを見る。前後の確認と範囲が重ならないので、同じ記事は 1 回だけ出る
export const runStuckPublishAlert = async (
  dependencies: StuckPublishCheckDependencies,
  siteLabel: string,
): Promise<{ count: number; notified: boolean }> => {
  const now = dependencies.now()
  const window = {
    before: minutesAgo(now, STUCK_PUBLISH_ALERT_THRESHOLD_MS),
    onOrAfter: minutesAgo(now, STUCK_PUBLISH_ALERT_THRESHOLD_MS + STUCK_PUBLISH_ALERT_INTERVAL_MS),
  }

  return notifyStuckPages(dependencies, window, siteLabel, "30 分")
}
