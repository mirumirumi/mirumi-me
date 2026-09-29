import { describe, expect, test } from "vitest"

import {
  collectGeneratePathFiles,
  createReleaseInstanceId,
  decideGenerate,
  findBaselineSha,
  findGenerateTriggers,
  type GenerateDecisionInput,
  parseReleaseSha,
} from "./release-plan"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)

describe("release plan", () => {
  const createReader = (files: Record<string, string>) => {
    return (path: string): string | null => {
      return files[path] ?? null
    }
  }

  describe("createReleaseInstanceId", () => {
    test("SHA と run ID と attempt から instance ID を作る", () => {
      expect(createReleaseInstanceId(SHA_A, "123", "2")).toEqual(`release-${SHA_A}-123-2`)
    })
  })

  describe("parseReleaseSha", () => {
    test("CI の instance ID から SHA を取り出す", () => {
      expect(parseReleaseSha(`release-${SHA_A}-123-2`)).toEqual(SHA_A)
    })

    test("run attempt だけを持つ古い形式からも取り出す", () => {
      expect(parseReleaseSha(`release-${SHA_A}-1`)).toEqual(SHA_A)
    })

    test("手元から流した generate や公開の ID は null にする", () => {
      expect(parseReleaseSha("manual-full-2026-09-26T04-51-02-205Z")).toEqual(null)
      expect(parseReleaseSha("c1596df8-8061-4b2b-b07d-40c6fbe77b50")).toEqual(null)
      expect(parseReleaseSha("release-abc-1")).toEqual(null)
    })
  })

  describe("findBaselineSha", () => {
    test("CI の instance のうち最も新しく作られたものの SHA を返す", () => {
      const instances = [
        { id: `release-${SHA_A}-1-1`, createdOn: "2026-09-20T00:00:00Z" },
        { id: "manual-full-2026-09-28T00-00-00-000Z", createdOn: "2026-09-28T00:00:00Z" },
        { id: `release-${SHA_B}-2-1`, createdOn: "2026-09-25T00:00:00Z" },
      ]
      expect(findBaselineSha(instances)).toEqual(SHA_B)
    })

    test("CI の instance がなければ null を返す", () => {
      const instances = [
        { id: "manual-full-2026-09-28T00-00-00-000Z", createdOn: "2026-09-28T00:00:00Z" },
      ]
      expect(findBaselineSha(instances)).toEqual(null)
    })
  })

  describe("collectGeneratePathFiles", () => {
    test("入口から相対 import と re-export をたどったファイルを集める", () => {
      const read = createReader({
        "server/src/containers/http.ts":
          'import { build } from "./build"\nexport { x } from "../lib/x"\n',
        "server/src/containers/build.ts": 'import {\n  render,\n} from "../lib/render"\n',
        "server/src/lib/render.ts": "export const render = () => {}\n",
        "server/src/lib/x.ts": "export const x = 1\n",
        "server/src/handlers/preview.ts": 'import { render } from "../lib/render"\n',
      })
      expect(collectGeneratePathFiles(["server/src/containers/http.ts"], read)).toEqual(
        new Set([
          "server/src/containers/http.ts",
          "server/src/containers/build.ts",
          "server/src/lib/render.ts",
          "server/src/lib/x.ts",
        ]),
      )
    })

    test("ディレクトリの import は index.ts として解決する", () => {
      const read = createReader({
        "server/src/entry.ts": 'import { a } from "./dir"\n',
        "server/src/dir/index.ts": "export const a = 1\n",
      })
      expect(collectGeneratePathFiles(["server/src/entry.ts"], read)).toEqual(
        new Set(["server/src/entry.ts", "server/src/dir/index.ts"]),
      )
    })

    test("型だけの import と export はたどらない", () => {
      const read = createReader({
        "server/src/entry.ts":
          'import type { A } from "./types"\nexport type { B } from "./more-types"\n',
        "server/src/types.ts": "export interface A {}\n",
        "server/src/more-types.ts": "export interface B {}\n",
      })
      expect(collectGeneratePathFiles(["server/src/entry.ts"], read)).toEqual(
        new Set(["server/src/entry.ts"]),
      )
    })

    test("パッケージの import はたどらない", () => {
      const read = createReader({
        "server/src/entry.ts": 'import { z } from "zod"\nimport { render } from "shared/render"\n',
      })
      expect(collectGeneratePathFiles(["server/src/entry.ts"], read)).toEqual(
        new Set(["server/src/entry.ts"]),
      )
    })
  })

  describe("findGenerateTriggers", () => {
    const generatePathFiles = new Set([
      "server/src/containers/build.ts",
      "server/src/lib/publishing.ts",
    ])

    test("generate の経路に乗っていないサーバーのコードだけなら何も返さない", () => {
      const changed = ["server/src/handlers/preview.ts", "server/src/services/turnstile.ts"]
      expect(findGenerateTriggers(changed, generatePathFiles)).toEqual([])
    })

    test("generate の経路に乗っているサーバーのコードを返す", () => {
      const changed = ["server/src/handlers/preview.ts", "server/src/lib/publishing.ts"]
      expect(findGenerateTriggers(changed, generatePathFiles)).toEqual([
        "server/src/lib/publishing.ts",
      ])
    })

    test("app と shared の変更を返す", () => {
      const changed = ["app/src/pages/index.vue", "shared/src/render.ts"]
      expect(findGenerateTriggers(changed, generatePathFiles)).toEqual(changed)
    })

    test("テストと、サイトの生成物に効かないとわかっているものは返さない", () => {
      const changed = [
        "app/src/utils/date.test.ts",
        "server/src/lib/publishing.test.ts",
        "docs/reference/用語集.md",
        ".github/workflows/deploy.yml",
        "terraform/envs/prd/main.tf",
        "tools/migrate-to-notion/src/fetch.ts",
        "AGENTS.md",
        "biome.json",
      ]
      expect(findGenerateTriggers(changed, generatePathFiles)).toEqual([])
    })

    test("効かないとわかっていないものは返す", () => {
      const changed = [
        "bun.lock",
        "package.json",
        "server/wrangler.jsonc",
        "server/src/containers/Dockerfile",
        "patches/@nuxtjs%2Fgoogle-adsense@3.0.3.patch",
      ]
      expect(findGenerateTriggers(changed, generatePathFiles)).toEqual(changed)
    })
  })

  describe("decideGenerate", () => {
    const base: GenerateDecisionInput = {
      request: "auto",
      baselineSha: SHA_A,
      changedFiles: ["docs/reference/用語集.md"],
      generatePathFiles: new Set<string>(),
    }

    test("always なら差分を見ずに generate する", () => {
      expect(decideGenerate({ ...base, request: "always" }).generate).toEqual(true)
    })

    test("skip なら差分を見ずに generate しない", () => {
      const changedFiles = ["app/src/pages/index.vue"]
      expect(decideGenerate({ ...base, request: "skip", changedFiles }).generate).toEqual(false)
    })

    test("完了した generate の記録がなければ generate する", () => {
      expect(decideGenerate({ ...base, baselineSha: null, changedFiles: null }).generate).toEqual(
        true,
      )
    })

    test("基準点のコミットが手元になければ generate する", () => {
      expect(decideGenerate({ ...base, changedFiles: null }).generate).toEqual(true)
    })

    test("生成物に効く変更があれば、その変更を添えて generate する", () => {
      const changedFiles = ["docs/reference/用語集.md", "app/src/pages/index.vue"]
      const decision = decideGenerate({ ...base, changedFiles })
      expect(decision.generate).toEqual(true)
      expect(decision.triggers).toEqual(["app/src/pages/index.vue"])
    })

    test("生成物に効く変更がなければ generate しない", () => {
      const decision = decideGenerate(base)
      expect(decision.generate).toEqual(false)
      expect(decision.triggers).toEqual([])
    })
  })
})
