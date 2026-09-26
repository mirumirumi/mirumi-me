import { describe, expect, test } from "vitest"

import type { ArticleContent, ContentBlock, RichText } from "./content"
import { renderArticleContent } from "./render"

const text = (content: string, overrides: Partial<RichText> = {}): RichText => ({
  type: "text",
  content,
  href: null,
  annotations: {
    bold: false,
    italic: false,
    strikethrough: false,
    underline: false,
    code: false,
    color: "default",
  },
  ...overrides,
})

const article = (blocks: Array<ContentBlock>): ArticleContent => ({
  id: "00000000-0000-0000-0000-123456789abc",
  title: "テスト記事",
  slug: "test",
  thumbnailUrl: null,
  thumbnailName: null,
  publishedAt: "2026-08-14",
  updatedAt: null,
  category: null,
  customCss: "",
  toc: { hidden: false, closed: false },
  blocks,
})

describe("renderArticleContent", () => {
  test("本文をエスケープしつつ装飾とリンクを既存 HTML に変換する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "paragraph",
          type: "paragraph",
          richText: [
            text("<script>"),
            text("link", {
              href: "https://example.com/?a=1&b=2",
              annotations: {
                bold: true,
                italic: false,
                strikethrough: false,
                underline: false,
                code: false,
                color: "red",
              },
            }),
          ],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain("&lt;script&gt;")
    expect(result.html).toContain(
      '<a href="https://example.com/?a=1&amp;b=2"><span class="color-red"><strong>link</strong></span></a>',
    )
    expect(result.html).not.toContain("<script>")
    expect(result.warnings).toEqual([])
  })

  test("インライン数式を文字サイズ・上付き・下付きに戻す", () => {
    const result = renderArticleContent(
      article([
        {
          id: "equation",
          type: "paragraph",
          richText: [
            text("{\\Large\\text{大}}", { type: "equation" }),
            text("^{2}", { type: "equation" }),
            text("_{i=1}", { type: "equation" }),
          ],
          children: [],
        },
      ]),
    )

    expect(result.html).toEqual(
      '<p><span style="font-size:1.5em">大</span><sup>2</sup><sub>i=1</sub></p>',
    )
    expect(result.warnings).toEqual([])
  })

  test("画像の alt をオプショントークンかファイル名から決める", () => {
    const result = renderArticleContent(
      article([
        {
          id: "plain",
          type: "image",
          url: "https://mirumi.media/my-cats-1999x1124.png",
          caption: [],
          children: [],
        },
        {
          id: "authored",
          type: "image",
          url: "https://mirumi.media/246310.png",
          caption: [text('[image alt="タグ編集の例"] 説明文')],
          children: [],
        },
        {
          id: "canonical",
          type: "image",
          url: "https://mirumi.media/0123456789abcdef-screen-shot-1600x900-1600w.webp",
          caption: [],
          children: [],
        },
        {
          id: "canonical-animation",
          type: "image",
          url: "https://mirumi.media/0123456789abcdef-dancing-cat-480x270.gif",
          caption: [],
          children: [],
        },
      ]),
    )

    // トークンがなければファイル名から復元する
    expect(result.html).toContain('alt="my-cats"')
    expect(result.html).toContain('alt="screen-shot"')
    expect(result.html).toContain('alt="dancing-cat"')
    // トークンの alt が優先され、トークン部分はキャプションから取り除かれる
    expect(result.html).toContain('alt="タグ編集の例"')
    expect(result.html).toContain('<p class="wp-caption-text">説明文</p>')
    expect(result.html).not.toContain("[image")
    expect(result.warnings).toEqual([])
  })

  test("段落の途中にあるインライン画像の shortcode を img に解決する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "inline",
          type: "paragraph",
          richText: [text('前[image name="vscode.png" align="none"]後')],
          children: [],
        },
        {
          id: "listed",
          type: "bulleted_list_item",
          richText: [text('[image name="246310.png" alt="タグ編集の例"] 説明')],
          children: [],
        },
        {
          id: "canonical-inline",
          type: "paragraph",
          richText: [text('[image name="0123456789abcdef-inline-image-1200x675-1200w.webp"]')],
          children: [],
        },
      ]),
    )

    // 左寄せの指定は文章の流れに残すため alignnone として出す
    expect(result.html).toContain(
      '前<img src="https://mirumi.media/vscode.png" alt="vscode" class="alignnone" loading="lazy">後',
    )
    // 段落以外のブロックでも解決し、alt があればそれを使う
    expect(result.html).toContain(
      '<li><img src="https://mirumi.media/246310.png" alt="タグ編集の例" loading="lazy"> 説明</li>',
    )
    // canonical な名前なら画像セットの寸法を width / height に出す
    expect(result.html).toContain(
      '<img src="https://mirumi.media/0123456789abcdef-inline-image-1200x675-1200w.webp" alt="inline-image" width="1200" height="675" loading="lazy">',
    )
    expect(result.html).not.toContain("[image")
    expect(result.warnings).toEqual([])
  })

  test("インライン画像の shortcode にある幅と左寄せを反映する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "inline-left",
          type: "paragraph",
          richText: [
            text(
              '[image name="0123456789abcdef-icon-64x64-64w.webp" width="32px" align="none"]アイコンの説明',
            ),
          ],
          children: [],
        },
      ]),
    )

    // alignnone がないと本文 CSS の display: block で文章から切り離され、中央に 1 行ぶん居座ってしまう
    expect(result.html).toContain(
      '<p><img src="https://mirumi.media/0123456789abcdef-icon-64x64-64w.webp" alt="icon" width="64" height="64" class="alignnone" style="width:32px" loading="lazy">アイコンの説明</p>',
    )
    expect(result.warnings).toEqual([])
  })

  test("出力できないリンクは本文を残したうえで警告にする", () => {
    const result = renderArticleContent(
      article([
        {
          id: "relative",
          type: "paragraph",
          richText: [text("相対", { href: "/profile" }), text("メール", { href: "mailto:a@b.co" })],
          children: [],
        },
      ]),
    )

    // リンクは張れないがテキストは消さない
    expect(result.html).toContain("<p>相対メール</p>")
    expect(result.html).not.toContain("<a ")
    expect(result.warnings).toEqual([
      "リンクを出力できませんでした。相対パスや http/https 以外の URL は使えません: /profile",
      "リンクを出力できませんでした。相対パスや http/https 以外の URL は使えません: mailto:a@b.co",
    ])
  })

  test("ボタンを中央寄せの段落として既存のクラスで生成する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "button",
          type: "paragraph",
          richText: [
            text(
              '[button text="購入 & 確認" url="https://example.com/buy?item=1&from=blog" color="orange"]',
            ),
          ],
          children: [],
        },
        {
          id: "unknown-color",
          type: "paragraph",
          richText: [text('[button text="go" url="https://example.com/" color="magenta"]')],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain(
      '<p style="text-align:center"><span class="btn-wrap btn-wrap-orange btn-wrap-m"><a href="https://example.com/buy?item=1&amp;from=blog">購入 &amp; 確認</a></span></p>',
    )
    expect(result.html).not.toContain("&amp;amp;")
    // 知らない色は無視して既定の見た目にするが、気づけるよう警告は残す
    expect(result.html).toContain('<span class="btn-wrap btn-wrap-m">')
    expect(result.warnings).toEqual(["未対応のボタン色です: magenta"])
  })

  test("遅延読み込み動画と引用画像のショートコードを HTML にする", () => {
    const result = renderArticleContent(
      article([
        {
          id: "video",
          type: "paragraph",
          richText: [
            text(
              '[video delay src="https://www.youtube.com/embed/abc?start=" thumbnail="https://mirumi.media/t.jpg" ts="23s"]',
            ),
          ],
          children: [],
        },
        {
          id: "quote",
          type: "paragraph",
          richText: [text('[quoteImage name="beji-ta.jpg" copyright="©集英社"]')],
          children: [],
        },
        {
          id: "canonical-quote",
          type: "paragraph",
          richText: [
            text(
              '[quoteImage name="0123456789abcdef-comic-1200x1697-1200w.webp" copyright="©講談社" width="415px"]',
            ),
          ],
          children: [],
        },
      ]),
    )

    // クリックで iframe に差し替えるため data-video を持たせ、ts は start に反映する
    expect(result.html).toContain(
      '<div class="youtube" data-video="https://www.youtube.com/embed/abc?start=23">',
    )
    expect(result.html).toContain('<img src="https://mirumi.media/t.jpg"')
    expect(result.html).toContain(
      '<blockquote class="img"><div class="wp-caption"><img src="https://mirumi.media/beji-ta.jpg" alt="©集英社" loading="lazy"><p class="wp-caption-text">©集英社</p></div></blockquote>',
    )
    expect(result.html).toContain(
      '<img src="https://mirumi.media/0123456789abcdef-comic-1200x1697-1200w.webp" alt="©講談社" width="1200" height="1697" style="width:415px" loading="lazy">',
    )
    expect(result.warnings).toEqual([])
  })

  test("画像のオプションから幅と配置を反映する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "sized",
          type: "image",
          url: "https://mirumi.media/a.png",
          caption: [text('[image width="91%" align="none"] 説明')],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain(
      '<img src="https://mirumi.media/a.png" alt="a" class="alignnone" style="width:91%" loading="lazy">',
    )
    expect(result.html).toContain('<p class="wp-caption-text">説明</p>')
    expect(result.warnings).toEqual([])
  })

  test("canonical 本文画像には width と height と srcset と sizes を付ける", () => {
    const result = renderArticleContent(
      article([
        {
          id: "00000000-0000-0000-0000-000000000001",
          type: "image",
          url: "https://mirumi.media/0123456789abcdef-screenshot-1600x900-1600w.webp",
          caption: [],
          children: [],
        },
      ]),
    )

    // width がないと srcset の w 記述子と sizes から 785px 相当に引き伸ばされるので、小さい画像ほど必須
    expect(result.html).toContain(
      '<img src="https://mirumi.media/0123456789abcdef-screenshot-1600x900-1600w.webp" alt="screenshot" width="1600" height="900" srcset=',
    )
    expect(result.html).toContain(
      'srcset="https://mirumi.media/0123456789abcdef-screenshot-1600x900-800w.webp 800w, https://mirumi.media/0123456789abcdef-screenshot-1600x900-1200w.webp 1200w, https://mirumi.media/0123456789abcdef-screenshot-1600x900-1600w.webp 1600w"',
    )
    expect(result.html).toContain(
      'sizes="(max-width: 428px) calc(100vw - 54px), (max-width: 829px) calc(100vw - 44px), 785px"',
    )
  })

  test("canonical animation には width と height だけを付ける", () => {
    const result = renderArticleContent(
      article([
        {
          id: "animation",
          type: "image",
          url: "https://mirumi.media/0123456789abcdef-dancing-cat-480x270.gif",
          caption: [],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain(
      '<img src="https://mirumi.media/0123456789abcdef-dancing-cat-480x270.gif" alt="dancing-cat" width="480" height="270" loading="lazy">',
    )
  })

  test("幅の指定がある canonical 画像も width と height を併記して縦横比を保つ", () => {
    const result = renderArticleContent(
      article([
        {
          id: "sized-canonical",
          type: "image",
          url: "https://mirumi.media/0123456789abcdef-icon-256x100-256w.webp",
          caption: [text('[image width="120px" align="none"]')],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain(
      '<img src="https://mirumi.media/0123456789abcdef-icon-256x100-256w.webp" alt="icon" width="256" height="100" srcset="https://mirumi.media/0123456789abcdef-icon-256x100-256w.webp 256w" sizes="(max-width: 428px) calc(100vw - 54px), (max-width: 829px) calc(100vw - 44px), 785px" class="alignnone" style="width:120px" loading="lazy">',
    )
  })

  test("追記ブロックの日付の書き出しを rewrite-date として復元する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "rewrite",
          type: "callout",
          icon: "♻️",
          richText: [text("追記 (2020/5/21) ：衝撃的なこと言います。")],
          children: [
            {
              id: "second",
              type: "paragraph",
              richText: [text("追記 (2022/12/21) ：前回の追記から 2 年半。")],
              children: [],
            },
            {
              id: "body",
              type: "paragraph",
              richText: [text("追記ではない普通の段落。")],
              children: [],
            },
          ],
        },
        {
          id: "info",
          type: "callout",
          icon: "💡",
          richText: [text("追記 (2020/5/21) ：これは追記ブロックではない。")],
          children: [],
        },
      ]),
    )

    // ひとつの追記ブロックに複数の追記があっても、子の段落まで拾う
    expect(result.html).toContain(
      '<p><span class="rewrite-date">追記 (2020/5/21) ：</span>衝撃的なこと言います。</p>',
    )
    expect(result.html).toContain(
      '<p><span class="rewrite-date">追記 (2022/12/21) ：</span>前回の追記から 2 年半。</p>',
    )
    // 書き出しが合わない段落と、追記ブロック以外は触らない
    expect(result.html).toContain("<p>追記ではない普通の段落。</p>")
    expect(result.html).toContain("<p>追記 (2020/5/21) ：これは追記ブロックではない。</p>")
  })

  test("引用の先頭段落を p で包み、本文のないコールアウトに空の段落を出さない", () => {
    const result = renderArticleContent(
      article([
        {
          id: "quote",
          type: "quote",
          richText: [text("一段落目")],
          children: [
            { id: "quote-2", type: "paragraph", richText: [text("二段落目")], children: [] },
          ],
        },
        {
          id: "callout",
          type: "callout",
          icon: null,
          richText: [],
          children: [
            { id: "item", type: "numbered_list_item", richText: [text("項目")], children: [] },
          ],
        },
      ]),
    )

    expect(result.html).toContain("<blockquote><p>一段落目</p><p>二段落目</p></blockquote>")
    expect(result.html).toContain('<div class="waku-common"><ol><li>項目</li></ol></div>')
    expect(result.html).not.toContain("<p></p>")
  })

  test("見出し ID と開いた状態のもくじを最初の見出し直前に生成する", () => {
    const result = renderArticleContent(
      article([
        { id: "intro", type: "paragraph", richText: [text("導入")], children: [] },
        {
          id: "00000000-0000-0000-0000-aaaaaaaaaaaa",
          type: "heading",
          level: 1,
          richText: [text("章")],
          children: [],
        },
        {
          id: "00000000-0000-0000-0000-bbbbbbbbbbbb",
          type: "heading",
          level: 2,
          richText: [text("節")],
          children: [],
        },
      ]),
    )

    expect(result.html.indexOf("導入")).toBeLessThan(result.html.indexOf('class="toc"'))
    expect(result.html.indexOf('class="toc"')).toBeLessThan(result.html.indexOf("<h1"))
    // Block ID の末尾を base64url にした 7 文字。Notion の ID は先頭が作成時刻で衝突するため
    expect(result.html).toContain('<h1 id="h-qqqqqqg-heading">')
    expect(result.html).toContain('<h2 id="h-7u7u7uw-heading">')
    expect(result.html).toContain('href="#h-7u7u7uw"')
    expect(result.html).toContain('class="toc-checkbox" type="checkbox" checked')
  })

  test("連続するリストと子リストをひとつのリストとして生成する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "list-1",
          type: "bulleted_list_item",
          richText: [text("one")],
          children: [
            {
              id: "nested",
              type: "numbered_list_item",
              richText: [text("nested")],
              children: [],
            },
          ],
        },
        {
          id: "list-2",
          type: "bulleted_list_item",
          richText: [text("two")],
          children: [],
        },
      ]),
    )

    expect(result.html).toEqual("<ul><li>one<ol><li>nested</li></ol></li><li>two</li></ul>")
  })

  test("Amazon shortcode を署名付きの静的 fallback card にする", () => {
    const result = renderArticleContent(
      article([
        {
          id: "amazon",
          type: "paragraph",
          richText: [
            text('[amazon asin="B000000000" kw="検索語" title="API 取得失敗時の商品名" size="l"]'),
          ],
          children: [],
        },
      ]),
      { amazonCardSignatures: { B000000000: "signed-value" } },
    )

    expect(result.html).toContain('class="amazon-item-box product-item-box')
    expect(result.html).toContain('data-amazon-asin="B000000000"')
    expect(result.html).toContain('data-amazon-signature="signed-value"')
    expect(result.html).toContain('data-amazon-title href="https://www.amazon.co.jp/dp/B000000000')
    expect(result.html).toContain("API 取得失敗時の商品名")
    expect(result.html).toContain('class="shoplinkrakuten"')
    expect(result.html).toContain('class="shoplinkyahoo"')
    expect(result.html).not.toContain('size="l"')
    expect(result.warnings).toEqual([])
  })

  test("Amazon shortcode の必須属性不正と署名欠落を警告にする", () => {
    const result = renderArticleContent(
      article([
        {
          id: "invalid-amazon",
          type: "paragraph",
          richText: [text('[amazon asin="invalid"]')],
          children: [],
        },
        {
          id: "incomplete-amazon",
          type: "paragraph",
          richText: [text('[amazon asin="B000000000"]')],
          children: [],
        },
        {
          id: "unsigned-amazon",
          type: "paragraph",
          richText: [text('[amazon asin="B000000001" kw="検索語" title="fallback 商品名"]')],
          children: [],
        },
      ]),
    )

    expect(result.html.match(/🚨/g)).toHaveLength(3)
    expect(result.warnings).toEqual([
      "Amazon ショートコードの asin、kw、title が不正です",
      "Amazon ショートコードの asin、kw、title が不正です",
      "Amazon card の署名がありません（ASIN: B000000001）",
    ])
  })

  test("ローカル開発では署名なしでも Amazon の静的 fallback card を表示する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "unsigned-amazon",
          type: "paragraph",
          richText: [text('[amazon asin="B000000001" kw="検索語" title="fallback 商品名"]')],
          children: [],
        },
      ]),
      { amazonCardSignatures: {}, allowUnsignedAmazonCards: true },
    )

    expect(result.html).toContain("amazon-item-box")
    expect(result.html).toContain("fallback 商品名")
    expect(result.html).not.toContain("data-amazon-signature")
    expect(result.warnings).toEqual([])
  })

  test("未確定・未対応の表現を警告付きで可視化する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "unsupported",
          type: "unsupported",
          originalType: "button",
          richText: [],
          children: [],
        },
        {
          id: "bookmark",
          type: "bookmark",
          url: "https://example.com/",
          caption: [],
          children: [],
        },
      ]),
    )

    expect(result.html.match(/🚨/g)).toHaveLength(2)
    expect(result.warnings).toHaveLength(2)
  })

  test("YouTube は iframe にし、未解決の X ポストはリンクと警告を表示する", () => {
    const result = renderArticleContent(
      article([
        {
          id: "youtube",
          type: "video",
          url: "https://www.youtube.com/watch?v=abcdefghijk",
          caption: [],
          children: [],
        },
        {
          id: "x-post",
          type: "embed",
          url: "https://x.com/__mirumi__/status/123",
          caption: [],
          children: [],
        },
      ]),
    )

    expect(result.html).toContain("https://www.youtube-nocookie.com/embed/abcdefghijk")
    expect(result.html).not.toContain('<video controls preload="metadata"')
    expect(result.html).toContain("🚨 X ポストを解決できませんでした")
    expect(result.warnings).toEqual(["X ポストを解決できませんでした（block: x-post）"])
  })

  test("解決済み Bookmark と X ポストを既存 class の card にする", () => {
    const blocks = [
      {
        id: "bookmark",
        type: "bookmark" as const,
        url: "https://example.com/article",
        caption: [],
        children: [],
      },
      {
        id: "x-post",
        type: "embed" as const,
        url: "https://x.com/__mirumi__/status/123",
        caption: [],
        children: [],
      },
    ]
    const result = renderArticleContent(article(blocks), {
      amazonCardSignatures: {},
      bookmarks: {
        bookmark: {
          kind: "external",
          url: "https://example.com/article",
          title: "外部記事",
          description: "説明",
          imageUrl: "https://example.com/image.png",
          faviconUrl: "https://example.com/favicon.ico",
          label: "example.com",
        },
      },
      xPosts: {
        "x-post": {
          postId: "123",
          url: "https://x.com/__mirumi__/status/123",
          text: "投稿本文",
          authorName: "みるみ",
          authorHandle: "__mirumi__",
          avatarUrl: null,
          mediaUrls: [],
          replyCount: null,
          repostCount: null,
          likeCount: null,
          linkCard: null,
          createdAt: "2026-08-24T00:00:00.000Z",
        },
      },
    })

    expect(result.html).toContain('<a class="blogcard external"')
    expect(result.html).toContain(
      '<div class="footer"><div class="favicon"><img src="https://example.com/favicon.ico" alt="example.com" loading="lazy"></div><div class="domain">example.com</div></div>',
    )
    expect(result.html).toContain('<div class="static_tweet">')
    expect(result.warnings).toEqual([])
  })

  test("X ポストのアイコン・添付画像・カウント・リンクカードを出す", () => {
    const result = renderArticleContent(
      article([
        {
          id: "x-post",
          type: "embed" as const,
          url: "https://x.com/__mirumi__/status/123",
          caption: [],
          children: [],
        },
      ]),
      {
        amazonCardSignatures: {},
        xPosts: {
          "x-post": {
            postId: "123",
            url: "https://x.com/__mirumi__/status/123",
            text: "投稿本文",
            authorName: "みるみ",
            authorHandle: "__mirumi__",
            avatarUrl: "https://pbs.twimg.com/profile_images/1/icon.jpg",
            mediaUrls: ["https://pbs.twimg.com/media/abc.jpg"],
            replyCount: 14,
            repostCount: 13684,
            likeCount: 10516,
            linkCard: {
              url: "https://example.com/",
              title: "リンク先",
              description: "説明",
              imageUrl: "https://example.com/ogp.png",
            },
            createdAt: "2026-08-24T00:00:00.000Z",
          },
        },
      },
    )

    expect(result.html).toContain(
      '<div class="icon"><img src="https://pbs.twimg.com/profile_images/1/icon.jpg" alt="" width="49" height="49" loading="lazy"></div>',
    )
    expect(result.html).toContain('<div class="x_icon"></div>')
    expect(result.html).toContain('<div class="link_card">')
    expect(result.html).toContain('<div class="media_wrap">')
    expect(result.html).toContain(
      '<div class="reply">14</div><div class="retweet">13,684</div><div class="like">10,516</div>',
    )
    expect(result.warnings).toEqual([])
  })

  test("X ポストの URL とハッシュタグは色だけ付け、末尾の URL は card になったら落とす", () => {
    const render = (text: string, linkCard: boolean) =>
      renderArticleContent(
        article([
          {
            id: "x-post",
            type: "embed" as const,
            url: "https://x.com/__mirumi__/status/123",
            caption: [],
            children: [],
          },
        ]),
        {
          amazonCardSignatures: {},
          xPosts: {
            "x-post": {
              postId: "123",
              url: "https://x.com/__mirumi__/status/123",
              text,
              authorName: "みるみ",
              authorHandle: "__mirumi__",
              avatarUrl: null,
              mediaUrls: [],
              replyCount: null,
              repostCount: null,
              likeCount: null,
              linkCard: linkCard
                ? {
                    url: "https://example.com/site/",
                    title: "リンク先",
                    description: null,
                    imageUrl: null,
                  }
                : null,
              createdAt: null,
            },
          },
        },
      ).html

    // 末尾の URL は card になっているので落とし、#タグと @メンションは色だけ付ける
    expect(render("告知です #SHAXV @__mirumi__\nhttps://example.com/site/", true)).toContain(
      '<div class="body">告知です <span class="link_text">#SHAXV</span> <span class="link_text">@__mirumi__</span><div class="link_card">',
    )
    // 末尾でなければ残し、表示は scheme を落として短くする
    expect(render("詳細は https://example.com/site/ をどうぞ", true)).toContain(
      '<span class="link_text">example.com/site</span>',
    )
    // card が無ければ末尾の URL も残す
    expect(render("詳細は https://t.co/PisKzAC0ur", false)).toContain(
      '<span class="link_text">t.co/PisKzAC0ur</span>',
    )
  })

  test("内部 Bookmark の footer をカテゴリ名の folder アイコン付きにする", () => {
    const result = renderArticleContent(
      article([
        {
          id: "bookmark",
          type: "bookmark" as const,
          url: "https://mirumi.me/vivaldi/",
          caption: [],
          children: [],
        },
      ]),
      {
        amazonCardSignatures: {},
        bookmarks: {
          bookmark: {
            kind: "internal",
            url: "https://mirumi.me/vivaldi/",
            title: "内部記事",
            description: null,
            imageUrl: null,
            faviconUrl: null,
            label: "PC",
          },
        },
      },
    )
    expect(result.html).toContain(
      '<div class="footer"><div class="category"><span>PC</span></div></div>',
    )
    expect(result.html).toContain('<div class="blogcard">')
    expect(result.warnings).toEqual([])
  })

  test("GitHub の外部 Bookmark は thumbnail に crop 防止の class を付ける", () => {
    const result = renderArticleContent(
      article([
        {
          id: "bookmark",
          type: "bookmark" as const,
          url: "https://github.com/mirumirumi/mirumi-me",
          caption: [],
          children: [],
        },
      ]),
      {
        amazonCardSignatures: {},
        bookmarks: {
          bookmark: {
            kind: "external",
            url: "https://github.com/mirumirumi/mirumi-me",
            title: "リポジトリ",
            description: null,
            imageUrl: "https://opengraph.githubassets.com/abc/mirumirumi/mirumi-me",
            faviconUrl: "https://github.com/favicon.ico",
            label: "github.com",
          },
        },
      },
    )

    expect(result.html).toContain('<div class="thumbnail github">')
    expect(result.warnings).toEqual([])
  })

  test("カテゴリのない固定ページ宛の内部 Bookmark は footer を隠す class を付ける", () => {
    const result = renderArticleContent(
      article([
        {
          id: "bookmark",
          type: "bookmark" as const,
          url: "https://mirumi.me/profile/",
          caption: [],
          children: [],
        },
      ]),
      {
        amazonCardSignatures: {},
        bookmarks: {
          bookmark: {
            kind: "internal",
            url: "https://mirumi.me/profile/",
            title: "固定ページ",
            description: null,
            imageUrl: null,
            faviconUrl: null,
            label: "",
          },
        },
      },
    )
    expect(result.html).toContain('<div class="blogcard page">')
    expect(result.warnings).toEqual([])
  })
})
