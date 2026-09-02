import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"

import { BUILD_MANIFEST_FILES } from "shared/build-manifest"

import { createPrerenderConfiguration } from "./prerender"

describe("createPrerenderConfiguration", () => {
  const directories: Array<string> = []
  const createManifest = async (mode?: "partial" | "full"): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), "mirumi-prerender-"))
    directories.push(directory)
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, BUILD_MANIFEST_FILES.plan),
      JSON.stringify({
        schemaVersion: 1,
        workflowId: "workflow-id",
        mode: mode ?? "full",
        generatedAt: "2026-08-24T00:00:00.000Z",
        routes: ["/", "/article-slug/"],
        pageIdsByRoute: {
          "/article-slug/": "00000000-0000-0000-0000-000000000001",
        },
      }),
    )

    return directory
  }

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
  })

  test("build 環境変数がない通常の dev 設定を返す", () => {
    const configuration = createPrerenderConfiguration({})

    expect(configuration.buildPlan).toEqual(null)
    expect(configuration.prerenderRoutes).toEqual([])
  })

  test("manifest directory と build mode の片方だけなら拒否する", () => {
    expect(() =>
      createPrerenderConfiguration({ MIRUMI_BUILD_MANIFEST_DIR: "/tmp/manifest" }),
    ).toThrowError("同時に指定")
    expect(() => createPrerenderConfiguration({ MIRUMI_BUILD_MODE: "full" })).toThrowError(
      "同時に指定",
    )
  })

  test("build plan と要求された mode の不一致を拒否する", async () => {
    const directory = await createManifest("partial")

    expect(() =>
      createPrerenderConfiguration({
        MIRUMI_BUILD_MANIFEST_DIR: directory,
        MIRUMI_BUILD_MODE: "full",
      }),
    ).toThrowError("build plan と一致")
  })

  test("末尾 slash と payload を build 対象 route として扱う", async () => {
    const directory = await createManifest()
    const configuration = createPrerenderConfiguration({
      MIRUMI_BUILD_MANIFEST_DIR: directory,
      MIRUMI_BUILD_MODE: "full",
    })

    expect(configuration.prerenderRoutes).toEqual(["/", "/article-slug/"])
    expect(configuration.isAllowedPrerenderRoute("/")).toEqual(true)
    expect(configuration.isAllowedPrerenderRoute("/_payload.json")).toEqual(true)
    expect(configuration.isAllowedPrerenderRoute("/article-slug")).toEqual(true)
    expect(configuration.isAllowedPrerenderRoute("/article-slug/")).toEqual(true)
    expect(configuration.isAllowedPrerenderRoute("/article-slug/_payload.json")).toEqual(true)
    expect(configuration.isAllowedPrerenderRoute("/unknown/")).toEqual(false)
  })
})
