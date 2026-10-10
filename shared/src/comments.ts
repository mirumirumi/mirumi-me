export const COMMENT_STATES = ["pending", "approved", "spam", "trash"] as const
export type CommentState = (typeof COMMENT_STATES)[number]

export const COMMENT_CONTENT_FORMATS = ["wordpress-html", "plain-text"] as const
export type CommentContentFormat = (typeof COMMENT_CONTENT_FORMATS)[number]

export const COMMENT_SOURCES = ["wordpress", "public-form", "owner"] as const
export type CommentSource = (typeof COMMENT_SOURCES)[number]

// 現行フォームの textarea maxlength と同じ値
export const MAX_COMMENT_CONTENT_LENGTH = 5_555
export const MAX_COMMENT_AUTHOR_NAME_LENGTH = 200
export const MAX_COMMENT_EMAIL_LENGTH = 320
export const ANONYMOUS_AUTHOR_NAME = "匿名"

// 既存コメントは WordPress の decimal ID、新規コメントは Notion の Unique ID に prefix を付けた形。
// 既存の `#comment-123` を壊さず、数字だけの legacy ID とも衝突しない
export const COMMENT_PUBLIC_ID_PREFIX = "c"
const LEGACY_PUBLIC_ID = /^\d{1,12}$/
const UNIQUE_PUBLIC_ID = new RegExp(`^${COMMENT_PUBLIC_ID_PREFIX}-(\\d{1,12})$`)

// 公開 HTML / payload に載せる最小の形。メールや状態は絶対に含めない
export interface BuildComment {
  id: string
  parentId: string | null
  authorName: string
  createdAt: string
  contentHtml: string
  isOwner: boolean
}

// Notion row を正規化した内部表現。メールアドレスは読まないので型にも持たない
export interface CommentRecord {
  pageId: string
  slug: string
  parentPageId: string | null
  authorName: string
  content: string
  contentFormat: CommentContentFormat
  createdAt: string
  state: CommentState | null
  isOwner: boolean
  source: CommentSource | null
  legacyCommentId: number | null
  uniqueId: number | null
  requestId: string | null
  notifiedAt: string | null
  refreshError: string | null
  lastEditedTime: string
}

export interface ParsedCommentPublicId {
  kind: "legacy" | "unique"
  number: number
}

export const parseCommentPublicId = (value: string): ParsedCommentPublicId | null => {
  if (LEGACY_PUBLIC_ID.test(value)) {
    return { kind: "legacy", number: Number.parseInt(value, 10) }
  }
  const unique = value.match(UNIQUE_PUBLIC_ID)?.[1]
  if (unique) {
    return { kind: "unique", number: Number.parseInt(unique, 10) }
  }

  return null
}

export const isCommentPublicId = (value: string): boolean => {
  return parseCommentPublicId(value) !== null
}

export const resolveCommentPublicId = (
  record: Pick<CommentRecord, "legacyCommentId" | "uniqueId">,
): string | null => {
  if (record.legacyCommentId !== null) {
    return String(record.legacyCommentId)
  }
  if (record.uniqueId !== null) {
    return `${COMMENT_PUBLIC_ID_PREFIX}-${record.uniqueId}`
  }

  return null
}

const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

// 旧 CommentBase.vue の formatContent() をそのまま移した。段落・改行・裸 URL の linkify の
// 挙動を現行表示と一致させるため、正規表現は変えない
const wrapParagraphsAndLinkify = (content: string): string => {
  return (
    content
      // https://regex101.com/r/DWX3oZ/1
      .replace(/(([^\r\n]+(\r?\n)?)+)/gim, "<p>$1</p>")
      // https://regex101.com/r/lUK6Rc/1
      .replaceAll(/\r?\n([^<])/gim, "<br />$1")
      // https://regex101.com/r/bjsDHH/1
      .replaceAll(
        /((<p>)|<br \/>)?(https?:\/\/[\w/:;%#$&?()~.=+-]+)(\r?\n)?((<\/p>)|<br \/>)/gim,
        '$1<a href="$3" rel="nofollow ugc">$3</a>$5',
      )
  )
}

// 実データ（2026-09-21 時点で 52 件）に現れる tag と、上の整形が生む tag だけを許す。
// 属性を持てるのは a だけで、その href も http(s) とサイト内の絶対 path に限る
const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "i",
  "li",
  "ol",
  "p",
  "rp",
  "rt",
  "ruby",
  "s",
  "strong",
  "ul",
])
const VOID_TAGS = new Set(["br"])
const TAG_TOKEN = /<[^>]*>|[^<]+|</g
const TAG_SHAPE = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)\/?>$/
const ATTRIBUTE = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
const ENTITY = /&(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g

const escapeText = (value: string): string => {
  // 既存コメントは WordPress が `&gt;` などを entity で保存しているので、正しい entity は残す
  return value
    .replaceAll(/&(?!(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});)/g, "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
}

const decodeEntities = (value: string): string => {
  return value.replaceAll(ENTITY, (entity) => {
    if (entity === "&amp;") {
      return "&"
    }
    if (entity === "&lt;") {
      return "<"
    }
    if (entity === "&gt;") {
      return ">"
    }
    if (entity === "&quot;") {
      return '"'
    }
    if (entity === "&#39;" || entity === "&apos;") {
      return "'"
    }

    return entity
  })
}

export const resolveSafeCommentHref = (value: string): string | null => {
  const decoded = decodeEntities(value).trim()
  // `//host` と `/\host` はブラウザが外部 origin として解決するので、サイト内の絶対 path とみなさない
  if (decoded.startsWith("/") && !/^\/[/\\]/.test(decoded)) {
    return decoded
  }
  try {
    const url = new URL(decoded)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }

    return url.href
  } catch {
    return null
  }
}

