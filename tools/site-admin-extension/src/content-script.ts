const API_DOMAIN = "mirumi.in"
const BASE_URL = `https://${API_DOMAIN}/wp-json/mirumi`

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
  let slug = to ? to.slice(1) : window.location.pathname.slice(1)
  slug = slug.replace(/(.*?)\/$/gim, "$1")

  let res = null
  if (!/.*?\/.*?/gim.test(slug) && !new URL(window.location.href).searchParams.get("p")) {
    // In case of NOT the top page and NOT the preview for newly page

    res = await fetchData(slug)
  }
  if (!res) return
  const { pv, editUrl } = res

  const box = document.createElement("div")
  const counter = document.createElement("div")
  const editLink = document.createElement("div")
  const a = document.createElement("a")

  box.id = "site-admin-extension"
  counter.textContent = `PV: ${pv.toString()}`
  a.href = `${editUrl}`
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
  box.appendChild(editLink)
  document.body.appendChild(box)
}

// 🔴ここは明確に Notion 用に修正必要
async function fetchData(slug: string): Promise<{ pv: string; editUrl: string }> {
  let postId: number | string = "0"

  if (slug.length === 0) {
    // In case of the top page

    postId = "12717"
  } else {
    postId = await fetchJson<number | string>(`/post_id_with_post_slug/${slug}`)
  }

  const editUrl = `https://${API_DOMAIN}/wp-admin/post.php?post=${postId}&action=edit`

  const pageViews = await fetchJson<number | string | null>(`/page_admin_data/${postId}`)
  const pv = pageViews ? pageViews.toString() : "0"

  return { pv, editUrl }
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`)
  if (!response.ok) {
    throw Error(`Request failed: ${response.status} ${response.statusText}`)
  }

  return response.json() as Promise<T>
}

function cleanup(): void {
  document.getElementById("site-admin-extension")?.remove()
}
