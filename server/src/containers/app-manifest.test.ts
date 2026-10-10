import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"

import { completeAppManifest, mergePrerenderedRoutes } from "./app-manifest"

describe("mergePrerenderedRoutes", () => {
  test("今回の route を先頭に、前回だけにあった route を後ろへ足す", () => {
    expect(mergePrerenderedRoutes(["/", "/new"], ["/", "/old", "/new"], [])).toEqual([
      "/",
      "/new",
      "/old",
    ])
  })

  test("末尾スラッシュを揃えて重複させない。ルートだけは / のまま", () => {
    expect(mergePrerenderedRoutes(["/a/"], ["/a", "/b/", "/"], [])).toEqual(["/a", "/b", "/"])
  })

  test("今回非公開にした route は前回にあっても落とす", () => {
    expect(mergePrerenderedRoutes(["/"], ["/", "/removed", "/kept"], ["/removed/"])).toEqual([
      "/",
      "/kept",
    ])
  })
})

describe("completeAppManifest", () => {
  const createOutput = async (id: string, prerendered: Array<string>): Promise<string> => {
    const directory = await mkdtemp(join(tmpdir(), "app-manifest-"))
    await mkdir(join(directory, "_nuxt/builds/meta"), { recursive: true })
    await writeFile(
      join(directory, "_nuxt/builds/latest.json"),
      JSON.stringify({ id, timestamp: 1 }),
    )
    await writeFile(
      join(directory, "_nuxt/builds/meta", `${id}.json`),
      JSON.stringify({ id, timestamp: 1, matcher: { static: {} }, prerendered }),
    )
    return directory
  }
  const readManifest = async (
    directory: string,
    id: string,
  ): Promise<{ prerendered: Array<string>; matcher: unknown }> => {
    return JSON.parse(await readFile(join(directory, "_nuxt/builds/meta", `${id}.json`), "utf8"))
  }
  const storeWith = (objects: Record<string, string>) => {
    return {
      get: async (key: string): Promise<Uint8Array | null> => {
        const body = objects[key]
        return body === undefined ? null : new TextEncoder().encode(body)
      },
    }
  }

  test("配信中の manifest と和集合を取って書き戻す", async () => {
    const directory = await createOutput("new-id", ["/", "/new"])
    const store = storeWith({
      "_nuxt/builds/latest.json": JSON.stringify({ id: "old-id", timestamp: 0 }),
      "_nuxt/builds/meta/old-id.json": JSON.stringify({
        id: "old-id",
        timestamp: 0,
        matcher: {},
        prerendered: ["/", "/old", "/removed"],
      }),
    })
    await completeAppManifest(directory, store, ["/removed/"])
    const manifest = await readManifest(directory, "new-id")
    expect(manifest.prerendered).toEqual(["/", "/new", "/old"])
    expect(manifest.matcher).toEqual({ static: {} })
  })

  test("配信中の manifest がなければそのまま", async () => {
    const directory = await createOutput("new-id", ["/", "/new"])
    await completeAppManifest(directory, storeWith({}), [])
    expect((await readManifest(directory, "new-id")).prerendered).toEqual(["/", "/new"])
  })

  test("前回の meta が壊れていても今回の manifest を壊さない", async () => {
    const directory = await createOutput("new-id", ["/", "/new"])
    const store = storeWith({
      "_nuxt/builds/latest.json": JSON.stringify({ id: "old-id" }),
      "_nuxt/builds/meta/old-id.json": "{ broken",
    })
    await completeAppManifest(directory, store, [])
    expect((await readManifest(directory, "new-id")).prerendered).toEqual(["/", "/new"])
  })
})