const parseAttributes = (source: string): Record<string, string> => {
  const attributes: Record<string, string> = {}
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase()
    if (name) {
      attributes[name] = match[2] ?? match[3] ?? match[4] ?? ""
    }
  }

  return attributes
}

const renderAnchorOpenTag = (attributes: Record<string, string>): string | null => {
  const href = attributes.href === undefined ? null : resolveSafeCommentHref(attributes.href)
  if (!href) {
    return null
  }
  const external = attributes.target?.toLowerCase() === "_blank"
  const rel = external ? "nofollow ugc noopener" : "nofollow ugc"
  const target = external ? ' target="_blank"' : ""

  return `<a href="${escapeHtml(href)}" rel="${rel}"${target}>`
}

// 許可した tag だけを残し、閉じ忘れや対応しない閉じ tag を直して well-formed にする
export const sanitizeCommentHtml = (html: string): string => {
  const output: Array<string> = []
  // 落とした開始 tag の閉じ tag も落とすため、出力した tag かどうかも積む
  const open: Array<{ name: string; emitted: boolean }> = []
  for (const token of html.match(TAG_TOKEN) ?? []) {
    const shape = token.match(TAG_SHAPE)
    if (!shape) {
      output.push(escapeText(token))
      continue
    }
    const closing = shape[1] === "/"
    const name = shape[2]!.toLowerCase()
    if (!ALLOWED_TAGS.has(name)) {
      continue
    }
    if (VOID_TAGS.has(name)) {
      if (!closing) {
        output.push(`<${name}>`)
      }
      continue
    }
    if (closing) {
      const index = open.findLastIndex((entry) => entry.name === name)
      if (index < 0) {
        continue
      }
      for (const entry of open.splice(index).toReversed()) {
        if (entry.emitted) {
          output.push(`</${entry.name}>`)
        }
      }
      continue
    }
    const openTag =
      name === "a" ? renderAnchorOpenTag(parseAttributes(shape[3] ?? "")) : `<${name}>`
    if (openTag) {
      output.push(openTag)
    }
    open.push({ name, emitted: openTag !== null })
  }
  for (const entry of open.toReversed()) {
    if (entry.emitted) {
      output.push(`</${entry.name}>`)
    }
  }

  return output.join("")
}

export const formatCommentContent = (content: string, format: CommentContentFormat): string => {
  const source = format === "plain-text" ? escapeHtml(content) : content

  return sanitizeCommentHtml(wrapParagraphsAndLinkify(source))
}

const comparePublicIds = (left: string, right: string): number => {
  const leftId = parseCommentPublicId(left)
  const rightId = parseCommentPublicId(right)
  if (!leftId || !rightId) {
    return left.localeCompare(right)
  }
  if (leftId.kind !== rightId.kind) {
    return leftId.kind === "legacy" ? -1 : 1
  }

  return leftId.number - rightId.number
}

export const compareBuildComments = (
  left: Pick<BuildComment, "id" | "createdAt">,
  right: Pick<BuildComment, "id" | "createdAt">,
): number => {
  const dateOrder = Date.parse(left.createdAt) - Date.parse(right.createdAt)

  return dateOrder === 0 ? comparePublicIds(left.id, right.id) : dateOrder
}

export class InvalidCommentRecordError extends Error {}

