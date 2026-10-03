import { appendFileSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

import { CloudflareWorkflowsApi, type InstanceState } from "./cloudflare-api"
import {
  collectGeneratePathFiles,
  createReleaseInstanceId,
  decideGenerate,
  findBaselineSha,
  GENERATE_REQUESTS,
  type GenerateDecision,
  type GenerateRequest,
} from "./release-plan"
import {
  type Env,
  findBusyStatus,
  parseEnv,
  publishWorkflowName,
  readContainerState,
  triggerPublishWorkflow,
} from "./wrangler"

// deploy.yml の各 job から呼ぶ。手元から generate を流すときは generate.ts を使う
const REPOSITORY_ROOT = join(import.meta.dir, "../../..")
// generate の経路の入口。Container のプロセス、Container に環境変数を渡す DO、publish の Workflow
const GENERATE_ENTRYPOINTS = [
  "server/src/containers/http.ts",
  "server/src/containers/container.ts",
  "server/src/workflows/workflow.ts",
]
const MAX_SUMMARY_TRIGGERS = 30
// rollout に入ったかを外から判定する手段が wrangler に無いので、まず固定で待つ
// （2026-09-24 に dev で踏んだときは deploy から約 3 分で収束していた）
const ROLLOUT_INITIAL_WAIT_MS = 300_000
const ROLLOUT_POLL_INTERVAL_MS = 30_000
const ROLLOUT_POLL_LIMIT = 20
const ROLLOUT_SETTLED_COUNT = 2
const GENERATE_POLL_INTERVAL_MS = 60_000
// 470 記事で 1 時間、KV のキャッシュが冷えていると 1 時間 30 分かかる。deploy.yml の
// timeout-minutes より先にここで打ち切り、理由を残す
const GENERATE_POLL_LIMIT = 180
// API の一時的な失敗で、走っている generate を見失ったことにしない
const GENERATE_POLL_MAX_FAILURES = 5

const usage =
  "usage: bun server/src/scripts/release.ts <plan|check-idle|wait-rollout|generate> <dev|prd> [--request auto|always|skip]"

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw Error(`環境変数 ${name} が必要です`)
  }

  return value
}

const readSource = (path: string): string | null => {
  try {
    return readFileSync(join(REPOSITORY_ROOT, path), "utf8")
  } catch {
    return null
  }
}

const listChangedFiles = async (
  baselineSha: string,
  head: string,
): Promise<Array<string> | null> => {
  // dev は force push で履歴が書き換わるため、基準点のコミットが残っていないことがある
  const commit = `${baselineSha}^{commit}`
  const exists = await $`git cat-file -e ${commit}`.cwd(REPOSITORY_ROOT).quiet().nothrow()
  if (exists.exitCode !== 0) {
    return null
  }
  // 祖先関係ではなく木どうしを比べるので、履歴が分かれていても生成物の差分として使える。
  // -z にしないと日本語のパスが引用符付きでエスケープされ、判定の前方一致に掛からない
  const diff = await $`git diff --name-only -z ${baselineSha} ${head}`
    .cwd(REPOSITORY_ROOT)
    .quiet()
    .text()

  return diff.split("\0").filter((path) => 0 < path.length)
}

const renderSummary = (env: Env, decision: GenerateDecision): string => {
  const lines = [
    `## generate の判定（${env}）`,
    "",
    `- 判定：${decision.generate ? "generate する" : "generate しない"}`,
    `- 理由：${decision.reason}`,
  ]
  if (0 < decision.triggers.length) {
    lines.push("- 生成物に効く変更：")
    for (const path of decision.triggers.slice(0, MAX_SUMMARY_TRIGGERS)) {
      lines.push(`    - \`${path}\``)
    }
    if (MAX_SUMMARY_TRIGGERS < decision.triggers.length) {
      lines.push(`    - ほか ${decision.triggers.length - MAX_SUMMARY_TRIGGERS} 件`)
    }
  }

  return `${lines.join("\n")}\n`
}

const plan = async (env: Env, request: GenerateRequest) => {
  const head = requireEnv("GITHUB_SHA")
  let baselineSha: string | null = null
  let changedFiles: Array<string> | null = null
  if (request === "auto") {
    const instances = await CloudflareWorkflowsApi.fromEnv().listCompletedInstances(
      publishWorkflowName(env),
    )
    baselineSha = findBaselineSha(instances)
    if (baselineSha) {
      changedFiles = await listChangedFiles(baselineSha, head)
    }
  }
  const decision = decideGenerate({
    request,
    baselineSha,
    changedFiles,
    generatePathFiles: collectGeneratePathFiles(GENERATE_ENTRYPOINTS, readSource),
  })
  const summary = renderSummary(env, decision)
  console.log(summary)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `generate=${decision.generate}\n`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  }
}

