import type { DeployedPage } from "../lib/publishing"

const SITE_ORIGIN = "https://mirumi.me"
const FEED_ITEMS = 7

const escapeXml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

const cdata = (value: string): string => {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`
}

const rssDate = (value: string): string => {
  return new Date(value).toUTCString().replace("GMT", "+0000")
}

export const generateSiteFeed = (pages: Array<DeployedPage>, siteOrigin = SITE_ORIGIN): string => {
  const posts = pages
    .filter((page) => page.status === "published" && page.kind === "post")
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))
    .slice(0, FEED_ITEMS)
  const lastBuildDate = posts.reduce((latest, page) => {
    return Math.max(latest, Date.parse(page.updatedAt ?? page.publishedAt))
  }, 0)
  const items = posts.flatMap((page) => {
    const link = new URL(page.route, siteOrigin).href

    return [
      "  <item>",
      `    <title>${escapeXml(page.title)}</title>`,
      `    <link>${escapeXml(link)}</link>`,
      `    <guid isPermaLink="true">${escapeXml(link)}</guid>`,
      `    <dc:creator>${cdata("みるみ")}</dc:creator>`,
      `    <pubDate>${rssDate(page.publishedAt)}</pubDate>`,
      ...(page.category ? [`    <category>${cdata(page.category.name)}</category>`] : []),
      `    <description>${cdata(page.excerpt ?? "")}</description>`,
      "  </item>",
    ]
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    "<channel>",
    "  <title>みるめも</title>",
    `  <atom:link href="${escapeXml(new URL("/feed.xml", siteOrigin).href)}" rel="self" type="application/rss+xml" />`,
    `  <link>${escapeXml(siteOrigin)}</link>`,
    "  <description>みるみのブログ</description>",
    ...(lastBuildDate
      ? [`  <lastBuildDate>${rssDate(new Date(lastBuildDate).toISOString())}</lastBuildDate>`]
      : []),
    "  <language>ja</language>",
    ...items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n")
}
