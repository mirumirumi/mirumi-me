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

  for (const { prefix, size } of fontSizes) {
    if (expression.startsWith(prefix) && expression.endsWith("}}")) {
      const content = expression.slice(prefix.length, -2)

      return `<span style="font-size:${size}">${escapeHtml(content)}</span>`
    }
  }

  if (expression.startsWith("^{") && expression.endsWith("}")) {
    return `<sup>${escapeHtml(expression.slice(2, -1))}</sup>`
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
  }

  return html
}

const renderRichText = (richText: Array<RichText>, context: RenderContext): string => {
  return richText.map((item) => renderRichTextItem(item, context)).join("")
}

const renderChildren = (block: ContentBlock, context: RenderContext): string => {
  if (block.children.length === 0) {
    return ""
  }

  return renderBlocks(block.children, context)
}

const headingId = (blockId: string): string => {
  return `h-${blockId.replaceAll("-", "").slice(-8)}`
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

  return `<div class="${className}"><p>${icon}${renderRichText(block.richText, context)}</p>${renderChildren(block, context)}</div>`
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

const renderBlock = (block: ContentBlock, context: RenderContext): string => {
  switch (block.type) {
    case "paragraph": {
      const plainText = block.richText.map((item) => item.content).join("")
      const shortcode = plainText.trim().match(/^\[(button|app|video|image|quoteImage)\b/)
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
    case "quote":
      return `<blockquote>${renderRichText(block.richText, context)}${renderChildren(block, context)}</blockquote>`
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

      const caption = renderRichText(block.caption, context)

      return `<div class="wp-caption"><img src="${escapeHtml(url)}" alt="${escapeHtml(block.caption.map((item) => item.content).join(""))}" loading="lazy">${caption ? `<p class="wp-caption-text">${caption}</p>` : ""}</div>`
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
