import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers"
import { NonRetryableError } from "cloudflare:workflows"
import { z } from "zod"

import { createNotionClient } from "shared/notion"

import type { BackupWorkflowParams, BackupWorkflowResult } from "../lib/backup"
import type { Fetcher } from "../lib/types"
import {
  type ArchiveStore,
  type BackupDependencies,
  type BackupStore,
  runBackupWorkflow,
} from "../services/backup"
import type { WorkflowStepExecutor } from "../services/publish-workflow"
import { SignedS3ObjectStore } from "../services/s3-object-store"

const backupWorkflowParamsSchema = z
  .object({
    source: z.enum(["cron", "admin"]),
    requestedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  })
  .strict()

const createR2BackupStore = (bucket: R2Bucket): BackupStore => {
  return {
    get: async (key) => {
      const object = await bucket.get(key)

      return object ? new Uint8Array(await object.arrayBuffer()) : null
    },
    put: async (key, body, { contentType, sha256 }) => {
      await bucket.put(key, body, { httpMetadata: { contentType }, sha256 })
    },
  }
}

const createDependencies = (env: CloudflareBindings): BackupDependencies => {
  const {
    NOTION_TOKEN: notionToken,
    NOTION_POSTS_DATA_SOURCE_ID: posts,
    NOTION_PAGES_DATA_SOURCE_ID: pages,
    NOTION_COMMENTS_DATA_SOURCE_ID: comments,
    AWS_REGION: region,
    AWS_ACCESS_KEY_ID: accessKeyId,
    AWS_SECRET_ACCESS_KEY: secretAccessKey,
    SITE_BUCKET_NAME: siteBucket,
    BACKUP_BUCKET_NAME: backupBucket,
    BACKUP: backup,
  } = env
  if (
    !notionToken ||
    !posts ||
    !pages ||
    !comments ||
    !region ||
    !accessKeyId ||
    !secretAccessKey ||
    !siteBucket ||
    !backupBucket ||
    !backup
  ) {
    throw new NonRetryableError("バックアップの設定が不足しています")
  }
  const fetcher: Fetcher = (input, init) => fetch(input, init)
  const credentials = { accessKeyId, secretAccessKey }
  const site = new SignedS3ObjectStore({ fetcher, region, bucket: siteBucket, credentials })
  const archive: ArchiveStore = new SignedS3ObjectStore({
    fetcher,
    region,
    bucket: backupBucket,
    credentials,
  })

  return {
    notion: createNotionClient(notionToken),
    dataSourceIds: { posts, pages, comments },
    readSiteObject: (key) => site.get(key),
    backup: createR2BackupStore(backup),
    archive,
    now: () => new Date(),
  }
}

const createStepExecutor = (step: WorkflowStep): WorkflowStepExecutor => {
  return {
    do: (name, config, callback) => step.do(name, config, callback),
  }
}

export class BackupWorkflow extends WorkflowEntrypoint<CloudflareBindings, BackupWorkflowParams> {
  override async run(
    event: Readonly<WorkflowEvent<BackupWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<BackupWorkflowResult> {
    const parsed = backupWorkflowParamsSchema.safeParse(event.payload)
    if (!parsed.success) {
      throw new NonRetryableError("Workflow の入力が不正です")
    }

    const result = await runBackupWorkflow({
      workflowId: event.instanceId,
      params: parsed.data,
      step: createStepExecutor(step),
      dependencies: createDependencies(this.env),
    })
    console.info(
      JSON.stringify({
        event: "notion_backup_finished",
        workflowId: result.workflowId,
        prefix: result.prefix,
        files: result.files.map(({ file, bytes, count, skipped }) => ({
          file,
          bytes,
          count,
          skipped,
        })),
      }),
    )

    return result
  }
}
