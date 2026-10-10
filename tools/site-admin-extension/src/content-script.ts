import type { PageAdminData, PageAdminDataRequest, PageAdminDataResponse } from "./admin-data"
import { toPageViewPath } from "./admin-data"

main(null)

window.addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) {
    return
  }

  const link = event.target.closest<HTMLAnchorElement>("a")
  if (!link) {
    return
  }

  const to = link.getAttribute("href")
  if (!to) {
    return
  }

  // Avoid including hash(#) in slug
  if (!/(.*?)(#.*?)$/.test(to)) {
    cleanup()
    await main(to)
  }
})

async function main(to: string | null): Promise<void> {
  const target = new URL(to ?? window.location.href, window.location.href)
  // 外へのリンクと、PV を数えないページ（2 階層以上など）では何も出さない
  if (target.origin !== window.location.origin || !toPageViewPath(target.pathname)) return

  const res = await fetchData(target.pathname)
  if (!res) return
  const { pv, editUrl } = res

  const box = document.createElement("div")
  const counter = document.createElement("div")
  const editLink = document.createElement("div")
  const a = document.createElement("a")

  box.id = "site-admin-extension"
  counter.textContent = `PV: ${pv.toString()}`
  a.href = editUrl ?? ""
  a.textContent = "編集"
  a.style.cssText = `
    color: #fff;
    font-weight: normal;
  `
  editLink.appendChild(a)

  box.style.cssText = `
    display: block;
    position: fixed;
    bottom: 37px;
    left: 29px;
    padding: 5px 8px;
    background-color: #898989b5;
    border-radius: 3.3px;
    font-size: 0.9em;
    line-height: 1.5;
    text-align: center;
    z-index: 999999;
  `
  const innerStyle = `
    color: #ffffff;
    line-height: 1.5;
  `
  counter.style.cssText = innerStyle
  editLink.style.cssText = innerStyle

  box.appendChild(counter)
  // トップと記事一覧は Notion のページがないので、編集リンクを出さない
  if (editUrl) {
    box.appendChild(editLink)
  }
  document.body.appendChild(box)
}

// PV は Analytics Engine、編集リンクは Notion から、background の service worker が読む
async function fetchData(path: string): Promise<PageAdminData | null> {
  const response = await chrome.runtime.sendMessage<PageAdminDataRequest, PageAdminDataResponse>({
    type: "page-admin-data",
    host: window.location.host,
    path,
  })
  if (!response.ok) {
    console.warn(`site-admin-extension: ${response.error}`)
    return null
  }

  return response.data
}

function cleanup(): void {
  document.getElementById("site-admin-extension")?.remove()
}
