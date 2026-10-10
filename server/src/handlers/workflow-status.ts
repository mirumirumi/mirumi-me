import type { Context } from "hono"

import type { HonoEnv } from "../lib/types"

const WORKFLOW_INSTANCE_ID = /^[a-zA-Z0-9_-]{1,100}$/

export const getWorkflowStatus = async (c: Context<HonoEnv>): Promise<Response> => {
  const instanceId = c.req.param("instanceId")
  if (!instanceId || !WORKFLOW_INSTANCE_ID.test(instanceId)) {
    return c.json({ error: "Invalid Workflow instance ID" }, 400)
  }

  const workflow = c.env.PUBLISH_WORKFLOW
  if (!workflow) {
    console.error(JSON.stringify({ event: "publish_workflow_binding_missing" }))

    return c.json({ error: "Publish configuration is missing" }, 500)
  }

  try {
    const instance = await workflow.get(instanceId)
    const status = await instance.status()

    return c.json({ workflowId: instance.id, status: status.status })
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "workflow_status_not_found",
        workflowId: instanceId,
        error: err instanceof Error ? err.name : "UnknownError",
      }),
    )

    return c.json({ error: "Workflow instance not found" }, 404)
  }
}
