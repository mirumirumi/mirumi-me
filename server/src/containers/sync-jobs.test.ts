import { describe, expect, test } from "vitest"

import { SerialJobQueue } from "./job-queue"
import { SyncJobs } from "./sync-jobs"

describe("SyncJobs", () => {
  const deferred = () => {
    let resolve: (value: string) => void = () => {}
    const promise = new Promise<string>((value) => {
      resolve = value
    })

    return { promise, resolve }
  }

  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  describe("run", () => {
    test("queue を通して直列に実行し、結果を返す", async () => {
      const queue = new SerialJobQueue()
      const jobs = new SyncJobs(queue)
      const first = deferred()
      const started: Array<string> = []
      const firstJob = jobs.run("a", async () => {
        started.push("a")
        return first.promise
      })
      const secondJob = jobs.run("b", async () => {
        started.push("b")
        return "b"
      })
      await flush()
      expect(started).toEqual(["a"])
      expect(queue.isBusy()).toEqual(true)
      first.resolve("a")
      expect(await Promise.all([firstJob, secondJob])).toEqual(["a", "b"])
    })
  })

  describe("hasStaleRunning", () => {
    test("走り始めてから 30 分を超えたジョブがあるかを返す", async () => {
      let now = new Date("2026-09-29T00:00:00.000Z")
      const jobs = new SyncJobs(new SerialJobQueue(), { now: () => now })
      const job = deferred()
      const running = jobs.run("a", () => job.promise)
      await flush()
      now = new Date("2026-09-29T00:29:00.000Z")
      expect(jobs.hasStaleRunning()).toEqual(false)
      now = new Date("2026-09-29T00:31:00.000Z")
      expect(jobs.hasStaleRunning()).toEqual(true)
      job.resolve("a")
      await running
      expect(jobs.hasStaleRunning()).toEqual(false)
    })

    test("キューで待っているあいだは時間に数えない", async () => {
      let now = new Date("2026-09-29T00:00:00.000Z")
      const jobs = new SyncJobs(new SerialJobQueue(), { now: () => now })
      const first = deferred()
      const second = deferred()
      const firstJob = jobs.run("a", () => first.promise)
      const secondJob = jobs.run("b", () => second.promise)
      await flush()
      now = new Date("2026-09-29T00:20:00.000Z")
      first.resolve("a")
      await firstJob
      await flush()
      now = new Date("2026-09-29T00:40:00.000Z")
      expect(jobs.hasStaleRunning()).toEqual(false)
      second.resolve("b")
      await secondJob
    })

    test("失敗したジョブは数えない", async () => {
      let now = new Date("2026-09-29T00:00:00.000Z")
      const jobs = new SyncJobs(new SerialJobQueue(), { now: () => now })
      await expect(
        jobs.run("a", async () => {
          throw Error("失敗")
        }),
      ).rejects.toThrow("失敗")
      now = new Date("2026-09-29T01:00:00.000Z")
      expect(jobs.hasStaleRunning()).toEqual(false)
    })
  })
})
