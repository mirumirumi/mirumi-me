// - 2026-08-18、実際に 2 記事だけ投入して以下を実証済み✅（主に AI が読む用）
//     - 169 行のテーブルは 100 行で作ってから残り 69 行を `blocks.children.append` で足せる（`table_width` 確定後の行追加は通る）
//     - embed の URL は `x.com` でも `twitter.com` でも通るので、どちらかに正規化する必要はない
//     - 100 件ごとのバッチ分割と、children を 2 段ネストさせた投入も通る
//     - 確認に使った記事は big-car-navi-compatible-model（169 行テーブル）と android-app（473 ブロック / 5 リクエスト / x.com 埋め込み 3 件）

import { createHash } from "node:crypto"
import type { BlockObjectRequest, CreatePageParameters } from "@notionhq/client"
import { HTMLElement, Node, NodeType, parse } from "node-html-parser"

import { canonicalizeAmazonShortcode } from "shared/amazon"
import { BODY_CONTENT_WIDTH } from "shared/media"

import { CATEGORY_PAGE_IDS, PAGES_DATA_SOURCE_ID, POSTS_DATA_SOURCE_ID } from "./config"
import type { MediaMigrationResolver } from "./media-mapping"
import type {
  MigrationWarning,
  MigrationWarningCode,
  NotionPageInput,
  WordPressContentRecord,
} from "./types"

type PageProperties = NonNullable<CreatePageParameters["properties"]>
type CodeBlockRequest = Extract<BlockObjectRequest, { code: unknown }>
type CodeLanguage = CodeBlockRequest["code"]["language"]
type RichTextItemRequest = Extract<
  BlockObjectRequest,
  { paragraph: unknown }
>["paragraph"]["rich_text"][number]
type RichTextAnnotations = NonNullable<RichTextItemRequest["annotations"]>

interface ConversionContext {
  // 相対リンクや記事内アンカーを絶対 URL にするための基準
  articleUrl: string
  customCss: Array<string>
  warnings: Array<MigrationWarning>
  media: MediaMigrationResolver
}

interface InlineState {
  annotations: RichTextAnnotations
  link: string | null
}

const DEFAULT_INLINE_STATE: InlineState = {
  annotations: {},
  link: null,
}

const CODE_LANGUAGES = new Set<CodeLanguage>([
  "bash",
  "c",
  "c#",
  "c++",
  "css",
  "diff",
  "docker",
  "html",
  "java",
  "javascript",
  "json",
  "markdown",
  "php",
  "plain text",
  "powershell",
  "python",
  "ruby",
  "rust",
  "scss",
  "shell",
  "sql",
  "typescript",
  "vb.net",
  "visual basic",
  "xml",
  "yaml",
])

const INLINE_TAGS = new Set([
  "a",
  "b",
  "br",
  "code",
  "del",
  "em",
  "i",
  "img",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
])

const normalizeSource = (value: string): string => {
  return value.replaceAll(/\s+/g, " ").trim().slice(0, 300)
}

const warn = (
  context: ConversionContext,
  code: MigrationWarningCode,
  message: string,
  source: string,
) => {
  context.warnings.push({ code, message, source: normalizeSource(source) })
}

const safeUrl = (value: string, context: ConversionContext, source: string): string | null => {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value, context.articleUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw TypeError("HTTP URL ではありません")
    }
    if (
      ["milmemo.net", "mirumi.in", "mirumi.me", "www.milmemo.net", "www.mirumi.in"].includes(
        url.hostname,
      ) &&
      url.pathname.startsWith("/wp-content/uploads/")
    ) {
      url.protocol = "https:"
      url.hostname = "mirumi.media"
      url.port = ""
      url.pathname = url.pathname.slice("/wp-content/uploads".length)
    }

    return url.href
  } catch {
    warn(context, "invalid_url", `URL を解釈できませんでした: ${value}`, source)
    return null
  }
}

const sameAnnotations = (left: RichTextAnnotations, right: RichTextAnnotations): boolean => {
  return JSON.stringify(left) === JSON.stringify(right)
}

const splitText = (value: string): Array<string> => {
  const characters = Array.from(value)
  const chunks: Array<string> = []

  for (let index = 0; index < characters.length; index += 1_900) {
    chunks.push(characters.slice(index, index + 1_900).join(""))
  }

  return chunks
}

const appendText = (richText: Array<RichTextItemRequest>, value: string, state: InlineState) => {
  if (!value) {
    return
  }

  const previous = richText.at(-1)
  if (
    previous &&
    "text" in previous &&
    (previous.text.link?.url ?? null) === state.link &&
    sameAnnotations(previous.annotations ?? {}, state.annotations)
  ) {
    previous.text.content += value
    return
  }

  richText.push({
    type: "text",
    text: {
      content: value,
      link: state.link ? { url: state.link } : null,
    },
    annotations: state.annotations,
  })
}

const appendRichTextItems = (
  richText: Array<RichTextItemRequest>,
  items: Array<RichTextItemRequest>,
) => {
  for (const item of items) {
    if ("text" in item) {
      appendText(richText, item.text.content, {
        annotations: item.annotations ?? {},
        link: item.text.link?.url ?? null,
      })
      continue
    }

    richText.push(item)
  }
}

const normalizeInlineWhitespace = (value: string): string => {
  return value.replaceAll("\r", "").replaceAll(/[\t\n\f ]+/g, " ")
}

const trimRichText = (richText: Array<RichTextItemRequest>): Array<RichTextItemRequest> => {
  const first = richText.at(0)
  if (first && "text" in first) {
    first.text.content = first.text.content.trimStart()
  }

  const last = richText.at(-1)
  if (last && "text" in last) {
    last.text.content = last.text.content.trimEnd()
  }

  return richText.filter((item) => !("text" in item) || item.text.content !== "")
}

const splitRichTextItems = (richText: Array<RichTextItemRequest>): Array<RichTextItemRequest> => {
  return richText.flatMap((item) => {
    if (!("text" in item) || item.text.content.length < 1_901) {
      return [item]
    }

    return splitText(item.text.content).map((content) => ({
      ...item,
      text: { ...item.text, content },
    }))
  })
}

