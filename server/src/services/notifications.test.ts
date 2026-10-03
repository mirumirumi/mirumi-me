import { describe, expect, test, vi } from "vitest"

import {
  createPublishFailureMessage,
  createSiteLabel,
  createStuckPublishMessage,
  createWorkflowErrorMessage,
  runStuckPublishCheck,
  type StuckPublishPage,
} from "./notifications"

describe("notifications", () => {
  const pageId = "3c065425-ad40-81c3-8029-ce4715996233"

  describe("createSiteLabel", () => {
    test("prd 以外は環境名を付けて見分けられるようにする", () => {
      expect(createSiteLabel("prd")).toEqual("mirumi.me")
      expect(createSiteLabel("dev")).toEqual("mirumi.me (dev)")
    })
  })

  describe("createPublishFailureMessage", () => {
    test("失敗した記事を、理由と Notion の URL つきで並べる", () => {
      expect(
        createPublishFailureMessage(
          {
            workflowId: "release-abc",
            mode: "full",
            failures: [
              {
                pageId,
                title: "記事タイトル",
                slug: "article",
                message: "ブックマークを解決できませんでした",
              },
            ],
          },
          "mirumi.me (dev)",
        ),
      ).toEqual(
        [
          "[mirumi.me (dev)] generate で 1 件の記事が失敗しました",
          "・記事タイトル（article）: ブックマークを解決できませんでした",
          "  https://www.notion.so/3c065425ad4081c38029ce4715996233",
          "これらの記事は前に公開した内容で配信しています。直せば、次の generate か「公開」で戻ります",
          "Workflow: release-abc",
        ].join("\n"),
      )
    })

    test("多いときは先頭だけを並べ、長い理由は切り詰める", () => {
      const failures = Array.from({ length: 22 }, (_, index) => ({
        pageId,
        title: `記事 ${index}`,
        slug: `article-${index}`,
        message: "理".repeat(400),
      }))
      const message = createPublishFailureMessage(
        { workflowId: "partial-id", mode: "partial", failures },
        "mirumi.me",
      )

      expect(message.split("\n").filter((line) => line.startsWith("・"))).toHaveLength(20)
      expect(message).toContain("（ほか 2 件）")
      expect(message).toContain(`${"理".repeat(300)}…`)
      expect(message).toContain("公開ボタンの処理で 22 件の記事が失敗しました")
    })
  })

  describe("createWorkflowErrorMessage", () => {
    test("止まった処理と理由を伝える", () => {
      expect(
        createWorkflowErrorMessage({
          siteLabel: "mirumi.me",
          label: "generate",
          workflowId: "release-abc",
          message: "Container が publish job を見失いました",
        }),
      ).toEqual(
        [
          "[mirumi.me] generate が途中で止まりました",
          "理由: Container が publish job を見失いました",
          "Workflow: release-abc",
        ].join("\n"),
      )
    })
  })

  describe("createStuckPublishMessage", () => {
    test("止まっている記事と、押し直しでは動かないことを伝える", () => {
      const message = createStuckPublishMessage(
        [
          {
            pageId,
            title: "記事タイトル",
            slug: "article",
            internalState: "公開待ち",
            lastEditedTime: "2026-10-03T09:14:00.000Z",
          },
        ],
        "mirumi.me",
      )

      expect(message).toContain(
        "[mirumi.me] 公開待ち / 非公開待ち のまま 2 時間以上止まっている記事が 1 件あります",
      )
      expect(message).toContain("・記事タイトル（article）: 公開待ち（2026/10/03 18:14 から）")
      expect(message).toContain("POST /admin/publish")
    })
  })

  describe("runStuckPublishCheck", () => {
    const stuck: StuckPublishPage = {
      pageId,
      title: "記事タイトル",
      slug: "article",
      internalState: "非公開待ち",
      lastEditedTime: "2026-10-03T06:00:00.000Z",
    }

    test("2 時間より前から止まっている記事だけを探して通知する", async () => {
      const loadStuckPages = vi.fn(async () => [stuck])
      const notify = vi.fn(async () => undefined)

      expect(
        await runStuckPublishCheck(
          { loadStuckPages, notify, now: () => new Date("2026-10-03T09:00:00.000Z") },
          "mirumi.me",
        ),
      ).toEqual({ count: 1, notified: true })
      expect(loadStuckPages).toHaveBeenCalledWith("2026-10-03T07:00:00.000Z")
      expect(notify).toHaveBeenCalledTimes(1)
    })

    test("止まっている記事がなければ通知しない", async () => {
      const notify = vi.fn(async () => undefined)

      expect(
        await runStuckPublishCheck(
          {
            loadStuckPages: async () => [],
            notify,
            now: () => new Date("2026-10-03T09:00:00.000Z"),
          },
          "mirumi.me",
        ),
      ).toEqual({ count: 0, notified: false })
      expect(notify).not.toHaveBeenCalled()
    })
  })
})
