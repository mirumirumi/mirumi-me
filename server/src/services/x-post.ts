import { z } from "zod"

import type { FetchXPost } from "shared/x-post"
import { parseStaticXPostData } from "shared/x-post"

const xaiOutputSchema = z.strictObject({
  text: z.string().min(1).max(20_000),
  authorName: z.string().min(1).max(300),
  authorHandle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  createdAt: z.string().nullable(),
})
const xaiResponseSchema = z.object({
  citations: z.array(z.url()).optional(),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
})

const isXHostname = (hostname: string): boolean => {
  return (
    hostname === "x.com" ||
    hostname.endsWith(".x.com") ||
    hostname === "twitter.com" ||
    hostname.endsWith(".twitter.com")
  )
}

const isExactXPostCitation = (value: string, postId: string): boolean => {
  try {
    const url = new URL(value)
    const segments = url.pathname.split("/").filter(Boolean)

    return (
      isXHostname(url.hostname) &&
      segments.some((segment, index) => segment === "status" && segments[index + 1] === postId)
    )
  } catch {
    return false
  }
}

export const createXaiPostFetcher = (apiKey: string, model: string): FetchXPost => {
  return async (postId) => {
    const response = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        include: ["no_inline_citations"],
        input: [
          {
            role: "user",
            content: `X Search で post ID ${postId} の投稿を 1 件だけ取得し、原文と投稿者を返してください。推測や要約はしないでください。`,
          },
        ],
        tools: [{ type: "x_search" }],
        text: {
          format: {
            type: "json_schema",
            name: "x_post",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["text", "authorName", "authorHandle", "createdAt"],
              properties: {
                text: { type: "string" },
                authorName: { type: "string" },
                authorHandle: { type: "string" },
                createdAt: { anyOf: [{ type: "string" }, { type: "null" }] },
              },
            },
          },
        },
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw Error(`xAI API が失敗しました: ${response.status}`)
    }
    const parsedResponse = xaiResponseSchema.parse(await response.json())
    const hasExactCitation = parsedResponse.citations?.some((value) =>
      isExactXPostCitation(value, postId),
    )
    if (!hasExactCitation) {
      throw Error("xAI API に対象 X post の citation がありません")
    }
    const outputText = parsedResponse.output
      .flatMap(({ content }) => content ?? [])
      .find(({ type }) => type === "output_text")?.text
    if (!outputText) {
      throw Error("xAI API に output_text がありません")
    }
    const output = xaiOutputSchema.parse(JSON.parse(outputText))
    const createdAt =
      output.createdAt && !Number.isNaN(Date.parse(output.createdAt)) ? output.createdAt : null

    return parseStaticXPostData({
      postId,
      url: `https://x.com/${output.authorHandle}/status/${postId}`,
      text: output.text,
      authorName: output.authorName,
      authorHandle: output.authorHandle,
      createdAt,
    })
  }
}
