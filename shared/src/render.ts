import type {
  ArticleContent,
  ContentBlock,
  HeadingBlock,
  RenderedContent,
  RichText,
  TableBlock,
  TableRowBlock,
} from "./content"

interface RenderContext {
  warnings: Array<string>
}

const escapeHtml = (value: string): string => {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const safeUrl = (value: string): string | null => {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

const addWarning = (context: RenderContext, message: string): string => {
  context.warnings.push(message)

  return `<div class="box-common box-alert"><p><strong>🔴 ${escapeHtml(message)}</strong></p></div>`
}

const renderEquation = (expression: string, context: RenderContext): string => {
  const fontSizes = [
    { prefix: "{\\scriptsize\\text{", size: "0.8em" },
    { prefix: "{\\large\\text{", size: "1.35em" },
    { prefix: "{\\Large\\text{", size: "1.5em" },
    { prefix: "{\\LARGE\\text{", size: "2em" },
  ]

  // 数式に入れるときに閉じ波括弧をエスケープしているので戻す
  const unescapeBrace = (value: string) => value.replaceAll("\\}", "}")

  for (const { prefix, size } of fontSizes) {
    if (expression.startsWith(prefix) && expression.endsWith("}}")) {
      const content = unescapeBrace(expression.slice(prefix.length, -2))

      return `<span style="font-size:${size}">${escapeHtml(content)}</span>`
    }
  }

  if (expression.startsWith("^{") && expression.endsWith("}")) {
    return `<sup>${escapeHtml(unescapeBrace(expression.slice(2, -1)))}</sup>`
  }
  if (expression.startsWith("_{") && expression.endsWith("}")) {
    return `<sub>${escapeHtml(unescapeBrace(expression.slice(2, -1)))}</sub>`
  }

  context.warnings.push(`未対応のインライン数式です: ${expression}`)

  return `<span title="🔴 未対応のインライン数式">🔴 ${escapeHtml(expression)}</span>`
}

const renderRichTextItem = (item: RichText, context: RenderContext): string => {
  let html =
    item.type === "equation"
      ? renderEquation(item.content, context)
      : escapeHtml(item.content).replaceAll("\n", "<br>")

  if (item.annotations.code) {
    html = `<code>${html}</code>`
  }
  if (item.annotations.bold) {
    html = `<strong>${html}</strong>`
  }
  if (item.annotations.italic) {
    html = `<em>${html}</em>`
  }
  if (item.annotations.strikethrough) {
    html = `<del>${html}</del>`
  }
  if (item.annotations.underline) {
    html = `<u>${html}</u>`
  }

  const color = item.annotations.color.endsWith("_background") ? "default" : item.annotations.color
  if (color === "red" || color === "blue" || color === "gray") {
    html = `<span class="color-${color}">${html}</span>`
  }

  const href = item.href ? safeUrl(item.href) : null
  if (href) {
    html = `<a href="${escapeHtml(href)}">${html}</a>`
  } else if (item.href) {
    // 黙ってリンクだけ消えると気づけないので、本文は残したうえで警告に出す
    context.warnings.push(
      `リンクを出力できませんでした。相対パスや http/https 以外の URL は使えません: ${item.href}`,
    )
  }

  return html
}

// 段落の途中に置かれた画像は Notion の image ブロックにできないため、移行時に
// `[image name="…"]` のショートコードとして本文に埋め込まれている。
// 画像の実体は mirumi.media の直下に並んでいるのでファイル名から URL を組み立てられる
// リッチテキストを HTML 化したあとに処理するため、属性の引用符は escapeHtml 済みの &quot;
const INLINE_IMAGE = /\[image\s+name=&quot;(.*?)&quot;((?:[^\]]|&quot;[^&]*&quot;)*?)]/g

const renderInlineImages = (html: string, context: RenderContext): string => {
  return html.replaceAll(INLINE_IMAGE, (matched, name: string, rest: string) => {
    const url = safeUrl(`https://mirumi.media/${encodeURIComponent(name)}`)
    if (!url) {
      context.warnings.push(`インライン画像の名前が不正です: ${name}`)
      return matched
    }
    const alt = rest.match(/\balt=&quot;(.*?)&quot;/)?.[1] ?? name.replace(/\.[a-z0-9]+$/i, "")

    return `<img src="${escapeHtml(url)}" alt="${alt}" loading="lazy">`
  })
}

const renderRichText = (richText: Array<RichText>, context: RenderContext): string => {
  const html = richText.map((item) => renderRichTextItem(item, context)).join("")

  return html.includes("[image ") ? renderInlineImages(html, context) : html
}

const renderChildren = (block: ContentBlock, context: RenderContext): string => {
  if (block.children.length === 0) {
    return ""
  }

  return renderBlocks(block.children, context)
}

// Notion の Block ID（UUID）を base64url にして 7 文字だけ使う。hex を切り出すより
// 1 文字あたりの情報量が多く、42 bit を 7 文字で表せる。
// ただし Notion の ID は時系列順で先頭バイトが作成時刻なので、先頭ではなく末尾から取る
// （同じ記事のブロックは作成時刻が近く、先頭を使うと大量に衝突する）
const headingId = (blockId: string): string => {
  const hex = blockId.replaceAll("-", "")
  const bytes = Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
  const base64url = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "")

  return `h-${base64url.slice(-7)}`
}

