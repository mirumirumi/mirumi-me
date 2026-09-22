import { type ChildProcessByStdio, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Readable } from "node:stream"

import type { BuildPage, BuildPlan } from "shared/build-manifest"
import { BUILD_MANIFEST_FILES, createCategoriesManifest } from "shared/build-manifest"

import {
  createPageSummariesManifestFromDeployment,
  type SiteDeploymentState,
} from "../lib/publishing"
import { generateSiteFeed } from "./site-feed"
import { generateSiteSitemaps } from "./site-sitemap"

const APP_DIRECTORY = "/app/app"
const BUILD_ROOT = "/tmp/mirumi-build"

interface GenerateSiteInput {
  workflowId: string
  plan: BuildPlan
  pages: Array<BuildPage>
  deploymentState: SiteDeploymentState
  workersApiOrigin: string
  appEnv: "dev" | "prd"
  // comment-refresh は記事 1 本しか変わらないため sitemap / feed を出さない
  xml?: boolean
}

export interface GeneratedSite {
  outputDirectory: string
  manifestDirectory: string
}

const writeJson = async (path: string, value: unknown) => {
  await writeFile(path, JSON.stringify(value), "utf8")
}

const safeJobName = (workflowId: string): string => {
  const prefix = workflowId.replaceAll(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "workflow"
  const suffix = createHash("sha256").update(workflowId).digest("hex").slice(0, 12)

  return `${prefix}-${suffix}`
}

// Container の標準出力はどこからも読めないため、generate が落ちた原因を例外へ載せて
// Workflow まで持ち上げる。進捗ログが大量に流れるので、末尾を取るだけではエラー行が押し流される
// Container の標準出力はどこからも読めないため、generate が落ちた原因を例外へ載せて
// Workflow まで持ち上げる。エラー行を選り分けようとすると本当の原因を取りこぼすので、
// 素直に末尾をまとめて渡す
const MAX_CHILD_OUTPUT_CHARS = 1_800

interface ChildOutputTail {
  read: () => string
}

const captureChildOutput = (
  child: ChildProcessByStdio<null, Readable, Readable>,
): ChildOutputTail => {
  let buffered = ""
  for (const [stream, forward] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ] as const) {
    stream.setEncoding("utf8")
    stream.on("data", (chunk: string) => {
      forward.write(chunk)
      buffered = (buffered + chunk).slice(-MAX_CHILD_OUTPUT_CHARS)
    })
  }

  return { read: () => buffered.trim() }
}

const buildEnvironment = (
  manifestDirectory: string,
  plan: BuildPlan,
  workersApiOrigin: string,
  appEnv: string,
): Record<string, string> => {
  // 計測タグと広告は prd の生成物にだけ埋め込む
  const environment: Record<string, string> = {
    NODE_ENV: "production",
    APP_ENV: appEnv,
    MIRUMI_BUILD_MANIFEST_DIR: manifestDirectory,
    MIRUMI_BUILD_MODE: plan.mode,
    WORKERS_API_ORIGIN: workersApiOrigin,
  }
  for (const name of ["PATH", "LANG", "TZ", "HOME"]) {
    const value = process.env[name]
    if (value) {
      environment[name] = value
    }
  }

  return environment
}

export const generateSite = async ({
  workflowId,
  plan,
  pages,
  deploymentState,
  workersApiOrigin,
  appEnv,
  xml = true,
}: GenerateSiteInput): Promise<GeneratedSite> => {
  const jobDirectory = join(BUILD_ROOT, safeJobName(workflowId))
  const manifestDirectory = join(jobDirectory, "manifest")
  const outputDirectory = join(APP_DIRECTORY, ".output/public")
  await rm(jobDirectory, { recursive: true, force: true })
  await rm(join(APP_DIRECTORY, ".output"), { recursive: true, force: true })
  await mkdir(join(manifestDirectory, BUILD_MANIFEST_FILES.articles), { recursive: true })

  const summaries = createPageSummariesManifestFromDeployment(Object.values(deploymentState.pages))
  await Promise.all([
    writeJson(join(manifestDirectory, BUILD_MANIFEST_FILES.plan), plan),
    writeJson(join(manifestDirectory, BUILD_MANIFEST_FILES.pageSummaries), summaries),
    writeJson(
      join(manifestDirectory, BUILD_MANIFEST_FILES.categories),
      createCategoriesManifest(summaries.pages.map(({ category }) => category)),
    ),
    ...pages.map((page) => {
      return writeJson(
        join(manifestDirectory, BUILD_MANIFEST_FILES.articles, `${page.pageId}.json`),
        page,
      )
    }),
  ])

  if (0 < plan.routes.length) {
    const child = spawn("bun", ["run", "generate"], {
      cwd: APP_DIRECTORY,
      env: buildEnvironment(manifestDirectory, plan, workersApiOrigin, appEnv),
      stdio: ["ignore", "pipe", "pipe"],
    })
    // Container の標準出力はどこからも読めないため、失敗したときは末尾を例外へ載せて
    // Workflow と Notion の 公開エラー まで原因を持ち上げる
    const tail = captureChildOutput(child)
    const [exitCode] = await once(child, "exit")
    if (exitCode !== 0) {
      throw Error(`Nuxt generate が終了コード ${exitCode} で失敗しました: ${tail.read()}`)
    }
  } else {
    await mkdir(outputDirectory, { recursive: true })
  }

  if (!xml) {
    return { outputDirectory, manifestDirectory }
  }
  const deployedPages = Object.values(deploymentState.pages)
  const xmlFiles = {
    ...generateSiteSitemaps(deployedPages),
    "feed.xml": generateSiteFeed(deployedPages),
  }
  await Promise.all(
    Object.entries(xmlFiles).map(([filename, content]) => {
      return writeFile(join(outputDirectory, filename), content, "utf8")
    }),
  )

  return { outputDirectory, manifestDirectory }
}