const elementColor = (element: HTMLElement): RichTextAnnotations["color"] | null => {
  const style = element.getAttribute("style") ?? ""
  if (element.classList.contains("color-red")) {
    return "red"
  }
  if (element.classList.contains("color-blue")) {
    return "blue"
  }
  if (element.classList.contains("color-gray") || /color:\s*#(?:808080|999999)/i.test(style)) {
    return "gray"
  }

  return null
}

const fontSizePrefix = (element: HTMLElement): string | null => {
  const style = element.getAttribute("style") ?? ""
  const size = style.match(/font-size:\s*(0\.8|1\.35|1\.5|2(?:\.0)?)em/i)?.[1]

  return size === "0.8"
    ? "\\scriptsize"
    : size === "1.35"
      ? "\\large"
      : size === "1.5"
        ? "\\Large"
        : size === "2" || size === "2.0"
          ? "\\LARGE"
          : null
}

const equationText = (value: string): string => {
  return value.replaceAll("}", "\\}")
}

// Notion の数式は式の文字列と annotations しか持てないので、装飾やリンクの切れ目ごとに
// 数式を分ける。リンクだけは数式に載せられないため、その部分は文字サイズを諦めて
// 普通のテキストとして残す（リンクが消えるほうが損失が大きいという判断）
const fontSizeRichText = (
  items: Array<RichTextItemRequest>,
  prefix: string,
  context: ConversionContext,
  source: string,
): Array<RichTextItemRequest> => {
  const richText: Array<RichTextItemRequest> = []

  for (const item of items) {
    if (!("text" in item)) {
      richText.push(item)
      continue
    }
    if (item.text.link) {
      warn(context, "font_size_dropped", "リンクを残すため文字サイズ指定を落としました", source)
      richText.push(item)
      continue
    }

    // <br> 由来の改行は数式に入れられないので、行ごとの数式に分けて間に改行を残す
    for (const [index, line] of item.text.content.split("\n").entries()) {
      if (0 < index) {
        richText.push({ type: "text", text: { content: "\n", link: null } })
      }
      if (!line) {
        continue
      }
      richText.push({
        type: "equation",
        equation: { expression: `{${prefix}\\text{${equationText(line)}}}` },
        annotations: item.annotations,
      })
    }
  }

  return richText
}

const imageUrl = (element: HTMLElement, context: ConversionContext): string | null => {
  const value =
    element.getAttribute("src") ??
    element.getAttribute("data-src") ??
    element.getAttribute("data-lazy-src")

  return value ? safeUrl(value, context, element.outerHTML) : null
}

// max-width や min-width を巻き込まないよう直前の文字まで見る
const WIDTH_STYLE = /(?:^|[;\s])width:\s*([^;]+)/i
// WordPress の中間サイズや縮小の丸めで実寸と 1〜2px ずれることがあるので、この差までは同じ幅とみなす
const WIDTH_TOLERANCE = 2

const isTrackingImage = (element: HTMLElement): boolean => {
  const style = element.getAttribute("style") ?? ""
  const width = Number.parseFloat(
    element.getAttribute("width") ?? style.match(/width:\s*([\d.]+)px/i)?.[1] ?? "",
  )
  const height = Number.parseFloat(
    element.getAttribute("height") ?? style.match(/height:\s*([\d.]+)px/i)?.[1] ?? "",
  )

  return (Number.isFinite(width) && width < 2) || (Number.isFinite(height) && height < 2)
}

const widthAttribute = (element: HTMLElement): number | null => {
  const value = element.getAttribute("width")?.trim() ?? ""

  return /^\d+$/.test(value) ? Number(value) : null
}

// クラシックエディタで表示サイズを変えると、その幅が width 属性に入る（style ではない）。
// 実寸どおりの値や、実寸と一緒に本文幅で頭打ちになる値は WordPress が自動で書いただけなので持ち込まない
const resizedWidth = (
  element: HTMLElement,
  sourceUrl: string,
  context: ConversionContext,
): number | null => {
  const width = widthAttribute(element)
  const naturalWidth = context.media.sourceWidth(sourceUrl, "body")
  if (width === null || naturalWidth === null) {
    return null
  }
  const displayed = (value: number) => Math.min(value, BODY_CONTENT_WIDTH)

  return Math.abs(displayed(width) - displayed(naturalWidth)) <= WIDTH_TOLERANCE ? null : width
}

// 左寄せと中央寄せの違いは、画像が本文幅より狭く表示されるときにしか見た目に出ない
const isNarrowerThanContent = (
  width: string | null,
  element: HTMLElement,
  sourceUrl: string,
  context: ConversionContext,
): boolean => {
  if (width) {
    const pixels = width.match(/^([\d.]+)px$/i)?.[1]
    return pixels ? Number(pixels) < BODY_CONTENT_WIDTH : true
  }
  // 実寸が分からない画像は、見た目を変えないほうへ倒して左寄せを残す
  const naturalWidth = context.media.sourceWidth(sourceUrl, "body") ?? widthAttribute(element)

  return naturalWidth === null || naturalWidth < BODY_CONTENT_WIDTH
}

// 見た目に効く指定だけを返す。alignnone / aligncenter は WordPress がほぼ全画像に付けるクラスなので、
// そのまま持ち込むとキャプションが埋まってしまう。中央寄せは render の既定なので持ち込まず、
// 左寄せも本文幅いっぱいに表示される画像では見た目が変わらないので落とす。
// なお枠線なし指定の .sss は移行を機に廃止したので判定にも使わない
const imageWidth = (
  element: HTMLElement,
  sourceUrl: string,
  context: ConversionContext,
): string | null => {
  // インラインスタイルの width は意図的な指定なので、エディタで変えた表示幅より優先する
  const styleWidth = element.getAttribute("style")?.match(WIDTH_STYLE)?.[1]?.trim()
  if (styleWidth !== undefined) {
    return styleWidth === "100%" ? null : styleWidth
  }
  const resized = resizedWidth(element, sourceUrl, context)

  return resized === null ? null : `${resized}px`
}