const renderHeading = (block: HeadingBlock, context: RenderContext): string => {
  const level = block.level
  const id = headingId(block.id)
  const children = renderChildren(block, context)

  return `<h${level} id="${id}-heading"><span id="${id}">${renderRichText(block.richText, context)}</span></h${level}>${children}`
}

const renderList = (
  blocks: Array<ContentBlock>,
  start: number,
  context: RenderContext,
): { html: string; next: number } => {
  const first = blocks[start]
  if (!first || (first.type !== "bulleted_list_item" && first.type !== "numbered_list_item")) {
    return { html: "", next: start }
  }

  const listType = first.type
  const tag = listType === "bulleted_list_item" ? "ul" : "ol"
  let html = `<${tag}>`
  let index = start

  while (index < blocks.length && blocks[index]?.type === listType) {
    const block = blocks[index]
    if (!block || (block.type !== "bulleted_list_item" && block.type !== "numbered_list_item")) {
      break
    }

    html += `<li>${renderRichText(block.richText, context)}${renderChildren(block, context)}</li>`
    index += 1
  }

  return { html: `${html}</${tag}>`, next: index }
}

const renderTable = (block: TableBlock, context: RenderContext): string => {
  const rows = block.children.filter((child): child is TableRowBlock => child.type === "table_row")
  if (rows.length === 0) {
    return addWarning(context, `空のテーブルです（block: ${block.id}）`)
  }

  const renderRow = (row: TableRowBlock, rowIndex: number): string => {
    const cells = row.cells
      .map((cell, cellIndex) => {
        const tag =
          (block.hasColumnHeader && rowIndex === 0) || (block.hasRowHeader && cellIndex === 0)
            ? "th"
            : "td"

        return `<${tag}>${renderRichText(cell, context)}</${tag}>`
      })
      .join("")

    return `<tr>${cells}</tr>`
  }

  const head = block.hasColumnHeader ? `<thead>${renderRow(rows[0]!, 0)}</thead>` : ""
  const bodyStart = block.hasColumnHeader ? 1 : 0
  const body = rows
    .slice(bodyStart)
    .map((row, index) => renderRow(row, index + bodyStart))
    .join("")

  return `<div class="table-wrapper"><table>${head}<tbody>${body}</tbody></table></div>`
}

const renderCallout = (
  block: Extract<ContentBlock, { type: "callout" }>,
  context: RenderContext,
): string => {
  const className =
    block.icon === "💡"
      ? "box-common box-info"
      : block.icon === "♻️"
        ? "box-common box-rewrite"
        : block.icon === "🚨"
          ? "box-common box-alert"
          : "waku-common"
  const icon = block.icon && !["💡", "♻️", "🚨"].includes(block.icon) ? `${block.icon} ` : ""
  // waku-common で ol だけを囲むような、本文を持たないコールアウトでは空の段落を出さない
  const richText = renderRichText(block.richText, context)
  const body = icon || richText ? `<p>${icon}${richText}</p>` : ""

  return `<div class="${className}">${body}${renderChildren(block, context)}</div>`
}

