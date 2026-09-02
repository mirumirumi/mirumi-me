import { Hono } from "hono"

import { getAmazonItems, handleAmazonItemsOptions } from "./handlers/amazon-items"
import { postDevXPost } from "./handlers/dev-x-post"
import { postNotionWebhook } from "./handlers/notion-webhook"
import { getNotionWebhookVerification } from "./handlers/notion-webhook-verification"
import { getPreview } from "./handlers/preview"
import { postAdminPublish } from "./handlers/publish"
import { getWorkflowStatus } from "./handlers/workflow-status"
import type { HonoEnv } from "./lib/types"
import { createAccessMiddleware } from "./middleware/access"

const localDevAccess = createAccessMiddleware("ACCESS_LOCAL_DEV_AUD")

// route 表そのものをテストから叩けるよう、cloudflare:workers に依存する main.ts とは分けている
export const app = new Hono<HonoEnv>()
  .use("/preview", createAccessMiddleware("ACCESS_PREVIEW_AUD"))
  .use("/admin/*", createAccessMiddleware("ACCESS_ADMIN_AUD"))
  .use("/_dev/*", async (c, next) => {
    if (c.env.APP_ENV !== "dev") {
      return c.notFound()
    }
    return localDevAccess(c, next)
  })
  .options("/api/amazon/items", (c) => handleAmazonItemsOptions(c))
  .get("/api/amazon/items", (c) => getAmazonItems(c))
  .post("/_dev/x-post", (c) => postDevXPost(c))
  .post("/webhooks/notion", (c) => postNotionWebhook(c))
  .post("/admin/publish", (c) => postAdminPublish(c))
  .get("/admin/notion-webhook-verification", (c) => getNotionWebhookVerification(c))
  .get("/admin/workflows/:instanceId", (c) => getWorkflowStatus(c))
  .get("/preview", (c) => getPreview(c))

app.onError((err, c) => {
  console.error(
    JSON.stringify({
      event: "request_failed",
      method: c.req.method,
      path: c.req.path,
      error: err.name,
    }),
  )
  return c.json({ error: "Internal server error" }, 500)
})