const imageAttributes = (
  element: HTMLElement,
  sourceUrl: string,
  context: ConversionContext,
): Array<string> => {
  const width = imageWidth(element, sourceUrl, context)
  const alignNone =
    element.classList.contains("alignnone") &&
    isNarrowerThanContent(width, element, sourceUrl, context)

  return [
    width ? shortcodeValue("width", width) : null,
    alignNone ? shortcodeValue("align", "none") : null,
  ].filter((value): value is string => value !== null)
}

const fileStem = (url: string): string => {
  const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "")

  return name.replace(/\.[a-z0-9]+$/i, "").replace(/-\d+x\d+$/, "")
}

// alt は長年ファイル名をそのまま入れる運用だったので、ファイル名から復元できるものは持っていかない。
// 逆に「ファイル名が連番やハッシュで使い物にならないので説明を書いた」ものだけが残る
const authoredAlt = (element: HTMLElement, url: string): string | null => {
  const alt = normalizeInlineWhitespace(element.getAttribute("alt") ?? "").trim()
  if (!alt) {
    return null
  }
  const compare = (value: string) => value.toLowerCase().replaceAll(/[-_\s]/g, "")
  const stem = compare(fileStem(url))

  return stem === compare(alt) || stem.startsWith(compare(alt)) ? null : alt
}

// ブロックとして置ける画像は Notion の image ブロックにし、指定があるものだけ
// キャプション先頭のトークンとしてオプションを持たせる
const imageOptions = (
  element: HTMLElement,
  url: string,
  context: ConversionContext,
): string | null => {
  const alt = authoredAlt(element, url)
  const attributes = [
    ...imageAttributes(element, url, context),
    ...(alt ? [shortcodeValue("alt", alt)] : []),
  ]

  return 0 < attributes.length ? `[image ${attributes.join(" ")}]` : null
}

// 段落の途中に置かれた画像は image ブロックにできないため、ショートコードのまま本文に残す
const imageShortcode = (
  element: HTMLElement,
  url: string,
  sourceUrl: string,
  context: ConversionContext,
): string => {
  const name = decodeURIComponent(
    new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "image",
  )
  const alt = authoredAlt(element, sourceUrl)

  return `[image ${[
    shortcodeValue("name", name),
    ...imageAttributes(element, sourceUrl, context),
    ...(alt ? [shortcodeValue("alt", alt)] : []),
  ].join(" ")}]`
}

const migratedImageUrl = (
  context: ConversionContext,
  sourceUrl: string,
  usage: "body" | "thumbnail",
): string => {
  return context.media.resolve(sourceUrl, usage)
}

// 前後の空白の除去と分割は呼び出し元がまとめて行う。再帰の各段でやると
// <strong>太字 </strong> のような要素内側の空白や <br> まで落ちてしまう
const collectRichText = (
  nodes: Array<Node>,
  context: ConversionContext,
  state: InlineState,
): Array<RichTextItemRequest> => {
  const richText: Array<RichTextItemRequest> = []

  for (const node of nodes) {
    if (node.nodeType === NodeType.TEXT_NODE) {
      appendText(richText, normalizeInlineWhitespace(node.text), state)
      continue
    }
    if (!(node instanceof HTMLElement)) {
      continue
    }

    const tag = node.rawTagName.toLowerCase()
    if (!INLINE_TAGS.has(tag) && !node.text.trim() && !node.querySelector("img")) {
      continue
    }
    if (tag === "br") {
      appendText(richText, "\n", state)
      continue
    }
    if (tag === "img") {
      if (isTrackingImage(node)) {
        continue
      }
      const url = imageUrl(node, context)
      if (url) {
        appendText(
          richText,
          imageShortcode(node, migratedImageUrl(context, url, "body"), url, context),
          state,
        )
      }
      continue
    }
    const annotations: RichTextAnnotations = { ...state.annotations }
    if (tag === "strong" || tag === "b") {
      annotations.bold = true
    }
    if (tag === "em" || tag === "i") {
      annotations.italic = true
    }
    if (tag === "del" || tag === "s") {
      annotations.strikethrough = true
    }
    if (tag === "u") {
      annotations.underline = true
    }
    if (tag === "code") {
      annotations.code = true
    }
    const color = elementColor(node)
    if (color) {
      annotations.color = color
    }
    if (tag === "sup" || tag === "sub") {
      // Wikipedia の引用注記など中身が空のものがあり、空の数式は意味を持たない
      const inner = normalizeInlineWhitespace(node.text).trim()
      if (!inner) {
        continue
      }
      const expression = `${tag === "sup" ? "^" : "_"}{${equationText(inner)}}`
      richText.push({ type: "equation", equation: { expression }, annotations })
      continue
    }

    const prefix = tag === "span" ? fontSizePrefix(node) : null
    if (prefix) {
      richText.push(
        ...fontSizeRichText(
          collectRichText(node.childNodes, context, { annotations, link: state.link }),
          prefix,
          context,
          node.outerHTML,
        ),
      )
      continue
    }

    let link = state.link
    if (tag === "a") {
      const href = node.getAttribute("href")
      link = href ? safeUrl(href, context, node.outerHTML) : null
    } else if (!INLINE_TAGS.has(tag)) {
      warn(
        context,
        "unsupported_inline",
        `未対応のインライン要素 <${tag}> を平文化しました`,
        node.outerHTML,
      )
    }

    richText.push(...collectRichText(node.childNodes, context, { annotations, link }))
  }

  return richText
}

// WordPress の本文は <br /> のあとに改行が入っているため、そのままだと
// 改行のあとに半角スペースが 1 個残る。HTML では潰れるが Notion では文字として残ってしまう
const stripSpaceAfterNewline = (
  richText: Array<RichTextItemRequest>,
): Array<RichTextItemRequest> => {
  let previousEndsWithNewline = false
  for (const item of richText) {
    if (!("text" in item)) {
      previousEndsWithNewline = false
      continue
    }
    const content = item.text.content.replaceAll(/\n /g, "\n")
    item.text.content = previousEndsWithNewline ? content.replace(/^ /, "") : content
    previousEndsWithNewline = item.text.content.endsWith("\n")
  }

  return richText
}