const renderMedia = (
  block: Extract<ContentBlock, { type: "audio" | "video" | "embed" | "bookmark" }>,
  context: RenderContext,
): string => {
  const url = safeUrl(block.url)
  if (!url) {
    return addWarning(context, `不正な ${block.type} URL です（block: ${block.id}）`)
  }

  const escapedUrl = escapeHtml(url)
  const caption = renderRichText(block.caption, context)
  const captionHtml = caption ? `<em>${caption}</em>` : ""

  if (block.type === "audio") {
    return `<p><audio controls preload="none" src="${escapedUrl}"></audio>${captionHtml}</p>`
  }
  if (block.type === "video") {
    const youtubeUrl = new URL(url)
    const youtubeId =
      youtubeUrl.hostname === "youtu.be"
        ? youtubeUrl.pathname.split("/").filter(Boolean).at(0)
        : youtubeUrl.hostname.endsWith("youtube.com")
          ? (youtubeUrl.searchParams.get("v") ??
            youtubeUrl.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1])
          : null
    if (youtubeId) {
      const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`

      return `<div><iframe src="${embedUrl}" loading="lazy" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%;aspect-ratio:16/9;margin:0;border:solid 2.7px var(--color-media-border);border-radius:11px"></iframe>${captionHtml}</div>`
    }

    return `<p><video controls preload="metadata" src="${escapedUrl}"></video>${captionHtml}</p>`
  }
  if (block.type === "embed") {
    const hostname = new URL(url).hostname
    if (
      hostname === "x.com" ||
      hostname.endsWith(".x.com") ||
      hostname === "twitter.com" ||
      hostname.endsWith(".twitter.com")
    ) {
      // 🔴 xAI と KV を使う Static Tweet block の実装時に置き換える
      context.warnings.push(`X ポストの Static Tweet 表示は未実装です（block: ${block.id}）`)

      return `<div class="waku-common"><p>🔴 X ポストの Static Tweet 表示は未実装です</p><p><a href="${escapedUrl}">${escapedUrl}</a></p></div>`
    }

    return `<div><iframe src="${escapedUrl}" loading="lazy" allowfullscreen></iframe>${captionHtml}</div>`
  }

  // 🔴 OGP の取得元とキャッシュ方針を決めたあとに既存 blogcard HTML へ置き換える
  context.warnings.push(`ブックマークの OGP 表示は未実装です（block: ${block.id}）`)

  return `<div class="waku-common"><p>🔴 ブックマークの OGP 表示は未実装です</p><p><a href="${escapedUrl}">${caption || escapedUrl}</a></p></div>`
}

// image ブロックのキャプションは、先頭に `[image …]` のオプショントークンを置ける。
// トークンより後ろが実際のキャプションで、区切りの半角スペース 1 個は取り除く
const splitImageCaption = (
  richText: Array<RichText>,
): { options: Record<string, string>; caption: Array<RichText> } => {
  const first = richText.at(0)
  // 属性値の中の ] を閉じ括弧と間違えないよう、引用符の外にある ] だけを終端とみなす
  const token =
    first?.type === "text" ? first.content.match(/^\[image\b((?:[^\]"]|"[^"]*")*)]( ?)/) : null
  if (!first || !token) {
    return { options: {}, caption: richText }
  }

  const options: Record<string, string> = {}
  for (const match of (token[1] ?? "").matchAll(/([a-zA-Z][\w-]*)\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
    if (match[1] && match[2] !== undefined) {
      options[match[1]] = match[2].replaceAll('\\"', '"')
    }
  }
  const rest = first.content.slice(token[0].length)

  return {
    options,
    caption: rest ? [{ ...first, content: rest }, ...richText.slice(1)] : richText.slice(1),
  }
}

// alt は移行時にファイル名と違うものだけを持ち込んでいるので、残りはファイル名から復元する
const imageAltFromUrl = (url: string): string => {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "")
    return name.replace(/\.[a-z0-9]+$/i, "").replace(/-\d+x\d+$/, "")
  } catch {
    return ""
  }
}

