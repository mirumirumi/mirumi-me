import { PageMeta } from "@/lib/defines"

export default (pageMeta: PageMeta) => {
  useHead({
    title: "<<site name>>",
    titleTemplate: (title) => {
      if (pageMeta && title !== pageMeta.title) return `${pageMeta.title} | ${title}`
      else return title
    },
    meta: [
      { name: "description", content: pageMeta.description },
      { name: "keywords", content: pageMeta.keywords },
      { property: "article:published_time", content: pageMeta.createdAt },
      { property: "article:modified_time", content: pageMeta.updatedAt },
      { property: "og:description", content: pageMeta.description },
      { property: "og:title", content: pageMeta.title },
      { property: "og:url", content: pageMeta.url },
      { property: "twitter:title", content: pageMeta.title },
      { property: "twitter:url", content: pageMeta.url },
      { property: "twitter:description", content: pageMeta.description },
    ],
    link: [
      { rel: "canonical", href: pageMeta.url },
    ],
  })
}
