import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers"

interface PublishWorkflowParams {
  pageIds: Array<string>
}

export class PublishWorkflow extends WorkflowEntrypoint<CloudflareBindings, PublishWorkflowParams> {
  override async run(event: Readonly<WorkflowEvent<PublishWorkflowParams>>, step: WorkflowStep) {
    //
  }
}