// 画像の実体は mirumi.media の直下に並んでいるのでファイル名から URL を組み立てる
const mediaUrl = (name: string): string | null => {
  return safeUrl(`https://mirumi.media/${encodeURIComponent(name)}`)
}

// クリックするまで iframe を作らない遅延読み込み。実際の差し替えは content-scripts の loadYouTube が行う
const renderDelayedVideo = (attributes: Record<string, string>, context: RenderContext): string => {
  const source = attributes.src ? safeUrl(attributes.src) : null
  if (!source) {
    return addWarning(context, "遅延読み込み動画の src がありません")
  }
  const url = new URL(source)
  if (attributes.ts) {
    url.searchParams.set("start", attributes.ts.replace(/s$/, ""))
  } else {
    url.searchParams.delete("start")
  }
  const thumbnail = attributes.thumbnail ? safeUrl(attributes.thumbnail) : null
  const image = thumbnail
    ? `<img src="${escapeHtml(thumbnail)}" alt="" width="100%" height="auto" loading="lazy">`
    : ""

  return `<div class="youtube" data-video="${escapeHtml(url.href)}">${image}</div>`
}

// 漫画の引用表現。もとの WordPress でも blockquote.img + wp-caption の組み合わせだった
// アプリ紹介カード。属性はすべて移行時に焼き込まれているので外部への問い合わせは不要
const renderApp = (attributes: Record<string, string>, context: RenderContext): string => {
  const icon = attributes.icon ? mediaUrl(attributes.icon) : null
  if (!attributes.name || !icon) {
    return addWarning(context, "アプリカードの name か icon がありません")
  }
  const storeLink = (url: string | undefined, className: string, image: string, label: string) => {
    const safe = url ? safeUrl(url) : null
    return safe
      ? `<a class="${className}" href="${escapeHtml(safe)}" target="_blank" rel="nofollow noopener"><img src="https://nabettu.github.io/appreach/img/${image}" alt="${label}" loading="lazy"></a>`
      : ""
  }
  const detail = [
    attributes.developer
      ? `<span class="appreach__developper">${escapeHtml(attributes.developer)}</span>`
      : "",
    attributes.price ? `<span class="appreach__price">${escapeHtml(attributes.price)}</span>` : "",
  ].join("")

  return `<div class="appreach"><img class="appreach__icon" src="${escapeHtml(icon)}" alt="${escapeHtml(attributes.name)}" loading="lazy"><div class="appreach__detail"><p class="appreach__name">${escapeHtml(attributes.name)}</p><p class="appreach__info">${detail}</p></div><div class="appreach__links">${storeLink(attributes.ios, "appreach__aslink", "as_ja.svg", "App Store")}${storeLink(attributes.android, "appreach__gplink", "gplay_ja.png", "Google Play")}</div></div>`
}

const renderQuoteImage = (attributes: Record<string, string>, context: RenderContext): string => {
  const url = attributes.name ? mediaUrl(attributes.name) : null
  if (!url) {
    return addWarning(context, "引用画像の name がありません")
  }
  const copyright = attributes.copyright
    ? `<p class="wp-caption-text">${escapeHtml(attributes.copyright)}</p>`
    : ""

  return `<blockquote class="img"><div class="wp-caption"><img src="${escapeHtml(url)}" alt="${escapeHtml(attributes.copyright ?? "")}" loading="lazy">${copyright}</div></blockquote>`
}

// ボタンは WordPress 時代から常に中央寄せの段落に置かれていた（実データ 56 件すべて）ので、
// 配置はショートコードの指定ではなくレンダリング側の既定として持つ
const BUTTON_COLORS = new Set([
  "brown",
  "cyan",
  "deep-orange",
  "green",
  "indigo",
  "light-blue",
  "light-green",
  "orange",
  "purple",
  "red",
])