const richTextFromNodes = (
  nodes: Array<Node>,
  context: ConversionContext,
): Array<RichTextItemRequest> => {
  return splitRichTextItems(
    trimRichText(stripSpaceAfterNewline(collectRichText(nodes, context, DEFAULT_INLINE_STATE))),
  )
}

const plainRichText = (value: string): Array<RichTextItemRequest> => {
  return splitText(value).map((content) => ({ type: "text", text: { content } }))
}

const paragraph = (richText: Array<RichTextItemRequest>): BlockObjectRequest => {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText } }
}

const shortcodeAttributes = (value: string): Readonly<Record<string, string>> => {
  const attributes: Record<string, string> = {}
  for (const match of value.matchAll(/([a-zA-Z][\w-]*)\s*=\s*(["'])(.*?)\2/g)) {
    if (match[1] && match[3] !== undefined) {
      attributes[match[1]] = match[3]
    }
  }

  return attributes
}

const shortcodeValue = (name: string, value: string): string => {
  return `${name}="${value.replaceAll('"', '\\"')}"`
}

const mediaFromShortcode = (
  value: string,
  context: ConversionContext,
): BlockObjectRequest | null => {
  const match = value.match(/^\[(audio|video)\b([^\]]*)]/i)
  if (!match?.[1]) {
    return null
  }

  const type = match[1].toLowerCase() as "audio" | "video"
  const attributes = shortcodeAttributes(match[2] ?? "")
  const urlValue =
    type === "audio"
      ? (attributes.src ?? attributes.mp3 ?? attributes.m4a ?? attributes.ogg ?? attributes.wav)
      : (attributes.src ?? attributes.mp4 ?? attributes.m4v ?? attributes.webm ?? attributes.ogv)
  const url = urlValue ? safeUrl(urlValue, context, value) : null
  if (!url) {
    warn(context, "unsupported_shortcode", `${type} shortcode の URL を取得できませんでした`, value)
    return paragraph(plainRichText(value))
  }

  return type === "audio"
    ? { object: "block", type: "audio", audio: { type: "external", external: { url } } }
    : { object: "block", type: "video", video: { type: "external", external: { url } } }
}

const specialTextBlock = (value: string, context: ConversionContext): BlockObjectRequest | null => {
  const text = value.trim()
  const media = mediaFromShortcode(text, context)
  if (media) {
    return media
  }

  // 末尾スラッシュ、サブディレクトリ、目次アンカー付きの書き方が混ざっているので幅を持たせる。
  // アンカーは移行で見出し ID が変わって必ず切れるため、記事そのものへのカードに寄せる
  const related = text.match(/^\[\/([a-z0-9][a-z0-9/_-]*[a-z0-9])\/?(#[^\]]*)?]$/i)
  if (related?.[1]) {
    if (related[2]) {
      warn(context, "anchor_dropped", `ブログカードのアンカーを落としました: ${related[2]}`, text)
    }
    return {
      object: "block",
      type: "bookmark",
      bookmark: { url: `https://mirumi.me/${related[1]}/` },
    }
  }

  const bookmark = text.match(/^\[(https?:\/\/[^\]]+)]$/i)
  if (bookmark?.[1]) {
    const url = safeUrl(bookmark[1], context, value)
    return url ? { object: "block", type: "bookmark", bookmark: { url } } : null
  }

  const amazon = canonicalizeAmazonShortcode(text)
  if (amazon) {
    return paragraph(plainRichText(amazon))
  }

  const url = /^https?:\/\/\S+$/.test(text) ? safeUrl(text, context, value) : null
  if (url) {
    const hostname = new URL(url).hostname
    if (
      hostname === "x.com" ||
      hostname.endsWith(".x.com") ||
      hostname === "twitter.com" ||
      hostname.endsWith(".twitter.com")
    ) {
      return { object: "block", type: "embed", embed: { url } }
    }
    if (hostname === "youtu.be" || hostname.endsWith("youtube.com")) {
      return { object: "block", type: "video", video: { type: "external", external: { url } } }
    }
  }

  if (/^\[[a-zA-Z][^\]]*]$/.test(text)) {
    warn(context, "unsupported_shortcode", "未対応の shortcode を通常段落として保持しました", text)
  }

  return null
}

const imageBlock = (
  element: HTMLElement,
  context: ConversionContext,
  caption: Array<RichTextItemRequest> = [],
): BlockObjectRequest | null => {
  if (isTrackingImage(element)) {
    return null
  }
  const url = imageUrl(element, context)
  if (!url) {
    return null
  }
  const options = imageOptions(element, url, context)
  const optionToken = options ? plainRichText(0 < caption.length ? `${options} ` : options) : []

  return {
    object: "block",
    type: "image",
    image: {
      type: "external",
      external: { url: migratedImageUrl(context, url, "body") },
      caption: [...optionToken, ...caption],
    },
  }
}

const captionedImageBlocks = (
  image: HTMLElement,
  context: ConversionContext,
  caption: Array<RichTextItemRequest>,
): Array<BlockObjectRequest> => {
  const block = imageBlock(image, context, caption)

  return block ? [block] : []
}

const directChildrenByTag = (element: HTMLElement, tag: string): Array<HTMLElement> => {
  return element.childNodes.filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.rawTagName.toLowerCase() === tag,
  )
}

const listBlocks = (
  element: HTMLElement,
  context: ConversionContext,
): Array<BlockObjectRequest> => {
  const tag = element.rawTagName.toLowerCase()
  const type = tag === "ol" ? "numbered_list_item" : "bulleted_list_item"

  return directChildrenByTag(element, "li").map((item) => {
    let childElements = item.childNodes.filter(
      (node): node is HTMLElement => node instanceof HTMLElement && !isInlineNode(node),
    )
    let inlineNodes = item.childNodes.filter((node) => !childElements.includes(node as HTMLElement))
    let richText = richTextFromNodes(inlineNodes, context)

    const firstChild = childElements.at(0)
    if (
      richText.length === 0 &&
      firstChild?.rawTagName.toLowerCase() === "p" &&
      firstChild.childNodes.every(isInlineNode)
    ) {
      inlineNodes = firstChild.childNodes
      richText = richTextFromNodes(inlineNodes, context)
      childElements = childElements.slice(1)
    }

    if (0 < childElements.length) {
      const children = childElements.flatMap(
        (child) =>
          (["ol", "ul"].includes(child.rawTagName.toLowerCase())
            ? listBlocks(child, context)
            : convertElement(child, context)) as Array<BlockObjectRequest>,
      )
      return (type === "numbered_list_item"
        ? {
            object: "block" as const,
            type: "numbered_list_item" as const,
            numbered_list_item: { rich_text: richText, children },
          }
        : {
            object: "block" as const,
            type: "bulleted_list_item" as const,
            bulleted_list_item: { rich_text: richText, children },
          }) as unknown as BlockObjectRequest
    }

    return type === "numbered_list_item"
      ? {
          object: "block" as const,
          type: "numbered_list_item" as const,
          numbered_list_item: { rich_text: splitRichTextItems(richText) },
        }
      : {
          object: "block" as const,
          type: "bulleted_list_item" as const,
          bulleted_list_item: { rich_text: splitRichTextItems(richText) },
        }
  })
}

const codeLanguage = (element: HTMLElement, context: ConversionContext): CodeLanguage => {
  const code = element.querySelector("code")
  const classes = [...element.classList.value, ...(code?.classList.value ?? [])]
  const raw =
    classes.find((className) => className.startsWith("language-"))?.slice(9) ?? classes.at(0)
  const aliases: Readonly<Record<string, CodeLanguage>> = {
    bash: "bash",
    css: "css",
    html: "html",
    js: "javascript",
    json: "json",
    jsonc: "json",
    _lang_: "plain text",
    no: "plain text",
    plain: "plain text",
    plaintext: "plain text",
    php: "php",
    py: "python",
    python: "python",
    sh: "shell",
    shell: "shell",
    sql: "sql",
    ts: "typescript",
    vb: "visual basic",
    xml: "xml",
    yaml: "yaml",
  }
  const language = raw ? (aliases[raw.toLowerCase()] ?? raw.toLowerCase()) : "plain text"
  if (!CODE_LANGUAGES.has(language as CodeLanguage)) {
    warn(
      context,
      "unsupported_block",
      `コード言語 ${language} を plain text にしました`,
      element.outerHTML,
    )
    return "plain text"
  }

  return language as CodeLanguage
}

const richTextFromTableNodes = (
  nodes: Array<Node>,
  context: ConversionContext,
): Array<RichTextItemRequest> => {
  const richText: Array<RichTextItemRequest> = []

  for (const node of nodes) {
    if (isInlineNode(node)) {
      appendRichTextItems(richText, collectRichText([node], context, DEFAULT_INLINE_STATE))
      continue
    }
    if (!(node instanceof HTMLElement)) {
      continue
    }

    const tag = node.rawTagName.toLowerCase()
    if (tag === "ul" || tag === "ol") {
      for (const [index, item] of directChildrenByTag(node, "li").entries()) {
        appendText(richText, tag === "ol" ? `${index + 1}. ` : "・", DEFAULT_INLINE_STATE)
        appendRichTextItems(richText, richTextFromTableNodes(item.childNodes, context))
        appendText(richText, "\n", DEFAULT_INLINE_STATE)
      }
      continue
    }

    appendRichTextItems(richText, richTextFromTableNodes(node.childNodes, context))
    appendText(richText, "\n", DEFAULT_INLINE_STATE)
  }

  return splitRichTextItems(trimRichText(stripSpaceAfterNewline(richText)))
}

const tableBlock = (
  element: HTMLElement,
  context: ConversionContext,
): BlockObjectRequest | null => {
  const rows = element.querySelectorAll("tr")
  const cells = rows.map((row) =>
    row.childNodes
      .filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && ["td", "th"].includes(node.rawTagName.toLowerCase()),
      )
      .map((cell) => richTextFromTableNodes(cell.childNodes, context)),
  )
  const width = Math.max(0, ...cells.map((row) => row.length))
  if (width === 0) {
    warn(context, "unsupported_block", "空のテーブルを除外しました", element.outerHTML)
    return null
  }

  if (cells.some((row) => row.length !== width)) {
    warn(context, "table_normalized", "列数の異なる行を空セルで補完しました", element.outerHTML)
  }
  const children = cells.map((row) => ({
    object: "block" as const,
    type: "table_row" as const,
    table_row: {
      cells: [...row, ...Array.from({ length: width - row.length }, () => [])],
    },
  }))
  const firstRow = rows.at(0)
  const hasColumnHeader = Boolean(firstRow?.querySelector("th"))
  const hasRowHeader = rows.every((row) => {
    const firstCell = row.childNodes.find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && ["td", "th"].includes(node.rawTagName.toLowerCase()),
    )
    return firstCell?.rawTagName.toLowerCase() === "th"
  })

  return {
    object: "block",
    type: "table",
    table: {
      table_width: width,
      has_column_header: hasColumnHeader,
      has_row_header: hasRowHeader,
      children,
    },
  }
}

