import { describe, expect, test } from "vitest"

import type { PublishJobSummary } from "../lib/publishing"
import { BackgroundPublishJobs } from "./background-publish"
import { SerialJobQueue } from "./job-queue"

describe("BackgroundPublishJobs", () => {
  const deferred = () => {
    let resolve: (value: PublishJobSummary) => void = () => {}
    let reject: (reason: unknown) => void = () => {}
    const promise = new Promise<PublishJobSummary>((onResolve, onReject) => {
      resolve = onResolve
      reject = onReject
    })

    return { promise, resolve, reject }
  }

  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const makeSummary = (workflowId: string): PublishJobSummary => {
    return { workflowId, buildHash: "build-hash", pages: [], failed: [], updatedPaths: [] }
  }

  describe("start", () => {
    test("呼び出しは待たずに返り、状態が running になる", async () => {
      const jobs = new BackgroundPublishJobs(new SerialJobQueue())
      const job = deferred()
      jobs.start("workflow-a", () => job.promise)
      // startedAt は内部だけで持ち、Workflow へ渡す形は変えない
      expect(jobs.read("workflow-a")).toEqual({ status: "running" })
      job.resolve(makeSummary("workflow-a"))
      await flush()
      expect(jobs.read("workflow-a")).toEqual({
        status: "done",
        summary: makeSummary("workflow-a"),
      })
    })

    test("同じ workflowId を二度受け付けても実行は 1 回だけ", async () => {
      const jobs = new BackgroundPublishJobs(new SerialJobQueue())
      const job = deferred()
      let calls = 0
      const execute = () => {
        calls += 1

        return job.promise
      }
      jobs.start("workflow-a", execute)
      jobs.start("workflow-a", execute)
      job.resolve(makeSummary("workflow-a"))
      await flush()
      expect(calls).toEqual(1)
    })

    test("完了した workflowId は二度目の受け付けでも走らせない", async () => {
      const jobs = new BackgroundPublishJobs(new SerialJobQueue())
      let calls = 0
      const execute = async () => {
        calls += 1

        return makeSummary("workflow-a")
      }
      jobs.start("workflow-a", execute)
      await flush()
      jobs.start("workflow-a", execute)
      await flush()
      expect(calls).toEqual(1)
      expect(jobs.read("workflow-a")).toEqual({
        status: "done",
        summary: makeSummary("workflow-a"),
      })
    })

    test("失敗したジョブは failed とメッセージを残す", async () => {
      const jobs = new BackgroundPublishJobs(new SerialJobQueue())
      const job = deferred()
      jobs.start("workflow-a", () => job.promise)
      job.reject(Error("generate が失敗しました"))
      await flush()
      expect(jobs.read("workflow-a")).toEqual({
        status: "failed",
        message: "generate が失敗しました",
      })
    })

    test("Error ではない失敗も文字列にして残す", async () => {
      const jobs = new BackgroundPublishJobs(new SerialJobQueue())
      const job = deferred()
      jobs.start("workflow-a", () => job.promise)
      job.reject("文字列で投げられた失敗")
      await flush()
      expect(jobs.read("workflow-a")).toEqual({
        status: "failed",
        message: "文字列で投げられた失敗",
      })
    })

    test("長すぎる失敗メッセージは DO 側の検証に通る長さへ切る", async () => {
      const jobs = new BackgroundPublishJobs(new SerialJobQueue())
      const job = deferred()
      jobs.start("workflow-a", () => job.promise)
      job.reject(Error("あ".repeat(5_000)))
      await flush()
      const state = jobs.read("workflow-a")
      expect(state?.status).toEqual("failed")
      expect(state?.status === "failed" && state.message.length).toEqual(2_000)
    })

    test("メッセージが空の失敗でも理由を残す", async () => {
      const jobs = new BackgroundPublishJobs(new SerialJobQueue())
      const job = deferred()
      jobs.start("workflow-a", () => job.promise)
      job.reject(Error(""))
      await flush()
      expect(jobs.read("workflow-a")).toEqual({ status: "failed", message: "不明なエラー" })
    })

    test("同じ queue を共有するジョブは直列で流れる", async () => {
      const queue = new SerialJobQueue()
      const jobs = new BackgroundPublishJobs(queue)
      const first = deferred()
      const started: Array<string> = []
      jobs.start("workflow-a", () => {
        started.push("a")

        return first.promise
      })
      jobs.start("workflow-b", async () => {
        started.push("b")

        return makeSummary("workflow-b")
      })
      await flush()
      expect(started).toEqual(["a"])
      first.resolve(makeSummary("workflow-a"))
      await flush()
      expect(started).toEqual(["a", "b"])
    })
  })

  describe("hasStaleRunning", () => {
    test("閾値を超えて走り続けているジョブがあるかを返す", async () => {
      let now = new Date("2026-09-25T00:00:00.000Z")
      const jobs = new BackgroundPublishJobs(new SerialJobQueue(), { now: () => now })
      const job = deferred()
      jobs.start("workflow-a", () => job.promise)
      expect(jobs.hasStaleRunning()).toEqual(false)
      now = new Date("2026-09-25T14:01:00.000Z")
      expect(jobs.hasStaleRunning()).toEqual(true)
      job.resolve(makeSummary("workflow-a"))
      await flush()
      expect(jobs.hasStaleRunning()).toEqual(false)
    })
  })

  describe("read", () => {
    test("受け付けていない workflowId は null", () => {
      expect(new BackgroundPublishJobs(new SerialJobQueue()).read("workflow-a")).toEqual(null)
    })
  })

  describe("runningWorkflowIds", () => {
    test("走り続けて古くなった workflowId は除外する", async () => {
      let now = new Date("2026-09-25T00:00:00.000Z")
      const jobs = new BackgroundPublishJobs(new SerialJobQueue(), { now: () => now })
      const job = deferred()
      jobs.start("workflow-a", () => job.promise)
      now = new Date("2026-09-25T13:59:00.000Z")
      expect(jobs.runningWorkflowIds()).toEqual(["workflow-a"])
      now = new Date("2026-09-25T14:01:00.000Z")
      expect(jobs.runningWorkflowIds()).toEqual([])
      job.resolve(makeSummary("workflow-a"))
      await flush()
    })

    test("走っているあいだだけ workflowId を返す", async () => {
      const jobs = new BackgroundPublishJobs(new SerialJobQueue())
      const job = deferred()
      jobs.start("workflow-a", () => job.promise)
      expect(jobs.runningWorkflowIds()).toEqual(["workflow-a"])
      job.resolve(makeSummary("workflow-a"))
      await flush()
      expect(jobs.runningWorkflowIds()).toEqual([])
    })

    test("失敗して終わった workflowId は返さない", async () => {
      const jobs = new BackgroundPublishJobs(new SerialJobQueue())
      const job = deferred()
      jobs.start("workflow-a", () => job.promise)
      job.reject(Error("失敗"))
      await flush()
      expect(jobs.runningWorkflowIds()).toEqual([])
    })
  })
})