// 1 記事ぶんの row（状態を問わない）から公開用の一覧を作る。描画するのは approved だけで、
// それ以外の row は「非表示になった親の代わりに、最も近い表示中の先祖へつなぎ直す」ためにだけ使う。
// 削除済みなどで辿れない親は root へ繰り上げる（親 1 件だけを消したいときに子まで道連れにしない）
export const createBuildComments = (
  records: Array<CommentRecord>,
  slug: string,
): Array<BuildComment> => {
  const recordByPageId = new Map<string, CommentRecord>()
  for (const record of records) {
    if (record.slug !== slug) {
      throw new InvalidCommentRecordError(
        `別の記事のコメントが混ざっています: ${record.pageId} (${record.slug})`,
      )
    }
    if (recordByPageId.has(record.pageId)) {
      throw new InvalidCommentRecordError(`同じコメントが重複しています: ${record.pageId}`)
    }
    recordByPageId.set(record.pageId, record)
  }
  const approved = records.filter((record) => {
    if (record.state !== "approved") {
      return false
    }
    // 承認済みでも本文が空なら描画しない（返信を書く前に承認しても空の吹き出しを出さない）。
    // 子は非表示の親と同じく、表示中の先祖へつなぎ直される
    if (record.content.trim() === "") {
      console.warn(JSON.stringify({ event: "comment_content_empty", pageId: record.pageId, slug }))

      return false
    }

    return true
  })
  const publicIdByPageId = new Map<string, string>()
  for (const record of approved) {
    const publicId = resolveCommentPublicId(record)
    if (!publicId) {
      throw new InvalidCommentRecordError(
        `コメント ID がありません。comments の Unique ID プロパティを確認してください: ${record.pageId}`,
      )
    }
    publicIdByPageId.set(record.pageId, publicId)
  }
  if (new Set(publicIdByPageId.values()).size !== publicIdByPageId.size) {
    throw new InvalidCommentRecordError(`コメント ID が重複しています: ${slug}`)
  }

  const resolveVisibleParentId = (record: CommentRecord): string | null => {
    const visited = new Set<string>()
    let parentPageId = record.parentPageId
    while (parentPageId) {
      if (visited.has(parentPageId)) {
        throw new InvalidCommentRecordError(
          `親コメントが循環しています: ${record.pageId} (${slug})`,
        )
      }
      visited.add(parentPageId)
      const visible = publicIdByPageId.get(parentPageId)
      if (visible) {
        return visible
      }
      const parent = recordByPageId.get(parentPageId)
      if (!parent) {
        console.warn(
          JSON.stringify({ event: "comment_parent_missing", pageId: record.pageId, slug }),
        )

        return null
      }
      parentPageId = parent.parentPageId
    }

    return null
  }

  const comments = approved.map((record): BuildComment => {
    return {
      id: publicIdByPageId.get(record.pageId)!,
      parentId: resolveVisibleParentId(record),
      authorName: record.authorName.trim() || ANONYMOUS_AUTHOR_NAME,
      createdAt: record.createdAt,
      contentHtml: formatCommentContent(record.content, record.contentFormat),
      isOwner: record.isOwner,
    }
  })
  const ordered = comments.toSorted(compareBuildComments)
  // 親が子より後ろに並ぶと frontend の tree 構築で親未定義になる
  const seen = new Set<string>()
  for (const comment of ordered) {
    if (comment.parentId && !seen.has(comment.parentId)) {
      throw new InvalidCommentRecordError(
        `親コメントが子より後に投稿されています: ${comment.id} (${slug})`,
      )
    }
    seen.add(comment.id)
  }

  return ordered
}

// slug が空の row（Notion UI で親から作った owner reply）は親をたどって最初の slug を継ぐ。
// 親が無い・辿れない・循環している row は空のまま返す（どの記事にも出ないので warn だけ残す）
export const inheritCommentSlugs = (records: Array<CommentRecord>): Array<CommentRecord> => {
  const recordByPageId = new Map(records.map((record) => [record.pageId, record]))
  const resolveSlug = (record: CommentRecord): string => {
    const visited = new Set<string>()
    let current: CommentRecord | undefined = record
    while (current && !current.slug) {
      if (visited.has(current.pageId)) {
        return ""
      }
      visited.add(current.pageId)
      current = current.parentPageId ? recordByPageId.get(current.parentPageId) : undefined
    }

    return current?.slug ?? ""
  }

  return records.map((record) => {
    if (record.slug) {
      return record
    }
    const slug = resolveSlug(record)
    if (!slug) {
      console.warn(JSON.stringify({ event: "comment_slug_unresolved", pageId: record.pageId }))

      return record
    }

    return { ...record, slug }
  })
}

export const groupCommentRecordsBySlug = (
  records: Array<CommentRecord>,
): Map<string, Array<CommentRecord>> => {
  const groups = new Map<string, Array<CommentRecord>>()
  for (const record of records) {
    const group = groups.get(record.slug) ?? []
    group.push(record)
    groups.set(record.slug, group)
  }

  return groups
}

// Notion の text.content は 1 object 2,000 文字まで。5,555 文字の本文は最大 3 object に分ける
export const NOTION_RICH_TEXT_CHUNK_LENGTH = 2_000

export const splitNotionRichTextContent = (content: string): Array<string> => {
  const chunks: Array<string> = []
  let current = ""
  // Notion の数え方が code unit でも収まるよう UTF-16 長で区切り、サロゲートペアの途中では切らない
  for (const character of content) {
    if (NOTION_RICH_TEXT_CHUNK_LENGTH < current.length + character.length) {
      chunks.push(current)
      current = ""
    }
    current += character
  }
  if (current.length !== 0) {
    chunks.push(current)
  }

  return chunks
}

// 改行コードは LF に揃える。Notion が CR を保持するか不明なため、hash 比較の前提も LF にする
export const normalizeCommentContent = (content: string): string => {
  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
}
