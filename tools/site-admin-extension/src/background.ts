import {
  createPageViewSql,
  isPageAdminDataRequest,
  NOTION_API_VERSION,
  type PageAdminData,
  type PageAdminDataRequest,
  type PageAdminDataResponse,
  parsePageViewSum,
  pickNotionPageUrl,
  resolveSite,
  type SiteConfig,
  toPageViewPath,
} from "./admin-data"

// Notion のページを持たないので、PV だけを出す
const PAGES_WITHOUT_NOTION = new Set(["/", "/entry-list/"])

const requireEnv = (name: string, value: string | undefined): string => {
  if (!value) {
    throw Error(`.env.local に ${name} がありません`)
  }

  return value
}

const fetchPageViews = async (site: SiteConfig, path: string): Promise<number> => {
  const accountId = requireEnv(
    "VITE_CLOUDFLARE_ACCOUNT_ID",
    import.meta.env.VITE_CLOUDFLARE_ACCOUNT_ID,
  )
  const token = requireEnv("VITE_CLOUDFLARE_API_TOKEN", import.meta.env.VITE_CLOUDFLARE_API_TOKEN)
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: createPageViewSql(site.dataset, path),
    },
  )
  if (!response.ok) {
    throw Error(`Analytics Engine の SQL API が失敗しました: ${response.status}`)
  }

  return parsePageViewSum(await response.json())
}

const queryNotionPageUrl = async (dataSourceId: string, slug: string): Promise<string | null> => {
  const token = requireEnv("VITE_NOTION_TOKEN", import.meta.env.VITE_NOTION_TOKEN)
  const response = await fetch(`https://api.notion.com/v1/data_sources/${dataSourceId}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filter: { property: "slug", rich_text: { equals: slug } },
      page_size: 1,
    }),
  })
  if (!response.ok) {
    throw Error(`Notion でページを引けませんでした: ${response.status}`)
  }

  return pickNotionPageUrl(await response.json())
}

const findEditUrl = async (site: SiteConfig, path: string): Promise<string | null> => {
  if (PAGES_WITHOUT_NOTION.has(path)) {
    return null
  }
  const slug = path.slice(1, -1)

  return (
    (await queryNotionPageUrl(site.postsDataSourceId, slug)) ??
    (await queryNotionPageUrl(site.pagesDataSourceId, slug))
  )
}

const loadPageAdminData = async (request: PageAdminDataRequest): Promise<PageAdminData> => {
  const site = resolveSite(request.host)
  if (!site) {
    throw Error(`対象外のホストです: ${request.host}`)
  }
  const path = toPageViewPath(request.path)
  if (!path) {
    throw Error(`PV を数えないパスです: ${request.path}`)
  }
  const [pv, editUrl] = await Promise.all([fetchPageViews(site, path), findEditUrl(site, path)])

  return { pv, editUrl }
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse: (response: PageAdminDataResponse) => void) => {
    if (!isPageAdminDataRequest(message)) {
      return false
    }
    void loadPageAdminData(message).then(
      (data) => sendResponse({ ok: true, data }),
      (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    )

    // 非同期に sendResponse するので、チャンネルを開いたままにする
    return true
  },
)
