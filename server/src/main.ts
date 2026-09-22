import { app } from "./app"
import { handleScheduled } from "./scheduled"

export { ContainerProxy } from "@cloudflare/containers"

export { BuildContainer } from "./containers/container"
export { CommentRefreshWorkflow } from "./workflows/comment-refresh-workflow"
export { PublishWorkflow } from "./workflows/workflow"

export type AppType = typeof app

// Cron（コメント digest）も同じ Worker で受けるため、Hono の app をそのまま default export にはしない
export default {
  fetch: app.fetch,
  scheduled: (event, env, context) => {
    context.waitUntil(handleScheduled(event, env))
  },
} satisfies ExportedHandler<CloudflareBindings>