const renderButton = (attributes: Record<string, string>, context: RenderContext): string => {
  const url = attributes.url ? safeUrl(attributes.url) : null
  if (!url || !attributes.text) {
    return addWarning(context, "ボタンの url か text がありません")
  }
  const color = attributes.color ?? ""
  if (color && !BUTTON_COLORS.has(color)) {
    context.warnings.push(`未対応のボタン色です: ${color}`)
  }
  const colorClass = BUTTON_COLORS.has(color) ? ` btn-wrap-${color}` : ""

  return `<p style="text-align:center"><span class="btn-wrap${colorClass} btn-wrap-m"><a href="${escapeHtml(url)}">${escapeHtml(attributes.text)}</a></span></p>`
}

const shortcodeAttributes = (value: string): Record<string, string> => {
  const attributes: Record<string, string> = {}
  for (const match of value.matchAll(/([a-zA-Z][\w-]*)\s*=\s*&quot;(.*?)&quot;/g)) {
    if (match[1] && match[2] !== undefined) {
      attributes[match[1]] = match[2]
    }
  }

  return attributes
}

const renderBlock = (block: ContentBlock, context: RenderContext): string => {
  switch (block.type) {
    case "paragraph": {
      const plainText = block.richText.map((item) => item.content).join("")
      // image は renderInlineImages が解決するので、未確定の警告対象から外す
      const shortcode = plainText.trim().match(/^\[(amazon|button|app|video|quoteImage)\b/)
      if (
        shortcode?.[1] === "button" ||
        shortcode?.[1] === "video" ||
        shortcode?.[1] === "quoteImage" ||
        shortcode?.[1] === "app"
      ) {
        const body = renderRichText(block.richText, context).trim()
        const attributes = shortcodeAttributes(body)
        if (shortcode[1] === "button") {
          return renderButton(attributes, context)
        }
        if (shortcode[1] === "quoteImage") {
          return renderQuoteImage(attributes, context)
        }
        if (shortcode[1] === "app") {
          return renderApp(attributes, context)
        }
        return renderDelayedVideo(attributes, context)
      }
      if (shortcode) {
        // 🔴 各ショートコードの属性仕様が確定したものから専用 HTML へ置き換える
        return addWarning(
          context,
          `${shortcode[1]} ショートコードの HTML 変換は未確定です（block: ${block.id}）`,
        )
      }

      const content = renderRichText(block.richText, context) || "<br>"

      return `<p>${content}</p>${renderChildren(block, context)}`
    }
    case "heading":
      return renderHeading(block, context)
    case "quote": {
      // 2 段落目以降は children として <p> で来るので、先頭も <p> で包んで構造を揃える
      const richText = renderRichText(block.richText, context)

      return `<blockquote>${richText ? `<p>${richText}</p>` : ""}${renderChildren(block, context)}</blockquote>`
    }
    case "callout":
      return renderCallout(block, context)
    case "code": {
      const language = block.language.replaceAll(/[^a-zA-Z0-9_-]/g, "-")
      const caption = renderRichText(block.caption, context)

      return `<pre><code class="language-${language}">${escapeHtml(block.richText.map((item) => item.content).join(""))}</code></pre>${caption ? `<p class="micro-bottom">${caption}</p>` : ""}`
    }
    case "image": {
      const url = safeUrl(block.url)
      if (!url) {
        return addWarning(context, `不正な画像 URL です（block: ${block.id}）`)
      }

      const { options, caption } = splitImageCaption(block.caption)
      const captionHtml = renderRichText(caption, context)
      const alt = options.alt ?? imageAltFromUrl(url)
      const unknown = Object.keys(options).filter(
        (name) => !["alt", "width", "align"].includes(name),
      )
      if (0 < unknown.length) {
        context.warnings.push(
          `未対応の画像オプションです: ${unknown.join(", ")}（block: ${block.id}）`,
        )
      }
      // 幅は元の指定をそのまま通す。alignnone は左寄せ、それ以外は既定の中央のまま
      const style = options.width ? ` style="width:${escapeHtml(options.width)}"` : ""
      const className = options.align === "none" ? ' class="alignnone"' : ""

      return `<div class="wp-caption"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${className}${style} loading="lazy">${captionHtml ? `<p class="wp-caption-text">${captionHtml}</p>` : ""}</div>`
    }
    case "audio":
    case "video":
    case "embed":
    case "bookmark":
      return renderMedia(block, context)
    case "divider":
      return "<hr>"
    case "table":
      return renderTable(block, context)
    case "table_row":
      return addWarning(context, `テーブル外に行があります（block: ${block.id}）`)
    case "container":
      return renderChildren(block, context)
    case "unsupported":
      return `${addWarning(context, `未対応の Notion ブロックです: ${block.originalType}（block: ${block.id}）`)}${block.richText.length === 0 ? "" : `<p>${renderRichText(block.richText, context)}</p>`}${renderChildren(block, context)}`
    case "bulleted_list_item":
    case "numbered_list_item":
      return ""
  }
}

const renderBlocks = (blocks: Array<ContentBlock>, context: RenderContext): string => {
  let html = ""
  let index = 0

  while (index < blocks.length) {
    const block = blocks[index]
    if (!block) {
      index += 1
      continue
    }

    if (block.type === "bulleted_list_item" || block.type === "numbered_list_item") {
      const list = renderList(blocks, index, context)
      html += list.html
      index = list.next
      continue
    }

    html += renderBlock(block, context)
    index += 1
  }

  return html
}

const collectHeadings = (blocks: Array<ContentBlock>): Array<HeadingBlock> => {
  const headings: Array<HeadingBlock> = []

  for (const block of blocks) {
    if (block.type === "heading") {
      headings.push(block)
    }
    headings.push(...collectHeadings(block.children))
  }

  return headings
}

const renderToc = (article: ArticleContent, context: RenderContext): string => {
  if (article.toc.hidden) {
    return ""
  }

  const headings = collectHeadings(article.blocks)
  if (headings.length < 2) {
    return ""
  }

  const minimumLevel = Math.min(...headings.map((heading) => heading.level))
  let depth = 0
  let html = '<ul class="toc-list">'

  headings.forEach((heading, index) => {
    const requestedDepth = Math.max(0, heading.level - minimumLevel)
    const targetDepth = Math.min(requestedDepth, depth + 1)
    const link = `<a href="#${headingId(heading.id)}">${escapeHtml(heading.richText.map((item) => item.content).join(""))}</a>`

    if (index === 0) {
      html += `<li>${link}`
      return
    }
    if (targetDepth === depth) {
      html += `</li><li>${link}`
      return
    }
    if (targetDepth > depth) {
      html += `<ul><li>${link}`
      depth += 1
      return
    }

    html += "</li>"
    while (targetDepth < depth) {
      html += "</ul></li>"
      depth -= 1
    }
    html += `<li>${link}`
  })

  html += "</li>"
  while (0 < depth) {
    html += "</ul></li>"
    depth -= 1
  }
  html += "</ul>"

  const tocId = `toc-${article.id.replaceAll("-", "").slice(-8)}`
  const checked = article.toc.closed ? "" : " checked"

  return `<div class="toc"><input id="${tocId}" class="toc-checkbox" type="checkbox"${checked}><label class="toc-title" for="${tocId}">もくじ</label><div class="toc-content">${html}</div></div>`
}

export const renderArticleContent = (article: ArticleContent): RenderedContent => {
  const context: RenderContext = { warnings: [] }
  const body = renderBlocks(article.blocks, context)
  const toc = renderToc(article, context)
  const firstHeadingIndex = body.search(/<h[1-6]\b/)
  const html =
    toc && 0 <= firstHeadingIndex
      ? `${body.slice(0, firstHeadingIndex)}${toc}${body.slice(firstHeadingIndex)}`
      : `${toc}${body}`

  return { html, warnings: context.warnings }
}
