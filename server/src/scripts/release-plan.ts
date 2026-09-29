import { posix } from "node:path"
import ts from "typescript"

export const GENERATE_REQUESTS = ["auto", "always", "skip"] as const

export type GenerateRequest = (typeof GENERATE_REQUESTS)[number]

export interface CompletedInstance {
  id: string
  createdOn: string
}

export interface GenerateDecisionInput {
  request: GenerateRequest
  baselineSha: string | null
  // 基準点のコミットが手元に無く、差分を取れなかったときは null
  changedFiles: Array<string> | null
  generatePathFiles: ReadonlySet<string>
}

export interface GenerateDecision {
  generate: boolean
  reason: string
  triggers: Array<string>
}

// 同じコミットで workflow_dispatch をやり直しても instance ID が重ならないよう、run ID も含める
const RELEASE_INSTANCE_ID_PATTERN = /^release-([0-9a-f]{40})-\d+(?:-\d+)?$/

// サイトの生成物に効かないとわかっているもの。ここにないファイルは効くものとして扱い、
// 新しいディレクトリが増えても generate する側に倒す
const NON_SITE_PATH_PREFIXES = [
  "docs/",
  ".github/",
  "terraform/",
  "tools/",
  ".agents/",
  ".claude/",
  ".codex/",
  ".vscode/",
]
const NON_SITE_FILES = new Set([
  "AGENTS.md",
  "README.md",
  "LICENSE",
  "biome.json",
  ".gitignore",
  "w-mirumi-me.code-workspace",
])
const SERVER_SOURCE_PREFIX = "server/src/"

export const createReleaseInstanceId = (sha: string, runId: string, attempt: string): string => {
  return `release-${sha}-${runId}-${attempt}`
}

export const parseReleaseSha = (instanceId: string): string | null => {
  return RELEASE_INSTANCE_ID_PATTERN.exec(instanceId)?.[1] ?? null
}

// 手元から流した generate と bootstrap はコミットを持たないので基準点にならない
export const findBaselineSha = (instances: Array<CompletedInstance>): string | null => {
  let latest: { sha: string; createdOn: string } | null = null
  for (const instance of instances) {
    const sha = parseReleaseSha(instance.id)
    if (sha && (!latest || latest.createdOn < instance.createdOn)) {
      latest = { sha, createdOn: instance.createdOn }
    }
  }

  return latest?.sha ?? null
}

const findRuntimeImports = (path: string, source: string): Array<string> => {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false)
  const specifiers: Array<string> = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text)
      }
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text)
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  return specifiers
}

const resolveRelativeImport = (
  from: string,
  specifier: string,
  readSource: (path: string) => string | null,
): string | null => {
  const base = posix.normalize(posix.join(posix.dirname(from), specifier))
  for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
    if (candidate.endsWith(".ts") && readSource(candidate) !== null) {
      return candidate
    }
  }

  return null
}

// generate の経路に乗っているサーバーのコードを、入口から import をたどって集める。
// 型だけの import は実行時に消えるのでたどらない。`shared` や外部パッケージもたどらない
// （`shared` は app も使うので、変わったら丸ごと generate の対象にしている）
export const collectGeneratePathFiles = (
  entrypoints: Array<string>,
  readSource: (path: string) => string | null,
): Set<string> => {
  const collected = new Set<string>()
  const pending = [...entrypoints]
  while (0 < pending.length) {
    const path = pending.pop()
    if (path === undefined || collected.has(path)) {
      continue
    }
    const source = readSource(path)
    if (source === null) {
      throw Error(`generate の経路のファイルが読めません: ${path}`)
    }
    collected.add(path)
    for (const specifier of findRuntimeImports(path, source)) {
      if (!specifier.startsWith(".")) {
        continue
      }
      const resolved = resolveRelativeImport(path, specifier, readSource)
      if (resolved) {
        pending.push(resolved)
      }
    }
  }

  return collected
}

const affectsSite = (path: string, generatePathFiles: ReadonlySet<string>): boolean => {
  if (path.endsWith(".test.ts")) {
    return false
  }
  if (path.startsWith(SERVER_SOURCE_PREFIX) && path.endsWith(".ts")) {
    return generatePathFiles.has(path)
  }

  return (
    !NON_SITE_FILES.has(path) && !NON_SITE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  )
}

export const findGenerateTriggers = (
  changedFiles: Array<string>,
  generatePathFiles: ReadonlySet<string>,
): Array<string> => {
  return changedFiles.filter((path) => affectsSite(path, generatePathFiles))
}

export const decideGenerate = ({
  request,
  baselineSha,
  changedFiles,
  generatePathFiles,
}: GenerateDecisionInput): GenerateDecision => {
  if (request === "always") {
    return { generate: true, reason: "`always` が指定された", triggers: [] }
  }
  if (request === "skip") {
    return { generate: false, reason: "`skip` が指定された", triggers: [] }
  }
  if (!baselineSha) {
    return { generate: true, reason: "完了した generate の記録が見つからない", triggers: [] }
  }
  if (!changedFiles) {
    return {
      generate: true,
      reason: `基準点のコミット ${baselineSha} が履歴に見つからない`,
      triggers: [],
    }
  }
  const triggers = findGenerateTriggers(changedFiles, generatePathFiles)
  if (0 < triggers.length) {
    return {
      generate: true,
      reason: `${baselineSha} からサイトの生成物に効く変更がある`,
      triggers,
    }
  }

  return {
    generate: false,
    reason: `${baselineSha} からサイトの生成物に効く変更がない`,
    triggers: [],
  }
}
