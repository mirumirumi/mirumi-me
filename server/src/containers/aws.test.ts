import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { runAwsOperation } from "./aws"

describe("runAwsOperation", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const never = (): Promise<never> => {
    return new Promise(() => undefined)
  }

  test("時間内に終わった操作の結果をそのまま返し、打ち切り用の signal を渡す", async () => {
    const operation = vi.fn(async (_signal: AbortSignal) => "body")

    expect(await runAwsOperation("S3 GET a", operation, { timeoutMs: 1_000, attempts: 3 })).toEqual(
      "body",
    )
    expect(operation).toHaveBeenCalledTimes(1)
    expect(operation.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal)
  })

  test("返ってこない試行は時間で打ち切って abort し、やり直した試行の結果を返す", async () => {
    const signals: Array<AbortSignal> = []
    const operation = vi.fn(async (signal: AbortSignal) => {
      signals.push(signal)

      return signals.length === 1 ? never() : "body"
    })
    const result = runAwsOperation("S3 GET a", operation, { timeoutMs: 1_000, attempts: 3 })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(await result).toEqual("body")
    expect(operation).toHaveBeenCalledTimes(2)
    expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
  })

  test("すべての試行が返ってこなければ、操作の名前と時間を添えて失敗させる", async () => {
    const operation = vi.fn(async (_signal: AbortSignal) => never())
    const result = runAwsOperation("S3 GET a", operation, { timeoutMs: 1_000, attempts: 2 })
    const assertion = expect(result).rejects.toThrow(
      "AWS の S3 GET a が 1 秒以内に終わりませんでした",
    )
    await vi.advanceTimersByTimeAsync(2_000)

    await assertion
    expect(operation).toHaveBeenCalledTimes(2)
  })

  test("時間切れ以外のエラーはやり直さない（SDK が自分でやり直したあとのエラーのため）", async () => {
    const operation = vi.fn(async (_signal: AbortSignal) => {
      throw Error("AccessDenied")
    })

    await expect(
      runAwsOperation("S3 GET a", operation, { timeoutMs: 1_000, attempts: 3 }),
    ).rejects.toThrow("AccessDenied")
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