const buttonShortcode = (element: HTMLElement): string | null => {
  const button = element.querySelector(".btn-wrap")
  const link = button?.querySelector("a")
  const href = link?.getAttribute("href")
  if (!button || !link || !href) {
    return null
  }

  const colorClass = button.classList.value.find(
    (className) => className.startsWith("btn-wrap-") && className !== "btn-wrap-m",
  )
  const color = colorClass?.slice("btn-wrap-".length) ?? "default"

  return `[button ${shortcodeValue("text", normalizeInlineWhitespace(link.text).trim())} ${shortcodeValue("url", href)} ${shortcodeValue("color", color)}]`
}

// アプリ名・アイコン・開発者・価格はアプリーチのプラグインが生成していたもので、
// ショートコードにしてしまうと元 HTML からしか取れなくなる。移行時にすべて焼き込む
const appIconFile = (icon: string): string => {
  const url = icon.startsWith("//") ? `https:${icon}` : icon

  return `app-icon-${createHash("sha256").update(url).digest("hex").slice(0, 12)}.webp`
}

const appShortcode = (element: HTMLElement): string => {
  const text = (selector: string) =>
    normalizeInlineWhitespace(element.querySelector(selector)?.text ?? "").trim()
  const icon = element.querySelector(".appreach__icon")?.getAttribute("src")
  const ios = element.querySelector(".appreach__aslink")?.getAttribute("href")
  const android = element.querySelector(".appreach__gplink")?.getAttribute("href")
  const name = text(".appreach__name")
  const developer = text(".appreach__developper")
  const price = text(".appreach__price")
  const attributes = [
    name ? shortcodeValue("name", name) : null,
    icon ? shortcodeValue("icon", appIconFile(icon)) : null,
    developer ? shortcodeValue("developer", developer) : null,
    price ? shortcodeValue("price", price) : null,
    ios ? shortcodeValue("ios", ios) : null,
    android ? shortcodeValue("android", android) : null,
  ].filter(Boolean)

  return `[app ${attributes.join(" ")}]`
}

