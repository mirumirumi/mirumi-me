import type { ArticleContent, RenderedContent } from "shared/content"

const SITE_ORIGIN = "https://mirumi.me"

const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const formatDate = (isoDate: string): string => {
  const date = new Date(isoDate)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")

  return `${year}/${month}/${day}`
}

const icon = (path: string, left: string, top: string, width = "1.1em"): string => {
  return `<svg focusable="false" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="position:absolute;top:${top};bottom:0;left:${left};margin:auto;width:${width}"><path fill="var(--color-gray)" d="${path}"></path></svg>`
}

const atIcon = icon(
  "M256 64C150 64 64 150 64 256s86 192 192 192c17.7 0 32 14.3 32 32s-14.3 32-32 32C114.6 512 0 397.4 0 256S114.6 0 256 0S512 114.6 512 256l0 32c0 53-43 96-96 96c-29.3 0-55.6-13.2-73.2-33.9C320 371.1 289.5 384 256 384c-70.7 0-128-57.3-128-128s57.3-128 128-128c27.9 0 53.7 8.9 74.7 24.1c5.7-5 13.1-8.1 21.3-8.1c17.7 0 32 14.3 32 32l0 80 0 32c0 17.7 14.3 32 32 32s32-14.3 32-32l0-32c0-106-86-192-192-192zm64 192a64 64 0 1 0 -128 0 64 64 0 1 0 128 0z",
  "-2.3em",
  "3px",
)
const folderIcon = icon(
  "M64 480H448c35.3 0 64-28.7 64-64V160c0-35.3-28.7-64-64-64H288c-10.1 0-19.6-4.7-25.6-12.8L243.2 57.6C231.1 41.5 212.1 32 192 32H64C28.7 32 0 60.7 0 96V416c0 35.3 28.7 64 64 64z",
  "-2.3em",
  "3px",
)
const calendarIcon = icon(
  "M128 0c17.7 0 32 14.3 32 32l0 32 128 0 0-32c0-17.7 14.3-32 32-32s32 14.3 32 32l0 32 48 0c26.5 0 48 21.5 48 48l0 48L0 160l0-48C0 85.5 21.5 64 48 64l48 0 0-32c0-17.7 14.3-32 32-32zM0 192l448 0 0 272c0 26.5-21.5 48-48 48L48 512c-26.5 0-48-21.5-48-48L0 192z",
  "-2.3em",
  "1px",
)
const updatedIcon = icon(
  "M75 75L41 41C25.9 25.9 0 36.6 0 57.9L0 168c0 13.3 10.7 24 24 24l110.1 0c21.4 0 32.1-25.9 17-41l-30.8-30.8C155 85.5 203 64 256 64c106 0 192 86 192 192s-86 192-192 192c-40.8 0-78.6-12.7-109.7-34.4c-14.5-10.1-34.4-6.6-44.6 7.9s-6.6 34.4 7.9 44.6C151.2 495 201.7 512 256 512c141.4 0 256-114.6 256-256S397.4 0 256 0C185.3 0 121.3 28.7 75 75zm181 53c-13.3 0-24 10.7-24 24l0 104c0 6.4 2.5 12.5 7 17l72 72c9.4 9.4 24.6 9.4 33.9 0s9.4-24.6 0-33.9l-65-65 0-94.1c0-13.3-10.7-24-24-24z",
  "0.35em",
  "2px",
  "0.93em",
)

const renderThumbnail = (article: ArticleContent): string => {
  if (!article.thumbnailUrl) {
    return ""
  }

  return `<div class="thumbnail page_transition_target run" itemprop="image" itemscope itemtype="https://schema.org/ImageObject"><img src="${escapeHtml(article.thumbnailUrl)}" alt="${escapeHtml(article.title)}" width="1200" height="630"><meta itemprop="url" content="${escapeHtml(article.thumbnailUrl)}"><meta itemprop="width" content="1200"><meta itemprop="height" content="630"></div>`
}

const renderCategory = (article: ArticleContent): string => {
  if (!article.category) {
    return ""
  }

  return `<div class="category">${folderIcon}<a href="https://mirumi.me/category/${encodeURIComponent(article.category.slug)}"><span>${escapeHtml(article.category.name)}</span></a></div>`
}

