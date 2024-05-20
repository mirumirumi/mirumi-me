import type { PageMeta } from "@/utils/defines"

export default (p: PageMeta) => {
  const url = new URL(p.url)
  const pureFullpath = url.origin + url.pathname
  let urlWithTrailingSlash = pureFullpath

  // One of for trailing slash issue
  if (!pureFullpath.endsWith("/")) {
    urlWithTrailingSlash += "/"
  }

  // Avoid duplicates for between `/page/1` and `/index.html`
  if (/\/page\/1\/?$/.test(urlWithTrailingSlash)) {
    urlWithTrailingSlash = urlWithTrailingSlash.replace("/page/1", "")
  }

  useHead({
    title: "みるめも",
    titleTemplate: (title) => {
      if (p && title !== p.title) return `${p.title} | ${title}`
      else return `${title} | みるみのブログ`
    },
    meta: [
      { name: "description", content: p.description },
      { name: "keywords", content: p.keywords },
      { name: "thumbnail", content: p.thumbnail },
      { property: "article:published_time", content: p.createdAt },
      { property: "article:modified_time", content: p.updatedAt },
      { property: "og:description", content: p.description },
      { property: "og:title", content: p.title },
      { property: "og:url", content: p.url },
      { property: "og:image", content: p.thumbnail },
      { name: "twitter:title", content: p.title },
      { name: "twitter:url", content: p.url },
      { name: "twitter:description", content: p.description },
      { name: "twitter:image", content: p.thumbnail },
    ],
    link: [{ rel: "canonical", href: urlWithTrailingSlash }],
  })
}
