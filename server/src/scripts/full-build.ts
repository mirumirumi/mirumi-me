import { join } from "node:path"
import { $ } from "bun"

// 本番の full build は deploy.yml が deploy のあとに投げる。このスクリプトは、
// コードを変えずにサイト全体を作り直したいときに手元から流すためのもの
const ENVS = ["dev", "prd"] as const
const MODES = ["full", "bootstrap"] as const
// step.sleep 中の instance がどの status で報告されるかは環境に依存するため、
// 走っていると解釈しうる status を全部見る
const BUSY_STATUSES = ["running", "queued", "waiting", "paused"] as const
// リポジトリのどこから実行しても動くように、wrangler の設定は自分の位置から解決する
const WRANGLER_CONFIG = join(import.meta.dir, "../../wrangler.jsonc")

type Env = (typeof ENVS)[number]
type Mode = (typeof MODES)[number]

interface Options {
  env: Env
  mode: Mode
  dryRun: boolean
}

const usage = "usage: bun server/src/scripts/full-build.ts <dev|prd> [--mode bootstrap] [--dry-run]"

const parseOptions = (argv: Array<string>): Options => {
  const env = ENVS.find((candidate) => candidate === argv[0])
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

// 走っている build に重ねると、後から来たぶんはキューで待つだけになり、
// そのあいだ partial publish は 409 で断られる
const findRunningInstance = async (workflow: string, env: Env): Promise<string | null> => {
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

const confirmProduction = (): boolean => {
  const answer = prompt(
    "prd に full build を投げます。原則は CI 経由です。続けるなら yes と入力してください:",
  )

  return answer === "yes"
}

const main = async () => {
  const { env, mode, dryRun } = parseOptions(Bun.argv.slice(2))
  const workflow = `mirumi-me-publish-${env}`
  if (env === "prd" && !dryRun && !confirmProduction()) {
    throw Error("中止しました")
  }
  const running = await findRunningInstance(workflow, env)
  if (running) {
    throw Error(
      `${workflow} に ${running} の instance があります。終わるのを待ってから投げてください`,
    )
  }
  const instanceId = `manual-${mode}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`
  // full と bootstrap は source が release でないと Workflow の入力検証で弾かれる
  const params = {
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
  await $`bunx wrangler workflows trigger ${workflow} ${JSON.stringify(params)} --env ${env} --id ${instanceId} --config ${WRANGLER_CONFIG}`
  console.log(
    `\n進行状況:\n  bunx wrangler workflows instances describe ${workflow} ${instanceId} --env ${env} --config ${WRANGLER_CONFIG}`,
  )
}

await main()
