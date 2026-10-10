import type { SiteObjectStore } from "./aws"

// 470 page の loop で毎回書くと S3 の put が処理時間を支配するため、一定間隔に間引く
const MIN_WRITE_INTERVAL_MS = 5_000

export type JobPhase = "prepare" | "load-articles" | "build-pages" | "generate" | "deploy" | "done"

export interface JobProgress {
  workflowId: string
  phase: JobPhase
  completed: number
  total: number
  startedAt: string
  updatedAt: string
  detail: string | null
}

export interface JobProgressReporterOptions {
  now?: () => Date
}

export const jobProgressKey = (workflowId: string): string => {
  return `_internal/jobs/${encodeURIComponent(workflowId)}.json`
}

// Container の標準出力はどこからも読めないため、進捗だけ S3 へ逃がして外から追えるようにする。
// Workflow が先に諦めても残るので、後追いの調査に使える
export class JobProgressReporter {
  readonly #store: SiteObjectStore
  readonly #workflowId: string
  readonly #startedAt: string
  readonly #now: () => Date
  #lastWrittenAt: number | null = null

  constructor(
    store: SiteObjectStore,
    workflowId: string,
    options: JobProgressReporterOptions = {},
  ) {
    this.#store = store
    this.#workflowId = workflowId
    this.#now = options.now ?? (() => new Date())
    this.#startedAt = this.#now().toISOString()
  }

  async report(
    phase: JobPhase,
    completed: number,
    total: number,
    detail: string | null = null,
  ): Promise<void> {
    const now = this.#now()
    const isFinal = phase === "done"
    if (
      !isFinal &&
      this.#lastWrittenAt !== null &&
      now.getTime() - this.#lastWrittenAt < MIN_WRITE_INTERVAL_MS
    ) {
      return
    }
    this.#lastWrittenAt = now.getTime()
    const progress: JobProgress = {
      workflowId: this.#workflowId,
      phase,
      completed,
      total,
      startedAt: this.#startedAt,
      updatedAt: now.toISOString(),
      detail,
    }
    // 進捗の書き込み失敗で publish 自体を落とさない
    try {
      await this.#store.put(jobProgressKey(this.#workflowId), {
        body: new TextEncoder().encode(JSON.stringify(progress)),
        contentType: "application/json; charset=utf-8",
        cacheControl: "no-store",
      })
    } catch (err) {
      console.warn(
        JSON.stringify({
          event: "job_progress_write_failed",
          workflowId: this.#workflowId,
          error: err instanceof Error ? err.name : "UnknownError",
        }),
      )
    }
  }
}