const delayedVideoShortcode = (element: HTMLElement, context: ConversionContext): string | null => {
  const source = element.getAttribute("data-video")
  if (!source) {
    return null
  }

  const thumbnailSource = element.querySelector("img")?.getAttribute("src")
  const thumbnailUrl = thumbnailSource ? safeUrl(thumbnailSource, context, element.outerHTML) : null
  const thumbnail = thumbnailUrl ? migratedImageUrl(context, thumbnailUrl, "body") : null
  const sourceUrl = new URL(source, "https://www.youtube.com")
  const start = sourceUrl.searchParams.get("start")
  const attributes = [
    "delay",
    shortcodeValue("src", sourceUrl.href),
    thumbnail ? shortcodeValue("thumbnail", thumbnail) : null,
    start ? shortcodeValue("ts", `${start}s`) : null,
  ].filter(Boolean)

  return `[video ${attributes.join(" ")}]`
}

const calloutBlock = (element: HTMLElement, context: ConversionContext): BlockObjectRequest => {
  const firstParagraph = directChildrenByTag(element, "p").at(0)
  const richText = firstParagraph ? richTextFromNodes(firstParagraph.childNodes, context) : []
  const remainingNodes = firstParagraph
    ? element.childNodes.filter((node) => node !== firstParagraph)
    : element.childNodes
  const children = convertNodes(remainingNodes, context)
  const icon = element.classList.contains("box-info")
    ? "💡"
    : element.classList.contains("box-rewrite")
      ? "♻️"
      : element.classList.contains("box-alert")
        ? "🚨"
        : null

  return {
    object: "block",
    type: "callout",
    callout: {
      rich_text: richText,
      ...(icon ? { icon: { type: "emoji", emoji: icon } } : {}),
      ...(0 < children.length ? { children } : {}),
    },
  } as BlockObjectRequest
}

const quoteImageShortcode = (
  element: HTMLElement,
  context: ConversionContext,
): BlockObjectRequest | null => {
  const image = element.querySelector("img")
  if (!image) {
    return null
  }
  const url = imageUrl(image, context)
  if (!url) {
    return null
  }

  const name = decodeURIComponent(
    new URL(migratedImageUrl(context, url, "body")).pathname.split("/").filter(Boolean).at(-1) ??
      "image",
  )
  const copyright = normalizeInlineWhitespace(
    element.text.replaceAll(/\[\/?caption[^\]]*]/gi, ""),
  ).trim()
  const width = imageWidth(image, url, context)
  const value = `[quoteImage ${[
    shortcodeValue("name", name),
    shortcodeValue("copyright", copyright),
    ...(width ? [shortcodeValue("width", width)] : []),
  ].join(" ")}]`

  return paragraph(plainRichText(value))
}

const headingBlock = (element: HTMLElement, context: ConversionContext): BlockObjectRequest => {
  const level = Number(element.rawTagName.slice(1))
  const type = `heading_${Math.min(4, Math.max(1, level))}` as
    | "heading_1"
    | "heading_2"
    | "heading_3"
    | "heading_4"
  const richText = richTextFromNodes(element.childNodes, context)

  if (type === "heading_1") {
    return { object: "block", type, heading_1: { rich_text: richText } }
  }
  if (type === "heading_2") {
    return { object: "block", type, heading_2: { rich_text: richText } }
  }
  if (type === "heading_3") {
    return { object: "block", type, heading_3: { rich_text: richText } }
  }

  return { object: "block", type, heading_4: { rich_text: richText } }
}

