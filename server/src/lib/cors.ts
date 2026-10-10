import type { Context } from "hono"

import type { HonoEnv } from "./types"

// 公開サイトから読む GET の API（Amazon の商品情報、検索）で使う CORS。ローカルの nuxt dev からも叩けるよう、
// dev では loopback の origin も通す。コメントの送信は書き込みなので、handler 側でもっと絞っている

const isDevLoopbackOrigin = (origin: string, appEnv: string | undefined): boolean => {
  if (appEnv !== "dev") {
    return false
  }

  try {
    const url = new URL(origin)
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"])

    return (
      (url.protocol === "http:" || url.protocol === "https:") && loopbackHosts.has(url.hostname)
    )
  } catch {
    return false
  }
}

export const createPublicApiCorsHeaders = (c: Context<HonoEnv>): Record<string, string> | null => {
  const origin = c.req.raw.headers.get("Origin") ?? undefined
  const allowedOrigins = new Set<string>(
    [c.env.FRONTEND_ORIGIN, c.env.WORKERS_API_ORIGIN].filter((value) => value !== undefined),
  )
  if (origin && !allowedOrigins.has(origin) && !isDevLoopbackOrigin(origin, c.env.APP_ENV)) {
    return null
  }

  const headers: Record<string, string> = {
    "Cache-Control": "no-store",
    Vary: "Origin",
  }
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin
  }

  return headers
}
