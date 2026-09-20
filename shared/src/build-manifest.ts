import { z } from "zod"

import type { ArticleCategory, ArticleContent, RenderedContent } from "./content"

export type PageKind = "post" | "page"
export type PublishMode = "partial" | "full" | "bootstrap"

export interface ThumbnailUrls {
  article: string
  mobile: string
  card: string
}

export const BUILD_MANIFEST_FILES = {
  plan: "build-plan.json",
  pageSummaries: "page-summaries.json",
  categories: "categories.json",
  articles: "articles",
} as const

export interface BuildPage {
  schemaVersion: 1
  pageId: string
  kind: PageKind
  title: string
  slug: string
  contentHtml: string
  excerpt: string
  thumbnailUrls: ThumbnailUrls | null
  ogImageUrl: string
  publishedAt: string
  updatedAt: string | null
  category: ArticleCategory | null
  customCss: string
  warnings: Array<string>
}

export interface BuildPageSummary {
  pageId: string
  slug: string
  title: string
  excerpt: string
  publishedAt: string
  updatedAt: string | null
  category: ArticleCategory
  thumbnailUrls: ThumbnailUrls | null
  // カードに出す画像。thumbnail がなければ自動生成 OGP の card variant
  cardImageUrl: string | null
}

export interface PageSummariesManifest {
  schemaVersion: 1
  pages: Array<BuildPageSummary>
}

export interface CategoriesManifest {
  schemaVersion: 1
  categories: Array<ArticleCategory>
}

export interface BuildPlan {
  schemaVersion: 1
  workflowId: string
  mode: PublishMode
  generatedAt: string
  routes: Array<string>
  pageIdsByRoute: Record<string, string>
}

interface CreateBuildPageInput {
  kind: PageKind
  article: ArticleContent
  rendered: RenderedContent
  thumbnailUrls: ThumbnailUrls | null
  ogImageUrl: string
}

const pageIdSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
const dateSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
const routeSchema = z.string().refine((value) => {
  return (
    value.startsWith("/") &&
    !value.includes("?") &&
    !value.includes("#") &&
    !value.includes("\\") &&
    !value.includes("//")
  )
})
const categorySchema = z.strictObject({
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})
const thumbnailUrlsSchema = z.strictObject({
  article: z.string().url(),
  mobile: z.string().url(),
  card: z.string().url(),
})
const buildPageSchema: z.ZodType<BuildPage> = z
  .strictObject({
    schemaVersion: z.literal(1),
    pageId: pageIdSchema,
    kind: z.enum(["post", "page"]),
    title: z.string().min(1),
    slug: z.string().min(1),
    contentHtml: z.string(),
    excerpt: z.string().max(500),
    thumbnailUrls: thumbnailUrlsSchema.nullable(),
    ogImageUrl: z.string().url(),
    publishedAt: dateSchema,
    updatedAt: dateSchema.nullable(),
    category: categorySchema.nullable(),
    customCss: z.string(),
    warnings: z.array(z.string()),
  })
  .superRefine((page, context) => {
    if (page.kind === "post" && !page.category) {
      context.addIssue({ code: "custom", message: "post には category が必要です" })
    }
    if (page.kind === "page" && page.category) {
      context.addIssue({ code: "custom", message: "固定ページに category は指定できません" })
    }
  })
const buildPageSummarySchema: z.ZodType<BuildPageSummary> = z.strictObject({
  pageId: pageIdSchema,
  slug: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().max(500),
  publishedAt: dateSchema,
  updatedAt: dateSchema.nullable(),
  category: categorySchema,
  thumbnailUrls: thumbnailUrlsSchema.nullable(),
  cardImageUrl: z.url().nullable(),
})
const pageSummariesManifestSchema: z.ZodType<PageSummariesManifest> = z.strictObject({
  schemaVersion: z.literal(1),
  pages: z.array(buildPageSummarySchema),
})
const categoriesManifestSchema: z.ZodType<CategoriesManifest> = z.strictObject({
  schemaVersion: z.literal(1),
  categories: z.array(categorySchema),
})
const buildPlanSchema: z.ZodType<BuildPlan> = z
  .strictObject({
    schemaVersion: z.literal(1),
    workflowId: z.string().min(1).max(200),
    mode: z.enum(["partial", "full", "bootstrap"]),
    generatedAt: dateSchema,
    routes: z.array(routeSchema),
    pageIdsByRoute: z.record(routeSchema, pageIdSchema),
  })
  .superRefine((plan, context) => {
    if (new Set(plan.routes).size !== plan.routes.length) {
      context.addIssue({ code: "custom", message: "build route が重複しています" })
    }
  })