const convertElement = (
  element: HTMLElement,
  context: ConversionContext,
): Array<BlockObjectRequest> => {
  const tag = element.rawTagName.toLowerCase()

  if (tag === "style") {
    if (element.rawText.trim()) {
      context.customCss.push(element.rawText.trim())
    }
    return []
  }
  if (/^h[1-6]$/.test(tag)) {
    return [headingBlock(element, context)]
  }
  if (tag === "hr" || element.classList.contains("dot-line-brown")) {
    return [{ object: "block", type: "divider", divider: {} }]
  }
  if (tag === "ul" || tag === "ol") {
    return listBlocks(element, context)
  }
  if (tag === "table") {
    const block = tableBlock(element, context)
    return block ? [block] : []
  }
  if (tag === "pre") {
    // blockTextElements で pre の中身は生テキストになるため、必要なら解析し直して取り出す。
    // 末尾に空の <code></code> が付いている本文もあるので、空なら解析後の全文を使う
    const parsed = parse(element.rawText)
    const fromCode = element.querySelector("code")?.text ?? parsed.querySelector("code")?.text
    const code = fromCode?.trim() ? fromCode : parsed.text
    return [
      {
        object: "block",
        type: "code",
        code: { rich_text: plainRichText(code), language: codeLanguage(element, context) },
      },
    ]
  }
  if (tag === "img") {
    const block = imageBlock(element, context)
    return block ? [block] : []
  }
  if (tag === "figure" && element.hasAttribute("data-wordpress-caption")) {
    const image = element.querySelector("img")
    if (!image) {
      return []
    }
    // キャプションのリンクや装飾を落とさないよう、画像を除いた中身をそのまま変換する
    const captionNodes = element.childNodes.filter((node) => {
      return !(node instanceof HTMLElement) || (node !== image && !node.querySelector("img"))
    })
    return captionedImageBlocks(image, context, richTextFromNodes(captionNodes, context))
  }
  if (tag === "blockquote") {
    if (element.classList.contains("img")) {
      const block = quoteImageShortcode(element, context)
      return block ? [block] : []
    }
    const firstParagraph = directChildrenByTag(element, "p").at(0)
    const richText = firstParagraph ? richTextFromNodes(firstParagraph.childNodes, context) : []
    const remainingNodes = firstParagraph
      ? element.childNodes.filter((node) => node !== firstParagraph)
      : element.childNodes
    const children = convertNodes(remainingNodes, context)
    return [
      {
        object: "block",
        type: "quote",
        quote: { rich_text: richText, ...(0 < children.length ? { children } : {}) },
      } as BlockObjectRequest,
    ]
  }
  if (tag === "iframe") {
    const source = element.getAttribute("src")
    const url = source ? safeUrl(source, context, element.outerHTML) : null
    return url
      ? [{ object: "block", type: "video", video: { type: "external", external: { url } } }]
      : []
  }
  if (tag === "p") {
    for (const style of element.querySelectorAll("style")) {
      if (style.rawText.trim()) {
        context.customCss.push(style.rawText.trim())
      }
      style.remove()
    }
    if (element.childNodes.some((node) => !isInlineNode(node))) {
      return convertNodes(element.childNodes, context)
    }
    const special = specialTextBlock(element.text, context)
    if (special) {
      return [special]
    }
    const button = buttonShortcode(element)
    if (button) {
      return [paragraph(plainRichText(button))]
    }
    const images = element.querySelectorAll("img")
    const textWithoutImages = element.text.trim()
    if (images.length === 1) {
      // 技術ブログを統合したときの記事だけ、画像の直後に <em> でキャプションを書く形になっている
      // （フロントエンドの `img ~ em` にキャプション用のスタイルが当たっている）
      const captions = directChildrenByTag(element, "em")
      const captionText = captions.map((caption) => caption.text).join("")
      if (!textWithoutImages || captionText.trim() === textWithoutImages) {
        const block = imageBlock(
          images[0]!,
          context,
          captions.flatMap((caption) => richTextFromNodes(caption.childNodes, context)),
        )
        return block ? [block] : []
      }
    }
    const richText = richTextFromNodes(element.childNodes, context)
    return 0 < richText.length ? [paragraph(richText)] : []
  }
  if (tag === "a") {
    const image = element.querySelector("img")
    if (image && !element.text.trim()) {
      const block = imageBlock(image, context)
      return block ? [block] : []
    }
    return [paragraph(richTextFromNodes([element], context))]
  }
  if (tag === "div") {
    if (element.classList.contains("wp-caption")) {
      const image = element.querySelector("img")
      if (!image) {
        return []
      }
      const caption = element.querySelector(".wp-caption-text")
      return captionedImageBlocks(
        image,
        context,
        caption ? richTextFromNodes(caption.childNodes, context) : [],
      )
    }
    if (element.classList.contains("blogcard-type")) {
      // カードが 2 枚入っている div もあるので、まとめて 1 つとして解釈せず子ごとに変換する
      const special = specialTextBlock(element.text, context)
      return special ? [special] : convertNodes(element.childNodes, context)
    }
    if (element.classList.contains("appreach")) {
      return [paragraph(plainRichText(appShortcode(element)))]
    }
    if (element.classList.contains("youtube")) {
      const shortcode = delayedVideoShortcode(element, context)
      return shortcode ? [paragraph(plainRichText(shortcode))] : []
    }
    if (element.classList.contains("box-common") || element.classList.contains("waku-common")) {
      return [calloutBlock(element, context)]
    }
    if (element.classList.contains("micro-bottom")) {
      return [paragraph(richTextFromNodes(element.childNodes, context))]
    }
    if (element.classList.contains("speech-wrap")) {
      const balloon = element.querySelector(".speech-balloon")
      return balloon
        ? convertNodes(balloon.childNodes, context)
        : convertNodes(element.childNodes, context)
    }
    if (!element.text.trim() && !element.querySelector("img")) {
      // 罫線を引くためだけの空 div は区切り線として残す（dot-line-brown と同じ扱い）
      if (
        /border(?:-top|-bottom)?(?:-style|-width|-color)?:/i.test(
          element.getAttribute("style") ?? "",
        )
      ) {
        return [{ object: "block", type: "divider", divider: {} }]
      }
      if (0 < element.classList.length) {
        warn(context, "empty_element", "中身のない要素を取り除きました", element.outerHTML)
      }
      return []
    }
    if (element.childNodes.every(isInlineNode)) {
      const richText = richTextFromNodes(element.childNodes, context)
      return 0 < richText.length ? [paragraph(richText)] : []
    }

    const children = convertNodes(element.childNodes, context)
    if (element.classList.length !== 0) {
      warn(
        context,
        "unsupported_block",
        "未対応の div を子ブロックへ平文化しました",
        element.outerHTML,
      )
    }
    return children
  }

  if (INLINE_TAGS.has(tag)) {
    if (element.childNodes.some((node) => !isInlineNode(node))) {
      return convertNodes(element.childNodes, context)
    }
    return [paragraph(richTextFromNodes([element], context))]
  }

  warn(
    context,
    "unsupported_block",
    `未対応のブロック要素 <${tag}> を平文化しました`,
    element.outerHTML,
  )
  return convertNodes(element.childNodes, context)
}

