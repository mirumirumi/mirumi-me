import { Hono } from "hono"

import { getPreview } from "./handlers/preview"
import { HonoEnv } from "./lib/types"

const app = new Hono<HonoEnv>()
  // .get("/", (c) => xxx(c))
  .get("/preview", (c) => getPreview(c))

export { BuildContainer } from "./containers/container"
export { PublishWorkflow } from "./workflows/workflow"
export type AppType = typeof app
export default app
