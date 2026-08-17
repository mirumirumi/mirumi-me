import { readFile } from "node:fs/promises"

import type { WordPressContentRecord } from "./types"

export const readContents = async (path: string): Promise<Array<WordPressContentRecord>> => {
  const contents = await readFile(path, "utf8")
  const records: Array<WordPressContentRecord> = []

  for (const [index, line] of contents.trimEnd().split("\n").entries()) {
    if (!line.trim()) {
      continue
    }

    try {
      records.push(JSON.parse(line) as WordPressContentRecord)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw Error(`${index + 1} 行目の JSON が不正です: ${message}`)
    }
  }

  return records
}