const convertLooseText = (value: string, context: ConversionContext): Array<BlockObjectRequest> => {
  return value
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => specialTextBlock(line, context) ?? paragraph(plainRichText(line)))
}

const isInlineNode = (node: Node): boolean => {
  return (
    node.nodeType === NodeType.TEXT_NODE ||
    (node instanceof HTMLElement &&
      INLINE_TAGS.has(node.rawTagName.toLowerCase()) &&
      !node
        .querySelectorAll("*")
        .some((element) => !INLINE_TAGS.has(element.rawTagName.toLowerCase())))
  )
}

const convertNodes = (
  nodes: Array<Node>,
  context: ConversionContext,
): Array<BlockObjectRequest> => {
  const blocks: Array<BlockObjectRequest> = []
  let inlineNodes: Array<Node> = []

  const flushInlineNodes = () => {
    if (inlineNodes.length === 0) {
      return
    }
    const containsElement = inlineNodes.some((node) => node instanceof HTMLElement)
    if (!containsElement) {
      blocks.push(...convertLooseText(inlineNodes.map((node) => node.text).join(""), context))
    } else {
      const richText = richTextFromNodes(inlineNodes, context)
      if (0 < richText.length) {
        blocks.push(paragraph(richText))
      }
    }
    inlineNodes = []
  }

  for (const node of nodes) {
    if (isInlineNode(node)) {
      if (node.nodeType !== NodeType.TEXT_NODE || node.text.trim()) {
        inlineNodes.push(node)
      }
      continue
    }

    flushInlineNodes()
    if (node instanceof HTMLElement) {
      const start = blocks.length
      blocks.push(...convertElement(node, context))
      if (node.classList.contains("micro-bottom") && 0 < start) {
        const previous = blocks[start - 1]
        const caption = blocks[start]
        if (previous && "image" in previous && caption && "paragraph" in caption) {
          // キャプション先頭のオプショントークンを消さないよう、置き換えではなく後ろに足す
          const token = previous.image.caption ?? []
          const separator: Array<RichTextItemRequest> = 0 < token.length ? plainRichText(" ") : []
          previous.image.caption = [...token, ...separator, ...caption.paragraph.rich_text]
          blocks.splice(start, 1)
        }
      }
    }
  }
  flushInlineNodes()

  return blocks
}

const prepareHtml = (content: string): string => {
  return content.replaceAll(
    /\[caption\b[^\]]*]([\s\S]*?)\[\/caption]/gi,
    '<figure data-wordpress-caption="true">$1</figure>',
  )
}

// WordPress の日時はタイムゾーンを持たない JST なので +09:00 を補う。
// Nuxt 側は時刻まで表示しないため、この決め打ちで問題ないことは確認済み
const toDate = (value: string): { start: string } => {
  return { start: `${value.replace(" ", "T")}+09:00` }
}

const filename = (url: string): string => {
  return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "thumbnail")
}

const makeProperties = (
  record: WordPressContentRecord,
  customCss: string,
  context: ConversionContext,
): PageProperties => {
  const properties: PageProperties = {
    title: { type: "title", title: plainRichText(record.title) },
    slug: { type: "rich_text", rich_text: plainRichText(record.slug) },
    "internal-state": { type: "select", select: { name: "公開中" } },
    公開日: { type: "date", date: toDate(record.postDate) },
    更新日: {
      type: "date",
      date: record.postModified === record.postDate ? null : toDate(record.postModified),
    },
    もくじ非表示: { type: "checkbox", checkbox: record.tocHidden },
    もくじ閉じる: { type: "checkbox", checkbox: record.tocClosed },
    "カスタム CSS": { type: "rich_text", rich_text: plainRichText(customCss) },
  }

  if (1 < record.categories.length) {
    warn(
      context,
      "multiple_categories",
      `複数カテゴリのうち先頭だけを使用します: ${record.categories.map((category) => category.slug).join(", ")}`,
      record.slug,
    )
  }
  const category = record.categories.at(0)
  const categoryPageId = category ? CATEGORY_PAGE_IDS[category.slug] : null
  if (category && !categoryPageId) {
    warn(context, "unknown_category", `カテゴリ ${category.slug} の移行先がありません`, record.slug)
  }
  properties.category = {
    type: "relation",
    relation: categoryPageId ? [{ id: categoryPageId }] : [],
  }

  // Notion では thumbnail をセットしているかどうかが本文への表示可否そのものになるため、
  // WordPress で本文に出していなかった記事は空のままにして Workers の自動生成に任せる
  const thumbnailUrl =
    record.showThumbnailOnFrontend && record.thumbnailUrl
      ? safeUrl(record.thumbnailUrl, context, record.thumbnailUrl)
      : null
  const migratedThumbnailUrl = thumbnailUrl
    ? migratedImageUrl(context, thumbnailUrl, "thumbnail")
    : null
  properties.thumbnail = {
    type: "files",
    files: migratedThumbnailUrl
      ? [
          {
            name: filename(migratedThumbnailUrl),
            type: "external",
            external: { url: migratedThumbnailUrl },
          },
        ]
      : [],
  }

  return properties
}

export const convertWordPressContent = (
  record: WordPressContentRecord,
  media?: MediaMigrationResolver,
): NotionPageInput => {
  const context: ConversionContext = {
    articleUrl: `https://mirumi.me/${record.slug}/`,
    customCss: [],
    warnings: [],
    media: media ?? { resolve: (sourceUrl) => sourceUrl, sourceWidth: () => null },
  }
  const root = parse(prepareHtml(record.content), {
    comment: true,
    blockTextElements: { script: true, noscript: true, style: true, pre: true },
  })
  const children = convertNodes(root.childNodes, context)
  const customCss = context.customCss.join("\n\n")

  return {
    sourceId: record.id,
    slug: record.slug,
    parent: {
      type: "data_source_id",
      data_source_id: record.postType === "page" ? PAGES_DATA_SOURCE_ID : POSTS_DATA_SOURCE_ID,
    },
    properties: makeProperties(record, customCss, context),
    children,
    warnings: context.warnings,
  }
}
