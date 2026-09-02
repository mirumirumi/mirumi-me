import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

export class DiskStringCache {
  readonly #directory: string

  constructor(directory = resolve(process.cwd(), ".cache/notion-dev")) {
    this.#directory = directory
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.#path(key), "utf8")
    } catch (err) {
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        return null
      }
      throw err
    }
  }

  async put(key: string, value: string): Promise<void> {
    await mkdir(this.#directory, { recursive: true })
    const path = this.#path(key)
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    await writeFile(temporaryPath, value, { encoding: "utf8", mode: 0o600 })
    await rename(temporaryPath, path)
  }

  #path(key: string): string {
    const filename = createHash("sha256").update(key).digest("hex")

    return join(this.#directory, `${filename}.json`)
  }
}
