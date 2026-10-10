import { createNotionClient, fetchStuckPublishRevisions } from "shared/notion"
import {
  createCommentNotifiedUpdate,
  createUnnotifiedPublicFormCommentsFilter,
  fetchCommentRecords,
  resolveCommentDataSourceSchema,
} from "shared/notion-comments"

import { startScheduledBackup } from "./services/backup"
import { runCommentDigest } from "./services/comment-digest"
import {
  createSiteLabel,
  runStuckPublishAlert,
  runStuckPublishCheck,
  type StuckPublishCheckDependencies,
} from "./services/notifications"
import { createSesEmailSender } from "./services/ses"
import { createSlackNotifier } from "./services/slack"

// wrangler.jsonc の triggers.crons と対応させる（UTC で書く）
// 09:00 JST。コメント digest と、止まった公開の確認
export const COMMENT_DIGEST_CRON = "0 0 * * *"
// 04:00 JST。Notion の定期バックアップ（頻度は仮決定）
export const NOTION_BACKUP_CRON = "0 19 * * *"
// 30 分ごと。止まってから 30 分たった公開を知らせる（services/notifications.ts の STUCK_PUBLISH_ALERT_* と同じ間隔）
export const STUCK_PUBLISH_ALERT_CRON = "*/30 * * * *"

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
      siteName: createSiteLabel(env.APP_ENV),
    },
  )
  console.info(JSON.stringify({ event: "comment_digest_finished", ...result }))
}

const createStuckPublishDependencies = (
  env: CloudflareBindings,
  now: Date,
): StuckPublishCheckDependencies | null => {
  const {
    NOTION_TOKEN: notionToken,
    NOTION_POSTS_DATA_SOURCE_ID: posts,
    NOTION_PAGES_DATA_SOURCE_ID: pages,
    SLACK_WEBHOOK_URL: webhookUrl,
  } = env
  if (!notionToken || !posts || !pages || !webhookUrl) {
    console.error(JSON.stringify({ event: "stuck_publish_check_configuration_missing" }))

    return null
  }
  const notion = createNotionClient(notionToken)

  return {
    loadStuckPages: async (window) => {
      const revisions = await fetchStuckPublishRevisions(notion, { posts, pages }, window)

      return revisions.map(({ pageId, title, slug, internalState, lastEditedTime }) => ({
        pageId,
        title,
        slug,
        internalState,
        lastEditedTime,
      }))
    },
    notify: createSlackNotifier(webhookUrl),
    now: () => now,
  }
}

// 公開ボタンを押したのに 2 時間以上 公開待ち / 非公開待ち のままの記事を、毎朝まとめて Slack に知らせる。
// Webhook の取りこぼしや、Notion への書き戻しの失敗で止まると、ほかに気づく手段がない
export const runScheduledStuckPublishCheck = async (env: CloudflareBindings): Promise<void> => {
  const dependencies = createStuckPublishDependencies(env, new Date())
  if (!dependencies) {
    return
  }
  const result = await runStuckPublishCheck(dependencies, createSiteLabel(env.APP_ENV))
  console.info(JSON.stringify({ event: "stuck_publish_check_finished", ...result }))
}

// 止まってから 30 分たった公開を、その場で 1 回だけ知らせる。範囲は Cron の予定時刻から決めるので、
// 起動が少し遅れても前後の確認と重ならない
export const runScheduledStuckPublishAlert = async (
  event: ScheduledController,
  env: CloudflareBindings,
): Promise<void> => {
  const dependencies = createStuckPublishDependencies(env, new Date(event.scheduledTime))
  if (!dependencies) {
    return
  }
  const result = await runStuckPublishAlert(dependencies, createSiteLabel(env.APP_ENV))
  console.info(JSON.stringify({ event: "stuck_publish_alert_finished", ...result }))
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
    // どちらかが落ちても、もう片方は流す
    const results = await Promise.allSettled([
      runScheduledCommentDigest(env),
      runScheduledStuckPublishCheck(env),
    ])
    const failed = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    )
    if (0 < failed.length) {
      throw failed[0]
    }

    return
  }
  if (event.cron === NOTION_BACKUP_CRON) {
    await runScheduledNotionBackup(event, env)

    return
  }
  if (event.cron === STUCK_PUBLISH_ALERT_CRON) {
    await runScheduledStuckPublishAlert(event, env)

    return
  }
  console.warn(JSON.stringify({ event: "scheduled_cron_unhandled", cron: event.cron }))
}
