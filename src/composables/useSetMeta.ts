import { PageMeta } from "@/utils/defines"

export default (p: PageMeta) => {
  const url = new URL(p.url)
  const pureFullpath = url.origin + url.pathname
  let urlWithTrailingSlash = pureFullpath
  if (!pureFullpath.endsWith("/")) {
    urlWithTrailingSlash += "/"
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
      { property: "article:published_time", content: p.createdAt },
      { property: "article:modified_time", content: p.updatedAt },
      { property: "og:description", content: p.description },
      { property: "og:title", content: p.title },
      { property: "og:url", content: p.url },
      { property: "twitter:title", content: p.title },
      { property: "twitter:url", content: p.url },
      { property: "twitter:description", content: p.description },
    ],
    link: [
      { rel: "canonical", href: urlWithTrailingSlash },
    ],
  })
}
