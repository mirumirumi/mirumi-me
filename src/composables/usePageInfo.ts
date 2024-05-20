import type { PageMeta } from "@/utils/defines"

export default (p: PageMeta) => {
  const appConfig = useAppConfig()

  if (!p.createdAt) {
    p.createdAt = appConfig.createdAt
  }
  p.createdAt = p.createdAt.replace(" ", "T") // For data from WordPress
  if (!p.createdAt.includes("+09:00") && !p.createdAt.includes("Z")) {
    p.createdAt = p.createdAt + "+09:00"
  }

  if (!p.updatedAt) {
    p.updatedAt = today()
  }
  p.updatedAt = p.updatedAt.replace(" ", "T") // For data from WordPress
  if (!p.updatedAt.includes("+09:00") && !p.updatedAt.includes("Z")) {
    p.updatedAt = p.updatedAt + "+09:00"
  }

  useSetMeta(p)

  const schema = `
{
  "@context": "https://schema.org",
  "@type": "Article",
  "mainEntityOfPage": {
    "@type": "WebPage",
    "@id": "${p.url}"
  },
  "headline": "${p.title.replaceAll('"', "")}",
  "image": {
    "@type": "ImageObject",
    "url": "${p.thumbnail ?? "https://mirumi.media/main-visual.png"}",
    "width": 1200,
    "height": 630
  },
  "datePublished": "${p.createdAt}",
  "dateModified": "${p.updatedAt}",
  "author": {
    "@type": "Person",
    "name": "みるめも",
    "url": "${appConfig.siteFullPath}"
  },
  "publisher": {
    "@type": "Organization",
    "name": "みるめも",
    "logo": {
      "@type": "ImageObject",
      "url": "https://mirumi.media/main-visual.png",
      "width": 114,
      "height": 60
    }
  },
  "description": "${p.description.replaceAll('"', "")}"
}
`

  useHead({
    script: [{ type: "application/ld+json", children: schema }],
  })
}