const checkIdle = async (env: Env) => {
  const status = await findBusyStatus(env)
  if (status) {
    throw Error(`publish workflow が ${status} です。終わるのを待ってから deploy してください`)
  }
}

const waitForRollout = async (env: Env) => {
  await Bun.sleep(ROLLOUT_INITIAL_WAIT_MS)
  // rollout の前後で ready と provisioning を行き来するため、1 回の観測では収束を判定できない。
  // 落ち着いたことを続けて確認する
  let settled = 0
  for (let attempt = 0; attempt < ROLLOUT_POLL_LIMIT; attempt++) {
    const state = await readContainerState(env)
    console.log(`container application state: ${state}`)
    if (state === "ready" || state === "active") {
      settled++
      if (ROLLOUT_SETTLED_COUNT <= settled) {
        return
      }
    } else if (state === "degraded") {
      throw Error("Container application に failed instance があります")
    } else {
      settled = 0
    }
    await Bun.sleep(ROLLOUT_POLL_INTERVAL_MS)
  }
  throw Error("Container application の rollout が収束しませんでした")
}

// generate は Notion へ何も書き戻さないので、ここで完了まで待たないと失敗に誰も気づけない
const generate = async (env: Env) => {
  const workflow = publishWorkflowName(env)
  const instanceId = createReleaseInstanceId(
    requireEnv("GITHUB_SHA"),
    requireEnv("GITHUB_RUN_ID"),
    requireEnv("GITHUB_RUN_ATTEMPT"),
  )
  await triggerPublishWorkflow(env, instanceId, {
    mode: "full",
    source: "release",
    requestId: instanceId,
    requestedAt: new Date().toISOString(),
    pageIds: [],
  })
  const api = CloudflareWorkflowsApi.fromEnv()
  let failures = 0
  for (let minute = 1; minute <= GENERATE_POLL_LIMIT; minute++) {
    await Bun.sleep(GENERATE_POLL_INTERVAL_MS)
    let state: InstanceState
    try {
      state = await api.readInstance(workflow, instanceId)
    } catch (err) {
      // 詳細の API だけが失敗し続けることがある（2026-10-03 に、完了した instance で internal_server が続いた）。
      // 一覧で終わっていると確かめられれば、それを状態として扱う
      const listed = await api.findTerminalStatus(workflow, instanceId).catch(() => null)
      if (!listed) {
        failures++
        console.log(`${minute} 分経過: 状態を取れませんでした（${failures} 回目）: ${err}`)
        if (GENERATE_POLL_MAX_FAILURES <= failures) {
          throw err
        }
        continue
      }
      console.log(`${minute} 分経過: 詳細を取れないため一覧で確かめました: ${err}`)
      state = { status: listed, error: "詳細の API が失敗したため、理由は一覧から取れません" }
    }
    failures = 0
    console.log(`${minute} 分経過: ${state.status}`)
    if (state.status === "complete") {
      return
    }
    if (state.status === "errored" || state.status === "terminated") {
      throw Error(
        `generate が ${state.status} で終わりました: ${state.error ?? "理由は残っていません"}`,
      )
    }
  }
  throw Error(
    `generate が ${GENERATE_POLL_LIMIT} 分で終わりませんでした。Cloudflare 側では走り続けています: ${instanceId}`,
  )
}

const parseRequest = (argv: Array<string>): GenerateRequest | null => {
  const index = argv.indexOf("--request")
  if (index < 0) {
    return "auto"
  }

  return GENERATE_REQUESTS.find((candidate) => candidate === argv[index + 1]) ?? null
}

const main = async () => {
  const [command, envArg, ...rest] = Bun.argv.slice(2)
  const env = parseEnv(envArg)
  if (!env) {
    throw Error(usage)
  }
  if (command === "plan") {
    const request = parseRequest(rest)
    if (!request) {
      throw Error(usage)
    }
    await plan(env, request)
  } else if (command === "check-idle") {
    await checkIdle(env)
  } else if (command === "wait-rollout") {
    await waitForRollout(env)
  } else if (command === "generate") {
    await generate(env)
  } else {
    throw Error(usage)
  }
}

await main()
