import type { Context } from "hono"
import { z } from "zod"

import { normalizeNotionPageId } from "shared/site-routes"

import { readLimitedText } from "../lib/request-body"
import type { HonoEnv } from "../lib/types"
import { startAdminPublish } from "../services/start-publish"

const MAX_ADMIN_BODY_BYTES = 64 * 1_024

const publishRequestSchema = z.strictObject({
  pageIds: z.array(z.string()).min(1).max(100),
})

export const postAdminPublish = async (c: Context<HonoEnv>): Promise<Response> => {
  const rawBody = await readLimitedText(c.req.raw, MAX_ADMIN_BODY_BYTES)
  if (rawBody === null) {
    return c.json({ error: "Request body is too large" }, 413)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return c.json({ error: "Invalid JSON" }, 400)
  }

  const request = publishRequestSchema.safeParse(parsed)
  if (!request.success) {
    return c.json({ error: "pageIds must contain 1 to 100 Notion page IDs" }, 400)
  }

  const pageIds = [...new Set(request.data.pageIds.map(normalizeNotionPageId))]
  if (pageIds.some((pageId) => pageId === null)) {
    return c.json({ error: "pageIds contains an invalid Notion page ID" }, 400)
  }

  const workflow = c.env.PUBLISH_WORKFLOW
  if (!workflow) {
    console.error(JSON.stringify({ event: "publish_workflow_binding_missing" }))

    return c.json({ error: "Publish configuration is missing" }, 500)
  }

  const normalizedPageIds = pageIds.filter((pageId): pageId is string => pageId !== null)
  const requestId = crypto.randomUUID()
  const started = await startAdminPublish(workflow, {
    workflowId: `admin-${requestId}`,
    requestId,
    requestedAt: new Date().toISOString(),
    pageIds: normalizedPageIds,
  })

  return c.json({ workflowId: started.workflowId }, 202)
}