export const createBuildPage = (input: CreateBuildPageInput): BuildPage => {
  if (!input.article.publishedAt) {
    throw Error("公開日がありません")
  }
  if (input.kind === "post" && !input.article.category) {
    throw Error("post には category が必要です")
  }
  if (input.kind === "page" && input.article.category) {
    throw Error("固定ページに category は指定できません")
  }

  return buildPageSchema.parse({
    schemaVersion: 1,
    pageId: input.article.id,
    kind: input.kind,
    title: input.article.title,
    slug: input.article.slug,
    contentHtml: input.rendered.html,
    excerpt: createArticleExcerpt(input.article),
    thumbnailUrls: input.thumbnailUrls,
    ogImageUrl: input.ogImageUrl,
    publishedAt: input.article.publishedAt,
    updatedAt: input.article.updatedAt,
    category: input.article.category,
    customCss: input.article.customCss,
    warnings: input.rendered.warnings,
  })
}

export const createArticleExcerpt = (article: ArticleContent): string => {
  const parts: Array<string> = []
  const collect = (blocks: ArticleContent["blocks"]) => {
    for (const block of blocks) {
      if ("richText" in block) {
        parts.push(block.richText.map(({ content }) => content).join(""))
      }
      if (block.type === "table_row") {
        parts.push(block.cells.flatMap((cell) => cell.map(({ content }) => content)).join(" "))
      }
      if ("caption" in block) {
        parts.push(block.caption.map(({ content }) => content).join(""))
      }
      collect(block.children)
    }
  }
  collect(article.blocks)
  const text = parts.join(" ").replaceAll(/\s+/g, " ").trim()

  return text.length < 161 ? text : `${text.slice(0, 160).trimEnd()} […]`
}

export const createPageSummariesManifest = (
  summaries: Array<BuildPageSummary>,
): PageSummariesManifest => {
  if (new Set(summaries.map(({ pageId }) => pageId)).size !== summaries.length) {
    throw Error("page summary の page ID が重複しています")
  }
  if (new Set(summaries.map(({ slug }) => slug)).size !== summaries.length) {
    throw Error("page summary の slug が重複しています")
  }
  summaries.sort((left, right) => {
    const dateOrder = Date.parse(right.publishedAt) - Date.parse(left.publishedAt)

    return dateOrder === 0 ? left.slug.localeCompare(right.slug) : dateOrder
  })

  return pageSummariesManifestSchema.parse({ schemaVersion: 1, pages: summaries })
}

export const createCategoriesManifest = (
  categories: Array<ArticleCategory>,
): CategoriesManifest => {
  const unique = new Map<string, ArticleCategory>()
  for (const category of categories) {
    if (!unique.has(category.slug)) {
      unique.set(category.slug, category)
    }
  }

  return categoriesManifestSchema.parse({
    schemaVersion: 1,
    categories: [...unique.values()],
  })
}

export const parseBuildPage = (value: unknown): BuildPage => {
  return buildPageSchema.parse(value)
}

export const parsePageSummariesManifest = (value: unknown): PageSummariesManifest => {
  return pageSummariesManifestSchema.parse(value)
}

export const parseCategoriesManifest = (value: unknown): CategoriesManifest => {
  return categoriesManifestSchema.parse(value)
}

export const parseBuildPlan = (value: unknown): BuildPlan => {
  return buildPlanSchema.parse(value)
}
