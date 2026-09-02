export const FIXED_PAGE_ROUTES = {
  profile: "/profile/",
  "privacy-policy": "/privacy-policy/",
  "nice-to-meet-you-10": "/nice-to-meet-you-10/",
  about: "/about/",
} as const

export type FixedPageSlug = keyof typeof FIXED_PAGE_ROUTES

export const IGNORED_FIXED_PAGE_SLUGS = ["home", "new-entries", "what-is-this-blog"] as const
const ignoredFixedPageSlugs = new Set<string>(IGNORED_FIXED_PAGE_SLUGS)

const SYSTEM_ROUTE_ROOTS = new Set([
  "s",
  "contact",
  "entry-list",
  "category",
  "assets",
  "_nuxt",
  "api",
  "entries",
])

const NOTION_PAGE_ID = /^[0-9a-f]{32}$/i
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_SLUG_LENGTH = 200

export const normalizeNotionPageId = (value: string): string | null => {
  const compact = value.replaceAll("-", "")
  if (!NOTION_PAGE_ID.test(compact)) {
    return null
  }

  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20),
  ]
    .join("-")
    .toLowerCase()
}

export const isValidSlug = (slug: string): boolean => {
  return slug.length <= MAX_SLUG_LENGTH && SLUG.test(slug)
}

export const isReservedPostSlug = (slug: string): boolean => {
  return (
    slug in FIXED_PAGE_ROUTES || ignoredFixedPageSlugs.has(slug) || SYSTEM_ROUTE_ROOTS.has(slug)
  )
}

export const isIgnoredFixedPageSlug = (slug: string): boolean => {
  return ignoredFixedPageSlugs.has(slug)
}

export const resolvePublicRoute = (kind: "post" | "page", slug: string): string | null => {
  if (!isValidSlug(slug)) {
    return null
  }
  if (kind === "post") {
    return `/${slug}/`
  }

  return FIXED_PAGE_ROUTES[slug as FixedPageSlug] ?? null
}
