import { readFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import type {
  BuildPage,
  BuildPlan,
  CategoriesManifest,
  PageSummariesManifest,
} from "shared/build-manifest"
import {
  BUILD_MANIFEST_FILES,
  parseBuildPage,
  parseBuildPlan,
  parseCategoriesManifest,
  parsePageSummariesManifest,
} from "shared/build-manifest"

import { NotionDevelopmentContentReader } from "./notion-content"

const MAX_ARTICLE_BYTES = 2 * 1_024 * 1_024
const MAX_INDEX_BYTES = 4 * 1_024 * 1_024

interface CachedBuildManifestReader {
  directory: string
  reader: BuildManifestReader
}

let cachedReader: CachedBuildManifestReader | null = null
let cachedDevelopmentReader: NotionDevelopmentContentReader | null = null

export interface BuildContentReader {
  readPageByRoute(route: string): Promise<BuildPage>
  readPageSummaries(): Promise<PageSummariesManifest>
  readCategories(): Promise<CategoriesManifest>
}

export class BuildManifestReader {
  readonly #directory: string
  #buildPlan: Promise<BuildPlan> | null = null
  #pageSummaries: Promise<PageSummariesManifest> | null = null
  #categories: Promise<CategoriesManifest> | null = null

  constructor(directory: string) {
    if (!directory.trim()) {
      throw Error("build manifest directory が指定されていません")
    }
    this.#directory = resolve(directory)
  }

  readBuildPlan(): Promise<BuildPlan> {
    this.#buildPlan ??= this.#readJson(BUILD_MANIFEST_FILES.plan, MAX_INDEX_BYTES).then(
      parseBuildPlan,
    )

    return this.#buildPlan
  }

  async readPageByRoute(route: string): Promise<BuildPage> {
    const plan = await this.readBuildPlan()
    const pageId = plan.pageIdsByRoute[route]
    if (!pageId) {
      throw Error(`${route} は build 対象の記事ではありません`)
    }

    const page = parseBuildPage(
      await this.#readJson(
        join(BUILD_MANIFEST_FILES.articles, `${pageId}.json`),
        MAX_ARTICLE_BYTES,
      ),
    )
    if (page.pageId !== pageId) {
      throw Error(`${route} の page ID が build plan と一致しません`)
    }

    return page
  }

  readPageSummaries(): Promise<PageSummariesManifest> {
    this.#pageSummaries ??= this.#readJson(
      BUILD_MANIFEST_FILES.pageSummaries,
      MAX_INDEX_BYTES,
    ).then(parsePageSummariesManifest)

    return this.#pageSummaries
  }

  readCategories(): Promise<CategoriesManifest> {
    this.#categories ??= this.#readJson(BUILD_MANIFEST_FILES.categories, MAX_INDEX_BYTES).then(
      parseCategoriesManifest,
    )

    return this.#categories
  }

  async #readJson(filename: string, maxBytes: number): Promise<unknown> {
    const path = join(this.#directory, filename)
    const content = await readFile(path)
    if (maxBytes < content.byteLength) {
      throw Error(`${filename} が ${maxBytes} bytes の上限を超えています`)
    }

    try {
      return JSON.parse(content.toString("utf8"))
    } catch (err) {
      throw Error(`${filename} の JSON が壊れています`, { cause: err })
    }
  }
}

export const getBuildContentReader = (): BuildContentReader => {
  const directory = process.env.MIRUMI_BUILD_MANIFEST_DIR
  if (directory) {
    if (!cachedReader || cachedReader.directory !== directory) {
      cachedReader = {
        directory,
        reader: new BuildManifestReader(directory),
      }
    }

    return cachedReader.reader
  }
  if (import.meta.dev) {
    cachedDevelopmentReader ??= new NotionDevelopmentContentReader()

    return cachedDevelopmentReader
  }

  throw Error("production build には MIRUMI_BUILD_MANIFEST_DIR が必要です")
}
