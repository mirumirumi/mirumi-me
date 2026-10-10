import { SYNC_JOB_STALE_MS } from "./job-limits"
import type { SerialJobQueue } from "./job-queue"

export interface SyncJobsOptions {
  now?: () => Date
}

// 公開とコメント反映は、結果を HTTP で返すまで待つ同期ジョブ。固まったときに Container を止められるよう、
// キューを抜けて走り始めた時刻を持つ（キューで待っている時間は数えない）
export class SyncJobs {
  readonly #queue: SerialJobQueue
  readonly #startedAt = new Map<string, number>()
  readonly #now: () => Date

  constructor(queue: SerialJobQueue, options?: SyncJobsOptions) {
    this.#queue = queue
    this.#now = options?.now ?? (() => new Date())
  }

  run<T>(key: string, execute: () => Promise<T>): Promise<T> {
    return this.#queue.run(key, async () => {
      this.#startedAt.set(key, this.#now().getTime())
      try {
        return await execute()
      } finally {
        this.#startedAt.delete(key)
      }
    })
  }

  // Container の停止を見送るかの判断に使う。ハングしたジョブを守り続けないための線引き
  hasStaleRunning(): boolean {
    const staleBefore = this.#now().getTime() - SYNC_JOB_STALE_MS

    return [...this.#startedAt.values()].some((startedAt) => startedAt <= staleBefore)
  }
}
