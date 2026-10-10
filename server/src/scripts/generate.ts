import {
  type Env,
  findBusyStatus,
  type PublishWorkflowParams,
  parseEnv,
  publishWorkflowName,
  triggerPublishWorkflow,
  WRANGLER_CONFIG,
} from "./wrangler"

// 本番の generate は deploy.yml が deploy のあとに、必要なときだけ投げる。このスクリプトは、
// コードを変えずにサイト全体を作り直したいときに手元から流すためのもの
const MODES = ["full", "bootstrap"] as const

type Mode = (typeof MODES)[number]

interface Options {
  env: Env
  mode: Mode
  dryRun: boolean
}

const usage = "usage: bun server/src/scripts/generate.ts <dev|prd> [--mode bootstrap] [--dry-run]"

const parseOptions = (argv: Array<string>): Options => {
  const env = parseEnv(argv[0])
  if (!env) {
    throw Error(usage)
  }
  const modeIndex = argv.indexOf("--mode")
  const mode = modeIndex < 0 ? "full" : MODES.find((candidate) => candidate === argv[modeIndex + 1])
  if (!mode) {
    throw Error(usage)
  }

  return { env, mode, dryRun: argv.includes("--dry-run") }
}

const confirmProduction = (): boolean => {
  const answer = prompt(
    "prd に generate を投げます。原則は CI 経由です。続けるなら yes と入力してください:",
  )

  return answer === "yes"
}

const main = async () => {
  const { env, mode, dryRun } = parseOptions(Bun.argv.slice(2))
  const workflow = publishWorkflowName(env)
  if (env === "prd" && !dryRun && !confirmProduction()) {
    throw Error("中止しました")
  }
  const running = await findBusyStatus(env)
  if (running) {
    throw Error(
      `${workflow} に ${running} の instance があります。終わるのを待ってから投げてください`,
    )
  }
  const instanceId = `manual-${mode}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`
  // full と bootstrap は source が release でないと Workflow の入力検証で弾かれる
  const params: PublishWorkflowParams = {
    mode,
    source: "release",
    requestId: instanceId,
    requestedAt: new Date().toISOString(),
    pageIds: [],
  }
  if (dryRun) {
    console.log(`[dry-run] ${workflow} --id ${instanceId}`)
    console.log(`[dry-run] ${JSON.stringify(params)}`)

    return
  }
  await triggerPublishWorkflow(env, instanceId, params)
  console.log(
    `\n進行状況:\n  bunx wrangler workflows instances describe ${workflow} ${instanceId} --env ${env} --config ${WRANGLER_CONFIG}`,
  )
}

await main()
