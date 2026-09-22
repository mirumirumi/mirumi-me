import { createNotionClient } from "shared/notion"
import {
  createCommentNotifiedUpdate,
  createUnnotifiedPublicFormCommentsFilter,
  fetchCommentRecords,
  resolveCommentDataSourceSchema,
} from "shared/notion-comments"

import { startScheduledBackup } from "./services/backup"
import { runCommentDigest } from "./services/comment-digest"
import { createSesEmailSender } from "./services/ses"

// wrangler.jsonc の triggers.crons と対応させる（UTC で書く）
// 09:00 JST。コメント digest
export const COMMENT_DIGEST_CRON = "0 0 * * *"
// 04:00 JST。Notion の定期バックアップ（頻度は仮決定）
export const NOTION_BACKUP_CRON = "0 19 * * *"

export const runScheduledCommentDigest = async (env: CloudflareBindings): Promise<void> => {
  const {
    NOTION_TOKEN: notionToken,
    NOTION_COMMENTS_DATA_SOURCE_ID: dataSourceId,
    SES_REGION: sesRegion,
    SES_ACCESS_KEY_ID: sesAccessKeyId,
    SES_SECRET_ACCESS_KEY: sesSecretAccessKey,
    COMMENT_DIGEST_SENDER: sender,
    COMMENT_DIGEST_RECIPIENT: recipient,
  } = env
  if (
    !notionToken ||
    !dataSourceId ||
    !sesRegion ||
    !sesAccessKeyId ||
    !sesSecretAccessKey ||
    !sender ||
    !recipient
  ) {
    console.error(JSON.stringify({ event: "comment_digest_configuration_missing" }))

    return
  }
  const notion = createNotionClient(notionToken)
  const schema = await resolveCommentDataSourceSchema(notion, dataSourceId)
  const result = await runCommentDigest(
    {
      loadUnnotifiedComments: () =>
        fetchCommentRecords(notion, schema, createUnnotifiedPublicFormCommentsFilter()),
      sendEmail: createSesEmailSender({
        fetcher: (input, init) => fetch(input, init),
        region: sesRegion,
        credentials: { accessKeyId: sesAccessKeyId, secretAccessKey: sesSecretAccessKey },
      }),
      markNotified: async (pageId, notifiedAt) => {
        await notion.pages.update(createCommentNotifiedUpdate(pageId, notifiedAt))
      },
      now: () => new Date(),
    },
    {
      from: sender,
      to: recipient,
      siteName: env.APP_ENV === "prd" ? "mirumi.me" : `mirumi.me (${env.APP_ENV ?? "dev"})`,
    },
  )
  console.info(JSON.stringify({ event: "comment_digest_finished", ...result }))
}

// scheduled handler は wall time 15 分が上限で全記事の取得が収まらないため、Workflow を起動するだけにする
export const runScheduledNotionBackup = async (
  event: ScheduledController,
  env: CloudflareBindings,
): Promise<void> => {
  const workflow = env.BACKUP_WORKFLOW
  if (!workflow) {
    console.error(JSON.stringify({ event: "backup_workflow_binding_missing" }))

    return
  }
  const started = await startScheduledBackup(workflow, event.scheduledTime)
  console.info(JSON.stringify({ event: "notion_backup_workflow_started", ...started }))
}

export const handleScheduled = async (
  event: ScheduledController,
  env: CloudflareBindings,
): Promise<void> => {
  if (event.cron === COMMENT_DIGEST_CRON) {
    await runScheduledCommentDigest(env)

    return
  }
  if (event.cron === NOTION_BACKUP_CRON) {
    await runScheduledNotionBackup(event, env)

    return
  }
  console.warn(JSON.stringify({ event: "scheduled_cron_unhandled", cron: event.cron }))
}
