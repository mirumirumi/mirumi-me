import { z } from "zod"

import type { CompletedInstance } from "./release-plan"

const API_ORIGIN = "https://api.cloudflare.com/client/v4"
// retention の範囲の instance を拾いきるための上限。これを超えるのは想定外なので打ち切る
const MAX_LIST_PAGES = 50

const errorsSchema = z.array(z.object({ message: z.string() })).optional()
const instancesPageSchema = z.object({
  success: z.boolean(),
  errors: errorsSchema,
  result: z.array(z.object({ id: z.string(), created_on: z.string() })).nullable(),
  result_info: z.object({ cursor: z.string().optional() }).nullish(),
})
const instanceSchema = z.object({
  success: z.boolean(),
  errors: errorsSchema,
  result: z
    .object({
      status: z.string(),
      error: z.object({ name: z.string(), message: z.string() }).nullish(),
    })
    .nullable(),
})

export interface InstanceState {
  status: string
  error: string | null
}

// wrangler の instance 一覧と詳細は表形式でしか出せないため、CI では API を直接読む
export class CloudflareWorkflowsApi {
  readonly #accountId: string
  readonly #token: string

  constructor(accountId: string, token: string) {
    this.#accountId = accountId
    this.#token = token
  }

  static fromEnv(): CloudflareWorkflowsApi {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
    const token = process.env.CLOUDFLARE_API_TOKEN
    if (!accountId || !token) {
      throw Error("CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が必要です")
    }

    return new CloudflareWorkflowsApi(accountId, token)
  }

  async #get(path: string, params?: URLSearchParams): Promise<unknown> {
    const url = new URL(`${API_ORIGIN}/accounts/${this.#accountId}/workflows/${path}`)
    if (params) {
      url.search = params.toString()
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.#token}` } })

    return response.json()
  }

  async listCompletedInstances(workflow: string): Promise<Array<CompletedInstance>> {
    const instances: Array<CompletedInstance> = []
    let cursor: string | undefined
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const params = new URLSearchParams({ status: "complete" })
      if (cursor) {
        params.set("cursor", cursor)
      }
      const body = instancesPageSchema.parse(await this.#get(`${workflow}/instances`, params))
      if (!body.success || !body.result) {
        throw Error(`instance の一覧を取れませんでした: ${JSON.stringify(body.errors ?? [])}`)
      }
      instances.push(...body.result.map(({ id, created_on }) => ({ id, createdOn: created_on })))
      cursor = body.result_info?.cursor
      if (!cursor || body.result.length === 0) {
        return instances
      }
    }
    throw Error(`instance の一覧が ${MAX_LIST_PAGES} ページを超えました`)
  }

  async readInstance(workflow: string, instanceId: string): Promise<InstanceState> {
    const body = instanceSchema.parse(await this.#get(`${workflow}/instances/${instanceId}`))
    if (!body.success || !body.result) {
      throw Error(`instance の状態を取れませんでした: ${JSON.stringify(body.errors ?? [])}`)
    }
    const { status, error } = body.result

    return { status, error: error ? `${error.name}: ${error.message}` : null }
  }
}
