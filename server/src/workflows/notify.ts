import type { WorkflowStep } from "cloudflare:workers"

import { createSiteLabel, createWorkflowErrorMessage } from "../services/notifications"
import { createSlackNotifier } from "../services/slack"

export const notifySlack = async (env: CloudflareBindings, text: string) => {
  if (!env.SLACK_WEBHOOK_URL) {
    console.warn(JSON.stringify({ event: "slack_webhook_url_missing" }))

    return
  }
  await createSlackNotifier(env.SLACK_WEBHOOK_URL)(text)
}

// Workflow が例外で止まったときに Slack へ知らせる。通知の失敗で元の例外を隠さない
export const notifyWorkflowError = async (
  step: WorkflowStep,
  env: CloudflareBindings,
  label: string,
  workflowId: string,
  err: unknown,
) => {
  try {
    await step.do(
      "notify-error",
      { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "1 minute" },
      async () => {
        await notifySlack(
          env,
          createWorkflowErrorMessage({
            siteLabel: createSiteLabel(env.APP_ENV),
            label,
            workflowId,
            message: err instanceof Error ? err.message : String(err),
          }),
        )
      },
    )
  } catch (notifyErr) {
    console.warn(
      JSON.stringify({
        event: "workflow_error_notification_failed",
        workflowId,
        error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      }),
    )
  }
}
