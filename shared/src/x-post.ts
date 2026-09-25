import { z } from "zod"

const POST_ID = /^\d{5,30}$/
const linkCardSchema = z.strictObject({
  url: z.url(),
  title: z.string().min(1).max(300),
  description: z.string().max(1_000).nullable(),
  imageUrl: z.url().nullable(),
})
const staticXPostSchema = z.strictObject({
  postId: z.string().regex(POST_ID),
  url: z.url(),
  text: z.string().min(1).max(20_000),
  authorName: z.string().min(1).max(300),
  authorHandle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/),
  avatarUrl: z.url().nullable(),
  mediaUrls: z.array(z.url()).max(4),
  replyCount: z.number().int().nonnegative().nullable(),
  repostCount: z.number().int().nonnegative().nullable(),
  likeCount: z.number().int().nonnegative().nullable(),
  linkCard: linkCardSchema.nullable(),
  createdAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)))
    .nullable(),
})
// 取得項目とリンクカードの埋め方を変えたので、旧 entry を読まないよう version を上げる
const cacheSchema = z.strictObject({
  version: z.literal(4),
  fetchedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  post: staticXPostSchema,
})

export interface StaticXPostLinkCard {
  url: string
  title: string
  description: string | null
  imageUrl: string | null
}

export interface StaticXPostData {
  postId: string
  url: string
  text: string
  authorName: string
  authorHandle: string
  avatarUrl: string | null
  mediaUrls: Array<string>
  replyCount: number | null
  repostCount: number | null
  likeCount: number | null
  linkCard: StaticXPostLinkCard | null
  createdAt: string | null
}

export interface XPostCache {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>
}

export type FetchXPost = (postId: string) => Promise<StaticXPostData>

// 投稿内のリンクの OGP。モデルは card を返してくれないので、外部 bookmark と同じ経路で自前取得する
export type ResolveXPostLinkCard = (url: string) => Promise<StaticXPostLinkCard | null>

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

// 本文中の URL。末尾の句読点は URL に含めない
export const X_POST_URL_PATTERN = /https?:\/\/[^\s<>"']*[^\s<>"'.,)]/g

export interface XPostLinkMatch {
  // 本文に書かれているままの文字列。表示の加工や末尾からの除去に使う
  raw: string
  href: string
}

// 引用ポストは card にしない。X 内リンク以外の最初の URL だけを対象にする
export const findXPostLinkMatch = (text: string): XPostLinkMatch | null => {
  for (const match of text.matchAll(X_POST_URL_PATTERN)) {
    try {
      const url = new URL(match[0])
      if (!isXHostname(url.hostname)) {
        return { raw: match[0], href: url.href }
      }
    } catch {}
  }

  return null
}

export const extractXPostLinkUrl = (text: string): string | null => {
  return findXPostLinkMatch(text)?.href ?? null
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
  resolveLinkCard: ResolveXPostLinkCard | null = null,
  now = new Date().toISOString(),
): Promise<StaticXPostData> => {
  if (!POST_ID.test(postId)) {
    throw Error("X post ID が不正です")
  }
  const key = `x-post:v4:${postId}`
  let cachedValue: string | null = null
  try {
    cachedValue = await cache.get(key)
  } catch {}
  const cached = parseCached(cachedValue)
  if (cached) {
    return cached.post
  }

  const fetched = parseStaticXPostData(await fetchPost(postId))
  if (fetched.postId !== postId) {
    throw Error("X post resolver が別の X post を返しました")
  }
  // 公式の X と同じく、添付画像があるときは card を出さず画像を優先する
  const linkUrl =
    resolveLinkCard && fetched.mediaUrls.length === 0 ? extractXPostLinkUrl(fetched.text) : null
  // card が取れなくても投稿自体は出す
  const post: StaticXPostData = {
    ...fetched,
    linkCard: linkUrl && resolveLinkCard ? await resolveLinkCard(linkUrl).catch(() => null) : null,
  }
  try {
    await cache.put(key, JSON.stringify({ version: 4, fetchedAt: now, post }), {
      expirationTtl: 365 * 24 * 60 * 60,
    })
  } catch {}

  return post
}