const renderUpdatedAt = (article: ArticleContent): string => {
  if (!article.updatedAt || article.updatedAt === article.publishedAt) {
    return ""
  }

  return `<span class="updated_at"><span class="parentheses first">（</span>${updatedIcon}<time datetime="${escapeHtml(article.updatedAt)}" itemprop="dateModified">${formatDate(article.updatedAt)}</time><span class="parentheses">）</span></span>`
}

export const renderPreviewArticle = (
  article: ArticleContent,
  renderedContent: RenderedContent,
): string => {
  return `<div class="post_view article_layout"><main role="main" itemscope itemtype="https://schema.org/Blog"><header itemscope itemprop="blogPost" itemtype="https://schema.org/BlogPosting"><h1 class="title page_transition_target run" itemprop="headline">${escapeHtml(article.title)}</h1>${renderThumbnail(article)}<div class="meta page_transition_target run" role="contentinfo"><div class="meta_block"><div class="author">${atIcon}<a href="https://x.com/__mirumi__" target="_blank" rel="nofollow">みるみ</a></div>${renderCategory(article)}<div class="dates">${calendarIcon}<span class="created_at"><time datetime="${escapeHtml(article.publishedAt)}" itemprop="datePublished">${formatDate(article.publishedAt)}</time></span>${renderUpdatedAt(article)}</div></div></div></header><article class="page_transition_target run"><div id="content" itemprop="mainEntityOfPage">${renderedContent.html}</div></article></main></div>`
}

const previewStyle = `
body { background-color: var(--color-background); padding-top: 3em; }
#content .color-blue { color: #2383e2; }
#content .color-gray { color: #999999; }
@media (prefers-color-scheme: dark) {
  #content .color-gray { color: #808080; }
}
`

const previewThemeScript = `
<script data-preview-theme>
(() => {
  const forcedTheme = new URLSearchParams(window.location.search).get("theme")
  const darkMode = window.matchMedia("(prefers-color-scheme: dark)")
  const applyTheme = () => {
    const isDark = forcedTheme === "dark" || (forcedTheme !== "light" && darkMode.matches)
    document.documentElement.classList.toggle("dark", isDark)
    document.documentElement.style.colorScheme = isDark ? "dark" : "light"
  }

  applyTheme()
  if (forcedTheme !== "dark" && forcedTheme !== "light") {
    darkMode.addEventListener("change", applyTheme)
  }
})()
</script>
`

const safeStyle = (value: string): string => {
  return value.replaceAll(/<\/style/gi, "<\\/style")
}

export const resolvePreviewStylesheetUrl = (href: string): string | null => {
  try {
    const url = new URL(href, SITE_ORIGIN)
    if (url.origin !== SITE_ORIGIN) {
      return null
    }

    return url.href
  } catch {
    return null
  }
}

export const applyPreviewTemplate = (
  template: Response,
  title: string,
  articleHtml: string,
  customCss: string,
): Response => {
  const headContent = `<meta name="robots" content="noindex,nofollow"><style>${previewStyle}${safeStyle(customCss)}</style>${previewThemeScript}`
  const transformed = new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(headContent, { html: true })
      },
    })
    .on('link[rel="stylesheet"]', {
      element(element) {
        const href = element.getAttribute("href")
        if (!href) {
          return
        }

        const stylesheetUrl = resolvePreviewStylesheetUrl(href)
        if (!stylesheetUrl) {
          return
        }

        element.setAttribute("href", stylesheetUrl)
        element.removeAttribute("crossorigin")
      },
    })
    .on("title", {
      element(element) {
        element.setInnerContent(`${title} | プレビュー`)
      },
    })
    .on("body", {
      element(element) {
        element.setInnerContent(articleHtml, { html: true })
      },
    })
    .on("script", {
      element(element) {
        if (element.hasAttribute("data-preview-theme")) {
          return
        }

        element.remove()
      },
    })
    .on('link[rel="modulepreload"]', {
      element(element) {
        element.remove()
      },
    })
    .transform(template)
  const headers = new Headers()
  headers.set("Cache-Control", "private, no-store")
  headers.set("Content-Type", "text/html; charset=UTF-8")
  headers.set("X-Robots-Tag", "noindex, nofollow")

  return new Response(transformed.body, { status: 200, headers })
}
