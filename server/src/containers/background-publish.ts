import type { PublishJobSummary } from "../lib/publishing"
import { BACKGROUND_JOB_STALE_MS } from "./job-limits"
import type { SerialJobQueue } from "./job-queue"

// DO 側は長さを検証してから受け取るため、ここで切っておかないと本当の失敗理由ごと parse が落ちる
const MAX_FAILURE_MESSAGE_CHARS = 2_000

const toFailureMessage = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err)

  return message.slice(0, MAX_FAILURE_MESSAGE_CHARS) || "不明なエラー"
}

export type BackgroundPublishState =
  | { status: "running" }
  | { status: "done"; summary: PublishJobSummary }
  | { status: "failed"; message: string }

export interface BackgroundPublishJobsOptions {
  now?: () => Date
}

// generate は 1 時間を超えるため、HTTP を開いたまま待つと Workflow 側の invocation が
// hang 判定で打ち切られる。受け付けだけ返して、結果はここに溜めておき polling で渡す
export class BackgroundPublishJobs {
  readonly #queue: SerialJobQueue
  readonly #states = new Map<string, BackgroundPublishState>()
  // 開始時刻は Workflow へ渡す状態には載せたくないので別に持つ
  readonly #startedAt = new Map<string, number>()
  readonly #now: () => Date

  constructor(queue: SerialJobQueue, options: BackgroundPublishJobsOptions = {}) {
    this.#queue = queue
    this.#now = options.now ?? (() => new Date())
  }

  start(workflowId: string, execute: () => Promise<PublishJobSummary>) {
    // 受け付け済みの workflowId なら、step の retry が届いても二重に走らせない
    if (this.#states.has(workflowId)) {
      return
    }
    this.#states.set(workflowId, { status: "running" })
    this.#startedAt.set(workflowId, this.#now().getTime())
    const settle = (state: BackgroundPublishState) => {
      this.#states.set(workflowId, state)
      this.#startedAt.delete(workflowId)
    }
    void this.#queue.run(`publish:${workflowId}`, execute).then(
      (summary) => {
        settle({ status: "done", summary })
      },
      (err: unknown) => {
        settle({ status: "failed", message: toFailureMessage(err) })
      },
    )
  }

  read(workflowId: string): BackgroundPublishState | null {
    return this.#states.get(workflowId) ?? null
  }

  // 完了した workflowId も retry 対策で残り続けるため、running だけを取り出す。
  // 古すぎるものはハングとみなして除外し、partial publish を通す
  runningWorkflowIds(): Array<string> {
    const staleBefore = this.#now().getTime() - BACKGROUND_JOB_STALE_MS

    return [...this.#startedAt.entries()]
      .filter(([, startedAt]) => staleBefore < startedAt)
      .map(([workflowId]) => workflowId)
  }

  // Container の停止と作り直しを見送るかの判断に使う。ハングしたジョブを守り続けないための線引き
  hasStaleRunning(): boolean {
    const staleBefore = this.#now().getTime() - BACKGROUND_JOB_STALE_MS

    return [...this.#startedAt.values()].some((startedAt) => startedAt <= staleBefore)
  }
}
