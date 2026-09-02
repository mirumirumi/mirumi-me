import type { PublishWorkflowParams } from "../lib/publishing"

interface PublishWorkflowInstance {
  id: string
}

interface PublishWorkflowCreateOptions {
  id: string
  params: PublishWorkflowParams
}

export interface PublishWorkflowBinding {
  create(options: PublishWorkflowCreateOptions): Promise<PublishWorkflowInstance>
  createBatch(options: Array<PublishWorkflowCreateOptions>): Promise<Array<PublishWorkflowInstance>>
}

interface WebhookPublishRequest {
  eventId: string
  pageId: string
  requestedAt: string
}

interface AdminPublishRequest {
  workflowId: string
  requestId: string
  requestedAt: string
  pageIds: Array<string>
}

export interface StartedPublishWorkflow {
  workflowId: string
  created: boolean
}

export const startWebhookPublish = async (
  workflow: PublishWorkflowBinding,
  request: WebhookPublishRequest,
): Promise<StartedPublishWorkflow> => {
  const instances = await workflow.createBatch([
    {
      id: request.eventId,
      params: {
        mode: "partial",
        source: "notion-webhook",
        requestId: request.eventId,
        requestedAt: request.requestedAt,
        pageIds: [request.pageId],
      },
    },
  ])

  return { workflowId: request.eventId, created: 0 < instances.length }
}

export const startAdminPublish = async (
  workflow: PublishWorkflowBinding,
  request: AdminPublishRequest,
): Promise<StartedPublishWorkflow> => {
  const instance = await workflow.create({
    id: request.workflowId,
    params: {
      mode: "partial",
      source: "admin",
      requestId: request.requestId,
      requestedAt: request.requestedAt,
      pageIds: request.pageIds,
    },
  })

  return { workflowId: instance.id, created: true }
}
