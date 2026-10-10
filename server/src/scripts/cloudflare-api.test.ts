import { afterEach, describe, expect, test, vi } from "vitest"

import { CloudflareWorkflowsApi } from "./cloudflare-api"

describe("CloudflareWorkflowsApi", () => {
  const listPage = (ids: Array<string>, cursor: string | null) => {
    return {
      success: true,
      errors: [],
      result: ids.map((id) => ({ id, created_on: "2026-10-03T05:04:28Z", status: "complete" })),
      result_info: { cursor },
    }
  }

  // status ごとに返す page を決める。cursor 付きの request には 2 ページ目を返す
  const stubFetch = (pages: Record<string, Array<unknown>>) => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input)
      const status = url.searchParams.get("status") ?? ""
      const index = url.searchParams.get("cursor") ? 1 : 0

      return Response.json(pages[status]?.[index] ?? listPage([], null))
    })
    vi.stubGlobal("fetch", fetchMock)

    return fetchMock
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe("listCompletedInstances", () => {
    test("最後のページで cursor が null でも一覧を返す", async () => {
      stubFetch({ complete: [listPage(["first"], "next"), listPage(["second"], null)] })
      const api = new CloudflareWorkflowsApi("account", "token")

      expect(await api.listCompletedInstances("workflow")).toEqual([
        { id: "first", createdOn: "2026-10-03T05:04:28Z" },
        { id: "second", createdOn: "2026-10-03T05:04:28Z" },
      ])
    })
  })

  describe("findTerminalStatus", () => {
    test("詳細を取れない instance も、一覧で終わった状態を見つける", async () => {
      stubFetch({
        complete: [listPage(["other"], "next"), listPage(["target"], null)],
      })
      const api = new CloudflareWorkflowsApi("account", "token")

      expect(await api.findTerminalStatus("workflow", "target")).toEqual("complete")
    })

    test("失敗や中止で終わった instance も見つける", async () => {
      stubFetch({ errored: [listPage(["target"], null)] })
      const api = new CloudflareWorkflowsApi("account", "token")

      expect(await api.findTerminalStatus("workflow", "target")).toEqual("errored")
    })

    test("まだ終わっていなければ null を返す", async () => {
      stubFetch({})
      const api = new CloudflareWorkflowsApi("account", "token")

      expect(await api.findTerminalStatus("workflow", "target")).toEqual(null)
    })
  })
})
