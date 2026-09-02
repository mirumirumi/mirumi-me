import type { DeployedPage } from "../lib/publishing"

const SITE_ORIGIN = "https://mirumi.me"

export interface SiteSitemapFiles {
  "sitemap.xml": string
  "sitemap-misc.xml": string
  "post-sitemap.xml": string
  "page-sitemap.xml": string
}

const escapeXml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

const lastModified = (page: DeployedPage): string => {
  return new Date(page.updatedAt ?? page.publishedAt).toISOString()
}

const latestModified = (pages: Array<DeployedPage>): string | null => {
  if (pages.length === 0) {
    return null
  }

  return new Date(Math.max(...pages.map((page) => Date.parse(lastModified(page))))).toISOString()
}

const urlSet = (
  pages: Array<DeployedPage>,
  changeFrequency: "daily" | "monthly",
  siteOrigin: string,
): string => {
  const urls = pages.map((page) => {
    return [
      "  <url>",
      `    <loc>${escapeXml(new URL(page.route, siteOrigin).href)}</loc>`,
      `    <lastmod>${lastModified(page)}</lastmod>`,
      `    <changefreq>${changeFrequency}</changefreq>`,
      "    <priority>0.6</priority>",
      "  </url>",
    ].join("\n")
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n")
}

export const generateSiteSitemaps = (
  pages: Array<DeployedPage>,
  siteOrigin = SITE_ORIGIN,
): SiteSitemapFiles => {
  const published = pages.filter(({ status }) => status === "published")
  const posts = published.filter(({ kind }) => kind === "post")
  const contentPages = published.filter(({ kind, route }) => kind === "page" && route !== "/")
  const rootPages = published.filter(({ kind, route }) => kind === "page" && route === "/")
  const miscLastModified = latestModified(published)
  const misc = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    "  <url>",
    `    <loc>${escapeXml(new URL("/", siteOrigin).href)}</loc>`,
    ...(miscLastModified ? [`    <lastmod>${miscLastModified}</lastmod>`] : []),
    "    <changefreq>daily</changefreq>",
    "    <priority>1.0</priority>",
    "  </url>",
    "</urlset>",
    "",
  ].join("\n")
  const sitemapEntries = [
    ["sitemap-misc.xml", latestModified(rootPages) ?? miscLastModified],
    ["post-sitemap.xml", latestModified(posts)],
    ["page-sitemap.xml", latestModified(contentPages)],
  ] as const
  const sitemapIndex = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...sitemapEntries.flatMap(([filename, modified]) => {
      return [
        "  <sitemap>",
        `    <loc>${escapeXml(new URL(`/${filename}`, siteOrigin).href)}</loc>`,
        ...(modified ? [`    <lastmod>${modified}</lastmod>`] : []),
        "  </sitemap>",
      ]
    }),
    "</sitemapindex>",
    "",
  ].join("\n")

  return {
    "sitemap.xml": sitemapIndex,
    "sitemap-misc.xml": misc,
    "post-sitemap.xml": urlSet(posts, "daily", siteOrigin),
    "page-sitemap.xml": urlSet(contentPages, "monthly", siteOrigin),
  }
}
