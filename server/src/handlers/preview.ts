import { Context } from "hono"
import { z } from "zod"

import { createNotionClient, fetchNotionArticle, isNotionObjectNotFound } from "shared/notion"
import { renderArticleContent } from "shared/render"

import { applyPreviewTemplate, renderPreviewArticle } from "../lib/preview"
import { HonoEnv } from "../lib/types"

const querySchema = z.object({
  pageId: z
    .string()
    .regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i),
})

export const getPreview = async (c: Context<HonoEnv>): Promise<Response> => {
  const query = querySchema.safeParse(c.req.query())
  if (!query.success) {
    return c.text("pageId が不正です", 400)
  }
  if (!c.env.NOTION_TOKEN) {
    console.error({ event: "preview_failed", reason: "NOTION_TOKEN is missing" })
    return c.text("プレビューを生成できませんでした", 500)
  }

  try {
    const notion = createNotionClient(c.env.NOTION_TOKEN)
    const article = await fetchNotionArticle(notion, query.data.pageId)
    const renderedContent = renderArticleContent(article)

    const template = await fetch("https://mirumi.me/")
    if (!template.ok) {
      await template.body?.cancel()
      console.error({
        event: "preview_template_failed",
        status: template.status,
        pageId: query.data.pageId,
      })

      return c.text("プレビューのテンプレートを取得できませんでした", 502)
    }

    if (0 < renderedContent.warnings.length) {
      console.warn({
        event: "preview_render_warnings",
        pageId: query.data.pageId,
        warnings: renderedContent.warnings,
      })
    }

    const articleHtml = renderPreviewArticle(article, renderedContent)

    return applyPreviewTemplate(template, article.title, articleHtml, article.customCss)
  } catch (err) {
    if (isNotionObjectNotFound(err)) {
      return c.text("記事が見つかりませんでした", 404)
    }

    console.error({
      event: "preview_failed",
      pageId: query.data.pageId,
      error: err instanceof Error ? err.message : String(err),
    })

    return c.text("プレビューを生成できませんでした", 500)
  }
}
