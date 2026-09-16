import { describe, expect, test, vi } from "vitest"

import type { SiteObject } from "./aws"
import { JobProgressReporter, jobProgressKey } from "./job-progress"

describe("JobProgressReporter", () => {
  const createStore = () => {
    const put = vi.fn(async (_key: string, _object: SiteObject) => {})

    return { store: { put, delete: vi.fn(async () => {}) }, put }
  }
  const createClock = (start: number) => {
    let current = start

    return {
      now: () => new Date(current),
      advance: (ms: number) => {
        current += ms
      },
    }
  }
  const readProgress = (object: SiteObject) => {
    return JSON.parse(new TextDecoder().decode(object.body))
  }

  describe("jobProgressKey", () => {
    test("workflow ID を内部 prefix の下へ置く", () => {
      expect(jobProgressKey("full-20260912T105545Z")).toEqual(
        "_internal/jobs/full-20260912T105545Z.json",
      )
    })

    test("key に使えない文字を含む workflow ID を encode する", () => {
      expect(jobProgressKey("a/b c")).toEqual("_internal/jobs/a%2Fb%20c.json")
    })
  })

  describe("report", () => {
    test("初回は即座に書き込む", async () => {
      const { store, put } = createStore()
      const clock = createClock(Date.parse("2026-09-13T00:00:00.000Z"))
      await new JobProgressReporter(store, "wf-1", { now: clock.now }).report(
        "load-articles",
        1,
        470,
      )
      expect(put).toHaveBeenCalledTimes(1)
      expect(readProgress(put.mock.calls[0]![1])).toEqual({
        workflowId: "wf-1",
        phase: "load-articles",
        completed: 1,
        total: 470,
        startedAt: "2026-09-13T00:00:00.000Z",
        updatedAt: "2026-09-13T00:00:00.000Z",
        detail: null,
      })
    })

    test("短い間隔の連続報告は間引く", async () => {
      const { store, put } = createStore()
      const clock = createClock(Date.parse("2026-09-13T00:00:00.000Z"))
      const reporter = new JobProgressReporter(store, "wf-1", { now: clock.now })
      await reporter.report("load-articles", 1, 470)
      clock.advance(1_000)
      await reporter.report("load-articles", 2, 470)
      clock.advance(1_000)
      await reporter.report("load-articles", 3, 470)
      expect(put).toHaveBeenCalledTimes(1)
    })

    test("間隔が空けば再び書き込む", async () => {
      const { store, put } = createStore()
      const clock = createClock(Date.parse("2026-09-13T00:00:00.000Z"))
      const reporter = new JobProgressReporter(store, "wf-1", { now: clock.now })
      await reporter.report("load-articles", 1, 470)
      clock.advance(5_000)
      await reporter.report("load-articles", 120, 470)
      expect(put).toHaveBeenCalledTimes(2)
      expect(readProgress(put.mock.calls[1]![1]).completed).toEqual(120)
    })

    test("done は間引かずに必ず書き込む", async () => {
      const { store, put } = createStore()
      const clock = createClock(Date.parse("2026-09-13T00:00:00.000Z"))
      const reporter = new JobProgressReporter(store, "wf-1", { now: clock.now })
      await reporter.report("load-articles", 1, 470)
      await reporter.report("done", 470, 470)
      expect(put).toHaveBeenCalledTimes(2)
      expect(readProgress(put.mock.calls[1]![1])).toEqual(
        expect.objectContaining({ phase: "done", completed: 470 }),
      )
    })

    test("S3 への書き込みが失敗しても例外にしない", async () => {
      const put = vi.fn(async () => {
        throw Error("S3 unavailable")
      })
      const reporter = new JobProgressReporter({ put, delete: vi.fn(async () => {}) }, "wf-1")
      await expect(reporter.report("generate", 0, 470)).resolves.toBeUndefined()
    })
  })
})
