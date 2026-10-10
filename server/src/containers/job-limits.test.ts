import { describe, expect, test } from "vitest"

import { BACKGROUND_JOB_STALE_MS, decideExpiredAction, SYNC_JOB_STALE_MS } from "./job-limits"

describe("job limits", () => {
  const now = Date.parse("2026-09-29T12:00:00.000Z")
  const minute = 60 * 1_000

  describe("decideExpiredAction", () => {
    test("Container が空いていれば止める", () => {
      expect(decideExpiredAction("idle", { background: now - minute, sync: null }, now)).toEqual(
        "stop",
      )
    })

    test("期限内の generate は、Container が busy と答えるあいだ残す", () => {
      const background = now - BACKGROUND_JOB_STALE_MS + minute
      expect(decideExpiredAction("busy", { background, sync: null }, now)).toEqual("keep")
    })

    test("generate が期限を過ぎたら、Container が busy と答えても SIGKILL で止める", () => {
      const background = now - BACKGROUND_JOB_STALE_MS - minute
      expect(decideExpiredAction("busy", { background, sync: null }, now)).toEqual("destroy")
    })

    test("Container が応答しなくても、期限内の公開は残す", () => {
      expect(
        decideExpiredAction("unknown", { background: null, sync: now - 10 * minute }, now),
      ).toEqual("keep")
    })

    test("公開が期限を過ぎて Container も応答しなければ SIGKILL で止める", () => {
      const sync = now - SYNC_JOB_STALE_MS - minute
      expect(decideExpiredAction("unknown", { background: null, sync }, now)).toEqual("destroy")
    })

    test("generate と公開の両方を渡していれば、遅いほうの期限まで残す", () => {
      const background = now - 60 * minute
      const sync = now - SYNC_JOB_STALE_MS - minute
      expect(decideExpiredAction("busy", { background, sync }, now)).toEqual("keep")
    })

    test("渡したジョブの記録がないのに空いていなければ、残して時計を始める", () => {
      expect(decideExpiredAction("busy", { background: null, sync: null }, now)).toEqual("adopt")
      expect(decideExpiredAction("unknown", { background: null, sync: null }, now)).toEqual("adopt")
    })
  })
})
