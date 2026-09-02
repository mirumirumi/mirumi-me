import { z } from "zod"

const POST_ID = /^\d{5,30}$/
const staticXPostSchema = z.strictObject({
  postId: z.string().regex(POST_ID),
  url: z.url(),
  text: z.string().min(1).max(20_000),
  authorName: z.string().min(1).max(300),
  authorHandle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  createdAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)))
    .nullable(),
})
const cacheSchema = z.strictObject({
  version: z.literal(1),
  fetchedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  post: staticXPostSchema,
})

export interface StaticXPostData {
  postId: string
  url: string
  text: string
  authorName: string
  authorHandle: string
  createdAt: string | null
}

export interface XPostCache {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>
}

export type FetchXPost = (postId: string) => Promise<StaticXPostData>

const isXHostname = (hostname: string): boolean => {
  return (
    hostname === "x.com" ||
    hostname.endsWith(".x.com") ||
    hostname === "twitter.com" ||
    hostname.endsWith(".twitter.com")
  )
}

export const extractXPostId = (value: string): string | null => {
  try {
    const url = new URL(value)
    if (!isXHostname(url.hostname)) {
      return null
    }
    const postId = url.pathname.match(/\/status\/(\d+)/)?.[1] ?? null

    return postId && POST_ID.test(postId) ? postId : null
  } catch {
    return null
  }
}

export const parseStaticXPostData = (value: unknown): StaticXPostData => {
  return staticXPostSchema.parse(value)
}

const parseCached = (value: string | null) => {
  if (!value) {
    return null
  }
  try {
    return cacheSchema.parse(JSON.parse(value))
  } catch {
    return null
  }
}

export const resolveXPost = async (
  postId: string,
  cache: XPostCache,
  fetchPost: FetchXPost,
  now = new Date().toISOString(),
): Promise<StaticXPostData> => {
  if (!POST_ID.test(postId)) {
    throw Error("X post ID が不正です")
  }
  const key = `x-post:v1:${postId}`
  let cachedValue: string | null = null
  try {
    cachedValue = await cache.get(key)
  } catch {}
  const cached = parseCached(cachedValue)
  if (cached) {
    return cached.post
  }

  const post = parseStaticXPostData(await fetchPost(postId))
  if (post.postId !== postId) {
    throw Error("X post resolver が別の X post を返しました")
  }
  try {
    await cache.put(key, JSON.stringify({ version: 1, fetchedAt: now, post }), {
      expirationTtl: 365 * 24 * 60 * 60,
    })
  } catch {}

  return post
}
