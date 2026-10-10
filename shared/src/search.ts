import { z } from "zod"

// 検索の索引と、語の照合・並び。索引は Container が公開のたびに作り、Worker が読んで検索に使う。
// フロントは検索結果の形（SearchResponse）だけを使う

// Container が公開のたびに書き、Worker が読む。`_internal/*` なので CloudFront からは見えない
export const SEARCH_INDEX_KEY = "_internal/search-index-v1.json"
export const SEARCH_PER_PAGE = 13
// 本文の出現 1 回を 1 点、タイトルの出現 1 回をこの点にする。WordPress はタイトルに含まれる記事を
// 優先しすぎていたので、その話題を詳しく書いた記事が上に来るよう、タイトルは少しだけ重くするにとどめる
const TITLE_WEIGHT = 3
const MAX_QUERY_TERMS = 10

export interface SearchIndexPost {
  pageId: string
  slug: string
  title: string
  publishedAt: string
  updatedAt: string | null
  // normalizeSearchText でそろえた本文の平文
  text: string
}

export interface SearchIndex {
  schemaVersion: 1
  updatedAt: string
  posts: Array<SearchIndexPost>
}

export interface SearchResultPost {
  slug: string
  title: string
  publishedAt: string
  updatedAt: string | null
}

export interface SearchResponse {
  total: number
  pages: number
  posts: Array<SearchResultPost>
}

const dateTimeSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
const searchIndexSchema: z.ZodType<SearchIndex> = z.strictObject({
  schemaVersion: z.literal(1),
  updatedAt: dateTimeSchema,
  posts: z.array(
    z.strictObject({
      pageId: z.guid(),
      slug: z.string().min(1),
      title: z.string(),
      publishedAt: dateTimeSchema,
      updatedAt: dateTimeSchema.nullable(),
      text: z.string(),
    }),
  ),
})

export const parseSearchIndex = (value: unknown): SearchIndex => {
  const result = searchIndexSchema.safeParse(value)
  if (!result.success) {
    throw Error("検索の索引の schema が不正です", { cause: result.error })
  }

  return result.data
}

export interface PreparedSearchPost extends SearchIndexPost {
  titleKey: string
}

// 全角の英数字や空白は NFKC で半角に、英字は小文字にそろえる。形態素解析や表記ゆれの吸収はしない
export const normalizeSearchText = (value: string): string => {
  return value.normalize("NFKC").toLowerCase().replaceAll(/\s+/g, " ").trim()
}

export const parseSearchQuery = (query: string): Array<string> => {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean)

  return [...new Set(terms)].slice(0, MAX_QUERY_TERMS)
}

// 索引を読んだときに 1 回だけタイトルをそろえておき、検索のたびにやり直さない
export const prepareSearchPosts = (posts: Array<SearchIndexPost>): Array<PreparedSearchPost> => {
  return posts.map((post) => ({ ...post, titleKey: normalizeSearchText(post.title) }))
}

const countOccurrences = (haystack: string, needle: string): number => {
  let count = 0
  let index = haystack.indexOf(needle)
  while (0 <= index) {
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }

  return count
}

const scorePost = (post: PreparedSearchPost, terms: Array<string>): number => {
  let score = 0
  for (const term of terms) {
    const termScore =
      countOccurrences(post.text, term) + TITLE_WEIGHT * countOccurrences(post.titleKey, term)
    // すべての語を含む記事だけを返す（WordPress の検索と同じ AND）
    if (termScore === 0) {
      return 0
    }
    score += termScore
  }

  return score
}

export const searchPosts = (
  posts: Array<PreparedSearchPost>,
  terms: Array<string>,
  page: number,
): SearchResponse => {
  if (terms.length === 0) {
    return { total: 0, pages: 0, posts: [] }
  }
  const matched = posts
    .map((post) => ({ post, score: scorePost(post, terms) }))
    .filter(({ score }) => 0 < score)
    .toSorted((a, b) => {
      return (
        b.score - a.score ||
        Date.parse(b.post.publishedAt) - Date.parse(a.post.publishedAt) ||
        a.post.slug.localeCompare(b.post.slug)
      )
    })
  const start = (page - 1) * SEARCH_PER_PAGE

  return {
    total: matched.length,
    pages: Math.ceil(matched.length / SEARCH_PER_PAGE),
    posts: matched.slice(start, start + SEARCH_PER_PAGE).map(({ post }) => ({
      slug: post.slug,
      title: post.title,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
    })),
  }
}
