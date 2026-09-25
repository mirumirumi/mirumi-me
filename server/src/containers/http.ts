import { createHash } from "node:crypto"

import { CloudFrontInvalidator } from "./aws"
import { BackgroundPublishJobs } from "./background-publish"
import { runContainerCommentRefreshJob } from "./comment-refresh-job"
import type { ContainerConfig } from "./config"
import { readContainerConfig } from "./config"
import { loadDeploymentPageStates } from "./deployment-state"
import { SerialJobQueue } from "./job-queue"
import { runContainerPublishJob } from "./publish-job"
import { createRequestHandler } from "./request-handler"

// CloudFront の CallerReference は seed から作る。full / bootstrap ではジョブ末尾と Workflow の
// step の 2 回流すため、seed を変えて別の invalidation として扱わせる
const invalidateSite = async (
  config: ContainerConfig,
  referenceSeed: string,
  paths: Array<string>,
) => {
  await new CloudFrontInvalidator(
    {
      region: config.awsRegion,
      accessKeyId: config.awsAccessKeyId,
      secretAccessKey: config.awsSecretAccessKey,
    },
    config.cloudFrontDistributionId,
  ).invalidate(paths, createHash("sha256").update(referenceSeed).digest("hex"))
}

// 依存はここで 1 回だけ組む。queue と background job の状態はプロセス内で 1 つでなければならない
const jobs = new SerialJobQueue()
const handleRequest = createRequestHandler({
  jobs,
  backgroundPublishJobs: new BackgroundPublishJobs(jobs),
  readConfig: readContainerConfig,
  runPublishJob: runContainerPublishJob,
  runCommentRefreshJob: runContainerCommentRefreshJob,
  invalidateSite,
  loadDeploymentPageStates,
})

const server = Bun.serve({
  port: 8080,
  fetch: async (request) => {
    try {
      return await handleRequest(request)
    } catch (err) {
      const detail = err instanceof Error ? err.message.slice(0, 2_000) : null
      console.error(
        JSON.stringify({
          event: "container_request_failed",
          path: new URL(request.url).pathname,
          error: err instanceof Error ? err.name : "UnknownError",
          detail,
        }),
      )

      return Response.json({ error: "Internal server error", detail }, { status: 500 })
    }
  },
})

// sleepAfter の停止は SIGTERM を送るだけで、PID 1 のプロセスには既定のシグナル動作が入らず
// ハンドラがないと黙って無視される。明示的に受けて終了しないと Container が動き続ける。
// なお full build は HTTP を開いたまま待たないため、走っている最中でもアイドル扱いになりうる。
// 活性を保っているのは Workflow からの 1 分ごとの /publish-state だけ
const shutdown = () => {
  void server.stop()
  process.exit(0)
}
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
