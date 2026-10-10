// 公開サイトに出す PV と「編集」リンクの読み先。PV は Analytics Engine の SQL API、編集リンクは Notion から引く。
// どちらも background の service worker から読む（content script から api.cloudflare.com や api.notion.com を
// 直接叩くと CORS で落ちるため）

export interface SiteConfig {
  dataset: string
  postsDataSourceId: string
  pagesDataSourceId: string
}

const PRD: SiteConfig = {
  dataset: "mirumi_me_pv_prd",
  // 2026-10-10 に dev から複製して作り直した prd の posts / pages
  postsDataSourceId: "49d65425-ad40-8269-bf93-07fb8e39bc6b",
  pagesDataSourceId: "83565425-ad40-8216-9107-076abcbcbd5b",
}

const DEV: SiteConfig = {
  dataset: "mirumi_me_pv_dev",
  postsDataSourceId: "3c065425-ad40-811a-b50b-000b9271df2c",
  pagesDataSourceId: "dc065425-ad40-8391-8e64-87fc27e80a3a",
}

// 開いているページのホストで dev と prd を分ける
const SITES: Readonly<Record<string, SiteConfig>> = {
  "mirumi.me": PRD,
  "d3unw9ju8hrt73.cloudfront.net": PRD,
  "d3694gpnjd4x49.cloudfront.net": DEV,
}

// shared/src/notion.ts の NOTION_API_VERSION と同じ値（拡張は shared に依存していない）
export const NOTION_API_VERSION = "2026-03-11"

// shared/src/site-routes.ts の slug の形と同じ。SQL に埋め込むので、この形以外は通さない
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const resolveSite = (host: string): SiteConfig | null => {
  return SITES[host] ?? null
}

// Workers が PV を書くとき（shared/src/page-views.ts）と同じく、末尾スラッシュをそろえたトップと 1 階層のページにする
export const toPageViewPath = (pathname: string): string | null => {
  if (pathname === "/") {
    return "/"
  }
  const slug = pathname.match(/^\/([^/]+)\/?$/)?.[1]

  return slug && SLUG.test(slug) ? `/${slug}/` : null
}

// SQL API には placeholder がないので、toPageViewPath を通した値だけを埋め込む
export const createPageViewSql = (dataset: string, path: string): string => {
  return `SELECT SUM(_sample_interval) AS pv FROM ${dataset} WHERE index1 = '${path}' AND timestamp > NOW() - INTERVAL '31' DAY FORMAT JSON`
}

export const parsePageViewSum = (value: unknown): number => {
  const data = (value as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw Error("Analytics Engine の応答を読めませんでした")
  }
  const pv = (data[0] as { pv?: unknown } | undefined)?.pv
  // 1 件も書かれていないページは、行がないか null の合計になる
  const sum = pv === null || pv === undefined ? 0 : Number(pv)
  if (!Number.isFinite(sum)) {
    throw Error("Analytics Engine の応答を読めませんでした")
  }

  return sum
}

export const pickNotionPageUrl = (value: unknown): string | null => {
  const results = (value as { results?: unknown } | null)?.results
  if (!Array.isArray(results)) {
    throw Error("Notion の応答を読めませんでした")
  }
  const url = (results[0] as { url?: unknown } | undefined)?.url

  return typeof url === "string" ? url : null
}

export interface PageAdminDataRequest {
  type: "page-admin-data"
  host: string
  path: string
}

export interface PageAdminData {
  pv: number
  // トップと記事一覧は Notion のページがないので null
  editUrl: string | null
}

export type PageAdminDataResponse = { ok: true; data: PageAdminData } | { ok: false; error: string }

export const isPageAdminDataRequest = (value: unknown): value is PageAdminDataRequest => {
  const request = value as Partial<PageAdminDataRequest> | null

  return (
    request?.type === "page-admin-data" &&
    typeof request.host === "string" &&
    typeof request.path === "string"
  )
}
