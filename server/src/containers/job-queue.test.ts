import { describe, expect, test } from "vitest"

import { SerialJobQueue, shouldRecreateContainer } from "./job-queue"

describe("SerialJobQueue", () => {
  const deferred = () => {
    let resolve: (value: string) => void = () => {}
    let reject: (reason: unknown) => void = () => {}
    const promise = new Promise<string>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })

    return { promise, resolve, reject }
  }

  describe("run", () => {
    test("後から来たジョブは前のジョブが終わるまで始まらない", async () => {
      const queue = new SerialJobQueue()
      const first = deferred()
      const started: Array<string> = []
      const firstJob = queue.run("a", async () => {
        started.push("a")
        return first.promise
      })
      const secondJob = queue.run("b", async () => {
        started.push("b")
        return "b"
      })
      await Promise.resolve()
      expect(started).toEqual(["a"])
      first.resolve("a")
      expect(await Promise.all([firstJob, secondJob])).toEqual(["a", "b"])
      expect(started).toEqual(["a", "b"])
    })

    test("実行中の key と同じ依頼は積み増さず同じ結果を返す", async () => {
      const queue = new SerialJobQueue()
      const job = deferred()
      let calls = 0
      const execute = async () => {
        calls += 1
        return job.promise
      }
      const first = queue.run("same", execute)
      const retry = queue.run("same", execute)
      job.resolve("done")

      expect(await Promise.all([first, retry])).toEqual(["done", "done"])
      expect(calls).toEqual(1)
    })

    test("終わった key は次の依頼で普通に実行し直す", async () => {
      const queue = new SerialJobQueue()
      let calls = 0
      const execute = async () => {
        calls += 1
        return calls
      }

      expect(await queue.run("same", execute)).toEqual(1)
      expect(await queue.run("same", execute)).toEqual(2)
    })

    test("先頭のジョブが途中で失敗しても待っていた後続は流れる", async () => {
      const queue = new SerialJobQueue()
      const first = deferred()
      const started: Array<string> = []
      const failing = queue.run("fail", async () => {
        started.push("fail")

        return first.promise
      })
      const next = queue.run("next", async () => {
        started.push("next")

        return "ok"
      })
      await Promise.resolve()
      expect(started).toEqual(["fail"])
      first.reject(Error("失敗"))
      await expect(failing).rejects.toThrow("失敗")
      expect(await next).toEqual("ok")
      expect(started).toEqual(["fail", "next"])
    })
  })

  describe("isBusy", () => {
    test("何も積まれていなければ false", () => {
      expect(new SerialJobQueue().isBusy()).toEqual(false)
    })

    test("キュー待ちのジョブも busy に数える", async () => {
      const queue = new SerialJobQueue()
      const first = deferred()
      const running = queue.run("a", () => first.promise)
      const waiting = queue.run("b", async () => "b")
      expect(queue.isBusy()).toEqual(true)
      first.resolve("a")
      await Promise.all([running, waiting])
      expect(queue.isBusy()).toEqual(false)
    })
  })
})

describe("shouldRecreateContainer", () => {
  test("version が変わったときだけ作り直す", () => {
    expect(shouldRecreateContainer("v2", "v1")).toEqual(true)
    expect(shouldRecreateContainer("v1", "v1")).toEqual(false)
  })

  test("version が取れないときは毎回作り直す", () => {
    expect(shouldRecreateContainer(undefined, "v1")).toEqual(true)
    expect(shouldRecreateContainer(undefined, undefined)).toEqual(true)
  })

  test("初回は作り直す", () => {
    expect(shouldRecreateContainer("v1", undefined)).toEqual(true)
  })
})
