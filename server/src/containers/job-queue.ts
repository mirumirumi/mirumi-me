// publish index の書き手を 1 本に保つため、Container のジョブは常に直列で流す。
// あわせて、step が timeout したあとの retry が同じジョブを積み増さないよう key で相乗りさせる
export class SerialJobQueue {
  #tail: Promise<void> = Promise.resolve()
  readonly #running = new Map<string, Promise<unknown>>()

  run<T>(key: string, execute: () => Promise<T>): Promise<T> {
    const running = this.#running.get(key) as Promise<T> | undefined
    if (running) {
      return running
    }
    const job = this.#tail.then(execute)
    this.#tail = job.then(
      () => undefined,
      () => undefined,
    )
    this.#running.set(key, job)
    const forget = () => {
      this.#running.delete(key)
    }
    job.then(forget, forget)

    return job
  }

  // Container を作り直したり停止させたりして良いかの判断に使う。
  // #running はキュー待ちのジョブも保持しているので、まだ始まっていないジョブも busy に数える
  isBusy(): boolean {
    return 0 < this.#running.size
  }
}

// suspended instance は application rollout 前の image を保持しうるので作り直す必要があるが、
// 毎ジョブやると cold start を繰り返す。version が取れないときは従来どおり毎回作り直す
export const shouldRecreateContainer = (
  version: string | undefined,
  lastSeenVersion: string | undefined,
): boolean => {
  return !version || version !== lastSeenVersion
}
