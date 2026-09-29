import { join } from "node:path"
import { $ } from "bun"
import { z } from "zod"

export const ENVS = ["dev", "prd"] as const

export type Env = (typeof ENVS)[number]

export interface PublishWorkflowParams {
  mode: "full" | "bootstrap"
  source: "release"
  requestId: string
  requestedAt: string
  pageIds: Array<string>
}

// step.sleep 中の instance がどの status で報告されるかは環境に依存するため、
// 走っていると解釈しうる status を全部見る（見逃すより待たせる方が安全）
const BUSY_STATUSES = ["running", "queued", "waiting", "waitingForPause", "paused"] as const
// リポジトリのどこから実行しても動くように、wrangler の設定は自分の位置から解決する
export const WRANGLER_CONFIG = join(import.meta.dir, "../../wrangler.jsonc")

const containerApplicationsSchema = z.array(z.object({ name: z.string(), state: z.string() }))

export const parseEnv = (value: string | undefined): Env | null => {
  return ENVS.find((candidate) => candidate === value) ?? null
}

export const publishWorkflowName = (env: Env): string => {
  return `mirumi-me-publish-${env}`
}

// 走っている build に重ねると、後から来たぶんはキューで待つだけになり、
// そのあいだ partial publish は 409 で断られる
export const findBusyStatus = async (env: Env): Promise<string | null> => {
  const workflow = publishWorkflowName(env)
  for (const status of BUSY_STATUSES) {
    const listed =
      await $`bunx wrangler workflows instances list ${workflow} --status ${status} --per-page 5 --env ${env} --config ${WRANGLER_CONFIG}`
        .quiet()
        .text()
    // instance が 1 件も無いときは "Showing ..." の行が出ない
    if (listed.includes("Showing")) {
      return status
    }
  }

  return null
}

export const triggerPublishWorkflow = async (
  env: Env,
  instanceId: string,
  params: PublishWorkflowParams,
) => {
  await $`bunx wrangler workflows trigger ${publishWorkflowName(env)} ${JSON.stringify(params)} --env ${env} --id ${instanceId} --config ${WRANGLER_CONFIG}`
}

// wrangler の state は instance の健康状態から導かれる（rollout 中は provisioning、
// ready は instance がゼロ、active は動いている instance がある）
export const readContainerState = async (env: Env): Promise<string | null> => {
  const listed =
    await $`bunx wrangler containers list --env ${env} --json --config ${WRANGLER_CONFIG}`
      .quiet()
      .json()
  const name = `mirumi-me-build-${env}`

  return (
    containerApplicationsSchema.parse(listed).find((application) => application.name === name)
      ?.state ?? null
  )
}
