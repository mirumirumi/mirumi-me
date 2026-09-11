import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { once } from "node:events"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"

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
      stdio: "inherit",
    })
    const [exitCode] = await once(child, "exit")
    if (exitCode !== 0) {
      throw Error(`Nuxt generate が終了コード ${exitCode} で失敗しました`)
    }
  } else {
    await mkdir(outputDirectory, { recursive: true })
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
