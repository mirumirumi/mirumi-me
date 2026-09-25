import { z } from "zod"

import type { BookmarkCache } from "shared/bookmark"
import { resolveExternalBookmark } from "shared/bookmark"
import type { FetchXPost, ResolveXPostLinkCard } from "shared/x-post"
import { parseStaticXPostData } from "shared/x-post"

const xaiOutputSchema = z.strictObject({
  text: z.string().min(1).max(20_000),
  authorName: z.string().min(1).max(300),
  // モデルは `@__mirumi__` のように @ 付きで返すことがある
  authorHandle: z.string().regex(/^@?[A-Za-z0-9_]{1,15}$/),
  url: z.string(),
  createdAt: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  mediaUrls: z.array(z.string()),
  replyCount: z.number().nullable(),
  repostCount: z.number().nullable(),
  likeCount: z.number().nullable(),
})
// 構造化出力を使うと citations は返らない（実測で null、`no_inline_citations` の有無に関係なし）。
// 代わりに X Search が実際に走ったかを usage で確かめる
const xaiResponseSchema = z.object({
  usage: z
    .object({
      server_side_tool_usage_details: z
        .object({
          x_search_calls: z.number().optional(),
          x_posts_fetched: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
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

// アイコンと添付画像は X の media host のものだけ採用する。モデルが URL を組み立てて
// しまったときに、実在しない画像や無関係なホストを本文に出さないため
const X_MEDIA_HOSTNAMES = new Set(["pbs.twimg.com", "video.twimg.com"])

const safeHttpsUrl = (value: string | null, hostnames?: ReadonlySet<string>): string | null => {
  if (!value) {
    return null
  }
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || (hostnames && !hostnames.has(url.hostname))) {
      return null
    }

    return url.href
  } catch {
    return null
  }
}

const safeCount = (value: number | null): number | null => {
  return value !== null && Number.isInteger(value) && 0 <= value ? value : null
}

const isXHostname = (hostname: string): boolean => {
  return (
    hostname === "x.com" ||
    hostname.endsWith(".x.com") ||
    hostname === "twitter.com" ||
    hostname.endsWith(".twitter.com")
  )
}

const isExactXPostUrl = (value: string, postId: string): boolean => {
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

const requestXaiPost = async (apiKey: string, model: string, postId: string): Promise<unknown> => {
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
          content: [
            `X Search で post ID ${postId} の投稿を 1 件だけ取得してください。推測や要約はしないでください。`,
            "- text: 投稿の原文",
            "- authorName / authorHandle: 投稿者の表示名とハンドル",
            "- url: 取得した投稿そのものの URL",
            "- createdAt: 投稿日時",
            "- avatarUrl: 投稿者のアイコン画像 URL",
            "- mediaUrls: 投稿に添付された画像の URL（無ければ空配列）",
            "- replyCount / repostCount / likeCount: 返信・リポスト・いいねの数",
            "画像の URL は取得結果に実在するものだけを使い、自分で組み立てないでください。",
            "分からない項目は null にし、投稿自体を取得できなかったときだけ text を空文字にしてください。",
          ].join("\n"),
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
            required: [
              "text",
              "authorName",
              "authorHandle",
              "url",
              "createdAt",
              "avatarUrl",
              "mediaUrls",
              "replyCount",
              "repostCount",
              "likeCount",
            ],
            properties: {
              text: { type: "string" },
              authorName: { type: "string" },
              authorHandle: { type: "string" },
              url: { type: "string" },
              createdAt: { anyOf: [{ type: "string" }, { type: "null" }] },
              avatarUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
              mediaUrls: { type: "array", items: { type: "string" } },
              replyCount: { anyOf: [{ type: "number" }, { type: "null" }] },
              repostCount: { anyOf: [{ type: "number" }, { type: "null" }] },
              likeCount: { anyOf: [{ type: "number" }, { type: "null" }] },
            },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) {
    // status だけでは model 違いと権限違いを切り分けられないので、xAI の応答も短く添える
    const detail = (await response.text().catch(() => "")).slice(0, 300)
    throw Error(`xAI API が失敗しました: ${response.status}${detail ? ` (${detail})` : ""}`)
  }

  return response.json()
}

export const createXaiPostFetcher = (apiKey: string, model: string): FetchXPost => {
  return async (postId) => {
    const parsedResponse = xaiResponseSchema.parse(await requestXaiPost(apiKey, model, postId))
    const toolUsage = parsedResponse.usage?.server_side_tool_usage_details
    if (!toolUsage?.x_search_calls || !toolUsage.x_posts_fetched) {
      // 記憶から答えた結果を本文として出さないよう、実際に X を引いたことを必須にする
      throw Error("xAI API が X Search を実行していません")
    }
    const outputText = parsedResponse.output
      .flatMap(({ content }) => content ?? [])
      .find(({ type }) => type === "output_text")?.text
    if (!outputText) {
      throw Error("xAI API に output_text がありません")
    }
    const output = xaiOutputSchema.parse(JSON.parse(outputText))
    if (!isExactXPostUrl(output.url, postId)) {
      throw Error(`xAI API が別の X post を返しました: ${output.url}`)
    }
    const authorHandle = output.authorHandle.replace(/^@/, "")
    const createdAt =
      output.createdAt && !Number.isNaN(Date.parse(output.createdAt)) ? output.createdAt : null

    return parseStaticXPostData({
      postId,
      url: `https://x.com/${authorHandle}/status/${postId}`,
      text: output.text,
      authorName: output.authorName,
      authorHandle,
      avatarUrl: safeHttpsUrl(output.avatarUrl, X_MEDIA_HOSTNAMES),
      mediaUrls: output.mediaUrls
        .map((value) => safeHttpsUrl(value, X_MEDIA_HOSTNAMES))
        .filter((value): value is string => value !== null)
        .slice(0, 4),
      replyCount: safeCount(output.replyCount),
      repostCount: safeCount(output.repostCount),
      likeCount: safeCount(output.likeCount),
      // 投稿に含まれるリンクの OGP は resolveXPost 側で自前取得して埋める
      linkCard: null,
      createdAt,
    })
  }
}

// 投稿内リンクの card は外部ブログカードと同じ OGP 取得を使い回す（KV cache も共通）
export const createXPostLinkCardResolver = (cache: BookmarkCache): ResolveXPostLinkCard => {
  return async (url) => {
    const card = await resolveExternalBookmark(url, cache)
    // 取得に失敗した card は host 名だけが残る。リンク切れの t.co をそのまま出さないよう捨てる
    if (!card.description && !card.imageUrl && card.title === new URL(card.url).hostname) {
      return null
    }

    return {
      url: card.url,
      title: card.title,
      description: card.description,
      imageUrl: card.imageUrl,
    }
  }
}
