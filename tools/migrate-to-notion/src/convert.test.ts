import type { BlockObjectRequest } from "@notionhq/client"
import { describe, expect, test } from "vitest"

import { CATEGORY_PAGE_IDS, PAGES_DATA_SOURCE_ID, POSTS_DATA_SOURCE_ID } from "./config"
import { convertWordPressContent } from "./convert"
import type { WordPressContentRecord } from "./types"

const makeRecord = (
  content: string,
  overrides: Partial<WordPressContentRecord> = {},
): WordPressContentRecord => {
  return {
    id: 123,
    postType: "post",
    postDate: "2024-01-02 03:04:05",
    postModified: "2024-02-03 04:05:06",
    slug: "sample-post",
    title: "サンプル記事",
    excerpt: "",
    content,
    categories: [{ name: "技術", slug: "tech" }],
    thumbnailUrl: "https://mirumi.media/sample.jpg",
    showThumbnailOnFrontend: true,
    tocHidden: true,
    tocClosed: false,
    ...overrides,
  }
}

const blockType = (block: BlockObjectRequest): string => {
  return block.type ?? "unknown"
}

describe("convertWordPressContent", () => {
  test("WordPress のメタデータと埋め込み CSS を Notion のプロパティへ変換する", () => {
    const converted = convertWordPressContent(
      makeRecord("<style>.sample { color: red; }</style><p>本文</p>"),
    )

    expect(converted.sourceId).toEqual(123)
    expect(converted.slug).toEqual("sample-post")
    expect(converted.parent).toEqual({
      type: "data_source_id",
      data_source_id: POSTS_DATA_SOURCE_ID,
    })
    expect(converted.properties.title).toEqual({
      type: "title",
      title: [{ type: "text", text: { content: "サンプル記事" } }],
    })
    expect(converted.properties.slug).toEqual({
      type: "rich_text",
      rich_text: [{ type: "text", text: { content: "sample-post" } }],
    })
    expect(converted.properties["internal-state"]).toEqual({
      type: "select",
      select: { name: "公開中" },
    })
    expect(converted.properties.公開日).toEqual({
      type: "date",
      date: { start: "2024-01-02T03:04:05+09:00" },
    })
    expect(converted.properties.更新日).toEqual({
      type: "date",
      date: { start: "2024-02-03T04:05:06+09:00" },
    })
    expect(converted.properties.category).toEqual({
      type: "relation",
      relation: [{ id: CATEGORY_PAGE_IDS.tech }],
    })
    expect(converted.properties.thumbnail).toEqual({
      type: "files",
      files: [
        {
          name: "sample.jpg",
          type: "external",
          external: { url: "https://mirumi.media/sample.jpg" },
        },
      ],
    })
    expect(converted.properties.もくじ非表示).toEqual({ type: "checkbox", checkbox: true })
    expect(converted.properties.もくじ閉じる).toEqual({ type: "checkbox", checkbox: false })
    expect(converted.properties["カスタム CSS"]).toEqual({
      type: "rich_text",
      rich_text: [{ type: "text", text: { content: ".sample { color: red; }" } }],
    })
    expect(converted.warnings).toEqual([])
  })

  test("本文に出していなかった記事の thumbnail は空にする", () => {
    const converted = convertWordPressContent(
      makeRecord("<p>本文</p>", { showThumbnailOnFrontend: false }),
    )

    expect(converted.properties.thumbnail).toEqual({ type: "files", files: [] })
  })

  test("固定ページは pages データソースへ振り分ける", () => {
    const converted = convertWordPressContent(makeRecord("<p>本文</p>", { postType: "page" }))

    expect(converted.parent).toEqual({
      type: "data_source_id",
      data_source_id: PAGES_DATA_SOURCE_ID,
    })
  })

  test("キャプションのリンクと装飾を保持する", () => {
    const converted = convertWordPressContent(
      makeRecord(
        '[caption]<img src="https://mirumi.media/a.jpg">出典: <a href="https://example.com">サイト</a>より[/caption]',
      ),
    )
    const image = converted.children[0]

    expect(image && "image" in image ? image.image.caption : []).toEqual([
      { type: "text", text: { content: "出典: ", link: null }, annotations: {} },
      {
        type: "text",
        text: { content: "サイト", link: { url: "https://example.com/" } },
        annotations: {},
      },
      { type: "text", text: { content: "より", link: null }, annotations: {} },
    ])
  })

  test("標準ブロックとインライン装飾を変換する", () => {
    const converted = convertWordPressContent(
      makeRecord(`
        <h2>見出し</h2>
        <p><strong>太字</strong><em>斜体</em><del>取消</del><code>code</code><a href="/linked">リンク</a><span class="color-red">赤</span><span style="font-size: 1.5em;">大</span><sup>2</sup></p>
        <hr>
        <pre class="language-ts"><code>const value = 1</code></pre>
        <blockquote><p>引用</p><p>続き</p></blockquote>
      `),
    )

    expect(converted.children.map(blockType)).toEqual([
      "heading_2",
      "paragraph",
      "divider",
      "code",
      "quote",
    ])
    expect(converted.children[1]).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: { content: "太字", link: null },
            annotations: { bold: true },
          },
          {
            type: "text",
            text: { content: "斜体", link: null },
            annotations: { italic: true },
          },
          {
            type: "text",
            text: { content: "取消", link: null },
            annotations: { strikethrough: true },
          },
          {
            type: "text",
            text: { content: "code", link: null },
            annotations: { code: true },
          },
          {
            type: "text",
            text: { content: "リンク", link: { url: "https://mirumi.me/linked" } },
            annotations: {},
          },
          {
            type: "text",
            text: { content: "赤", link: null },
            annotations: { color: "red" },
          },
          {
            type: "equation",
            equation: { expression: "{\\Large\\text{大}}" },
            annotations: {},
          },
          {
            type: "equation",
            equation: { expression: "^{2}" },
            annotations: {},
          },
        ],
      },
    })
    expect(converted.children[3]).toEqual({
      object: "block",
      type: "code",
      code: {
        rich_text: [{ type: "text", text: { content: "const value = 1" } }],
        language: "typescript",
      },
    })
    expect(converted.warnings).toEqual([])
  })

  test("文字サイズ指定の中の装飾・改行・リンクを保持する", () => {
    const converted = convertWordPressContent(
      makeRecord(
        '<p><span style="font-size: 1.35em;"><strong>太字</strong>と<br>改行と<a href="/linked">リンク</a></span></p>',
      ),
    )
    const block = converted.children[0]
    const richText = block && "paragraph" in block ? block.paragraph.rich_text : []

    expect(richText).toEqual([
      // 装飾は数式の annotations として保持する
      {
        type: "equation",
        equation: { expression: "{\\large\\text{太字}}" },
        annotations: { bold: true },
      },
      { type: "equation", equation: { expression: "{\\large\\text{と}}" }, annotations: {} },
      // <br> は数式に入れられないので改行だけ素のテキストにして数式を分ける
      { type: "text", text: { content: "\n", link: null } },
      { type: "equation", equation: { expression: "{\\large\\text{改行と}}" }, annotations: {} },
      // リンクは数式に載せられないため、文字サイズだけ捨ててリンクを残す
      {
        type: "text",
        text: { content: "リンク", link: { url: "https://mirumi.me/linked" } },
        annotations: {},
      },
    ])
    expect(converted.warnings.map((warning) => warning.code)).toEqual(["font_size_dropped"])
  })

  test("深いリストを保持し、列数の違うテーブルを補完する", () => {
    const converted = convertWordPressContent(
      makeRecord(`
        <ul><li>1<ul><li>2<ul><li>3<ul><li>4</li></ul></li></ul></li></ul></li></ul>
        <table><tr><th>名前</th><th>値</th></tr><tr><td><ul><li>A</li><li>B</li></ul></td></tr></table>
      `),
    )

    expect(converted.children.map(blockType)).toEqual(["bulleted_list_item", "table"])
    expect(JSON.stringify(converted.children[0])).toContain('"content":"4"')
    expect(converted.warnings.map((warning) => warning.code)).toEqual(["table_normalized"])

    const table = converted.children[1]
    expect(table && "table" in table ? table.table.children[1] : null).toEqual({
      object: "block",
      type: "table_row",
      table_row: {
        cells: [[{ type: "text", text: { content: "・A\n・B", link: null }, annotations: {} }], []],
      },
    })
  })

  test("画像、メディア、ブログカードと独自 shortcode を変換する", () => {
    const converted = convertWordPressContent(
      makeRecord(`
        [caption]<img src="https://mirumi.in/wp-content/uploads/caption.jpg">説明[/caption]
        <p><img class="sss" src="https://mirumi.media/custom.png"></p>
        <p>[/related-post]</p>
        <div class="blogcard-type">[https://example.com/card]</div>
        <p>https://x.com/mirumi_me/status/123</p>
        <p><iframe src="https://www.youtube.com/embed/abc"></iframe></p>
        <p>[audio mp3="https://mirumi.media/sound.mp3"][/audio]</p>
        <p>[video mp4="https://mirumi.media/movie.mp4"][/video]</p>
        <p>[amazon asin="B000000000"]</p>
        <p><img src="https://tracker.example/pixel.gif" width="1" height="1"></p>
      `),
    )

    expect(converted.children.map(blockType)).toEqual([
      "image",
      "image",
      "bookmark",
      "bookmark",
      "embed",
      "video",
      "audio",
      "video",
      "paragraph",
    ])
    expect(converted.children[0]).toEqual({
      object: "block",
      type: "image",
      image: {
        type: "external",
        external: { url: "https://mirumi.media/caption.jpg" },
        caption: [{ type: "text", text: { content: "説明", link: null }, annotations: {} }],
      },
    })
    expect(converted.children[1]).toEqual({
      object: "block",
      type: "image",
      image: {
        type: "external",
        external: { url: "https://mirumi.media/custom.png" },
        caption: [],
      },
    })
    expect(converted.warnings).toEqual([])
  })

  test("コールアウト、ボタン、アプリ、遅延動画と引用画像を変換する", () => {
    const converted = convertWordPressContent(
      makeRecord(`
        <div class="box-common box-info"><p>補足</p><ul><li>項目</li></ul></div>
        <p><span class="btn-wrap btn-wrap-green"><a href="https://example.com/buy">購入</a></span></p>
        <div class="appreach"><img class="appreach__icon" src="https://lh3.ggpht.com/icon=s128"><p class="appreach__name">サンプルアプリ</p><span class="appreach__developper">みるみ</span><span class="appreach__price">無料</span><a class="appreach__aslink" href="https://apps.apple.com/app/id1">App Store</a><a class="appreach__gplink" href="https://play.google.com/store/apps/details?id=1">Google Play</a></div>
        <div class="youtube" data-video="/embed/abc?start=23"><img src="https://mirumi.media/video.jpg"></div>
        <blockquote class="img"><img src="https://mirumi.media/comic.jpg">作者名</blockquote>
      `),
    )

    expect(converted.children.map(blockType)).toEqual([
      "callout",
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
    ])
    expect(converted.children[1]).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content: '[button text="購入" url="https://example.com/buy" color="green"]',
            },
          },
        ],
      },
    })
    expect(converted.children[2]).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content:
                '[app name="サンプルアプリ" icon="app-icon-7991379dd524.webp" developer="みるみ" price="無料" ios="https://apps.apple.com/app/id1" android="https://play.google.com/store/apps/details?id=1"]',
            },
          },
        ],
      },
    })
    expect(converted.children[3]).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: {
              content:
                '[video delay src="https://www.youtube.com/embed/abc?start=23" thumbnail="https://mirumi.media/video.jpg" ts="23s"]',
            },
          },
        ],
      },
    })
    expect(converted.children[4]).toEqual({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          {
            type: "text",
            text: { content: '[quoteImage name="comic.jpg" copyright="作者名"]' },
          },
        ],
      },
    })
    expect(converted.warnings).toEqual([])
  })

  test("インライン要素の内側にある空白と改行を保持する", () => {
    const converted = convertWordPressContent(
      makeRecord(`
        <p>あ<strong>太字 </strong>い<a href="/linked">リンク </a>う</p>
        <table><tr><td>Type-A<br />Type-A</td><td>備考</td></tr></table>
      `),
    )

    const paragraph = converted.children[0]
    expect(
      paragraph && "paragraph" in paragraph
        ? paragraph.paragraph.rich_text.map((item) => ("text" in item ? item.text.content : ""))
        : [],
    ).toEqual(["あ", "太字 ", "い", "リンク ", "う"])

    const table = converted.children[1]
    expect(table && "table" in table ? table.table.children[0] : null).toEqual({
      object: "block",
      type: "table_row",
      table_row: {
        cells: [
          [{ type: "text", text: { content: "Type-A\nType-A", link: null }, annotations: {} }],
          [{ type: "text", text: { content: "備考", link: null }, annotations: {} }],
        ],
      },
    })
  })

  test("画像は image ブロックにし、指定があるときだけキャプション先頭にオプションを置く", () => {
    const converted = convertWordPressContent(
      makeRecord(`
        <p><img class="alignnone" src="https://mirumi.media/icon.png" width="135" height="135"></p>
        <p><img class="sss" src="https://mirumi.media/plain.png" style="max-width: 100%;" width="800"></p>
        [caption]<img src="https://mirumi.media/narrow.png" style="width: 91%;">説明[/caption]
      `),
    )

    expect(converted.children.map(blockType)).toEqual(["image", "image", "image"])
    const captionOf = (index: number) => {
      const block = converted.children[index]
      return block && "image" in block ? block.image.caption : []
    }
    // オプションだけのときは末尾に空白を足さない
    expect(captionOf(0)).toEqual([{ type: "text", text: { content: '[image align="none"]' } }])
    // 廃止した .sss と、max-width のような既定のスタイルは指定として扱わない
    expect(captionOf(1)).toEqual([])
    // 実キャプションがあるときはオプションを先頭に置いて空白で区切る
    expect(captionOf(2)).toEqual([
      { type: "text", text: { content: '[image width="91%"] ' } },
      { type: "text", text: { content: "説明", link: null }, annotations: {} },
    ])
  })

  test("ファイル名から復元できない alt だけを持っていく", () => {
    const converted = convertWordPressContent(
      makeRecord(`
        <p><img src="https://mirumi.media/my-cats.png" alt="my-cats"></p>
        <p><img src="https://mirumi.media/my-cats-1-1999x1124.png" alt="my-cats"></p>
        <p><img src="https://mirumi.media/246310.png" alt="タグ編集の例"></p>
      `),
    )
    const captionOf = (index: number) => {
      const block = converted.children[index]
      return block && "image" in block ? block.image.caption : []
    }

    // ファイル名と同じもの、サイズ違いの派生ファイル名はどちらも捨てる
    expect(captionOf(0)).toEqual([])
    expect(captionOf(1)).toEqual([])
    // 連番ファイル名に手で書いた説明だけが残る
    expect(captionOf(2)).toEqual([
      { type: "text", text: { content: '[image alt="タグ編集の例"]' } },
    ])
  })

  test("段落の途中にある画像は shortcode のまま残す", () => {
    const converted = convertWordPressContent(
      makeRecord('<p>前<img class="aligncenter" src="https://mirumi.media/inline.png">後</p>'),
    )

    expect(converted.children.map(blockType)).toEqual(["paragraph"])
    expect(JSON.stringify(converted.children[0])).toContain(
      '[image name=\\"inline.png\\" align=\\"center\\"]',
    )
  })

  test("ブログカードが 2 枚入った div でも両方をブックマークにする", () => {
    const converted = convertWordPressContent(
      makeRecord(
        '<div class="blogcard-type"><p>[/first-post]</p><p>[https://example.com/second]</p></div>',
      ),
    )

    expect(converted.children.map(blockType)).toEqual(["bookmark", "bookmark"])
    expect(JSON.stringify(converted.children)).toContain("https://mirumi.me/first-post/")
    expect(JSON.stringify(converted.children)).toContain("https://example.com/second")
  })

  test("関連記事カードの末尾スラッシュ・サブディレクトリ・アンカーを解決する", () => {
    const converted = convertWordPressContent(
      makeRecord(
        "<p>[/lambda-layers-import/]</p><p>[/category/car-navigation-system]</p><p>[/pc-freesoft#toc7]</p>",
      ),
    )

    expect(converted.children.map(blockType)).toEqual(["bookmark", "bookmark", "bookmark"])
    expect(JSON.stringify(converted.children)).toContain("https://mirumi.me/lambda-layers-import/")
    expect(JSON.stringify(converted.children)).toContain(
      "https://mirumi.me/category/car-navigation-system/",
    )
    // 移行で見出し ID が変わりアンカーは必ず切れるので、記事そのものへ寄せて警告する
    expect(JSON.stringify(converted.children)).toContain("https://mirumi.me/pc-freesoft/")
    expect(converted.warnings.map((warning) => warning.code)).toEqual(["anchor_dropped"])
  })

  test("micro-bottom のキャプションはオプショントークンを消さずに後ろへ足す", () => {
    const converted = convertWordPressContent(
      makeRecord(
        '<p><img src="https://mirumi.media/a.jpg" alt="説明的な alt"></p>' +
          '<div class="micro-bottom">画像の補足</div>',
      ),
    )
    const block = converted.children[0]

    expect(converted.children.map(blockType)).toEqual(["image"])
    expect(
      (block && "image" in block ? (block.image.caption ?? []) : [])
        .map((item) => ("text" in item ? item.text.content : ""))
        .join(""),
    ).toEqual('[image alt="説明的な alt"] 画像の補足')
  })

  test("中身が空の sup からは数式をつくらず、罫線だけの div は区切り線にする", () => {
    const converted = convertWordPressContent(
      makeRecord(
        '<p>本文<sup class="reference"></sup></p>' +
          '<div class="border" style="border-top-width: 5px; border-top-style: dotted;"> </div>' +
          '<div class="border"> </div>',
      ),
    )

    expect(converted.children.map(blockType)).toEqual(["paragraph", "divider"])
    expect(JSON.stringify(converted.children)).not.toContain("^{}")
    // 見た目を持たない空要素は落とすが、黙って消さずに警告として残す
    expect(converted.warnings.map((warning) => warning.code)).toEqual(["empty_element"])
  })

  test("記事内アンカーはサイトトップではなくその記事を指す", () => {
    const converted = convertWordPressContent(
      makeRecord('<p><a href="#jump">ここ</a></p>', { slug: "firewatch" }),
    )

    expect(JSON.stringify(converted.children)).toContain("https://mirumi.me/firewatch/#jump")
  })

  test("末尾に空の code がある pre でも本文を落とさない", () => {
    const converted = convertWordPressContent(
      makeRecord('<pre class="_lang_">F14::SendInput\n+F14::SendInput\n<code></code></pre>'),
    )
    const block = converted.children[0]

    expect(block && "code" in block ? block.code.rich_text : []).toEqual([
      { type: "text", text: { content: "F14::SendInput\n+F14::SendInput\n" } },
    ])
  })

  test("不明カテゴリと不正なリンクを警告しつつ本文を保持する", () => {
    const converted = convertWordPressContent(
      makeRecord('<p><a href="microsoftmusic:">ストア</a></p>', {
        categories: [{ name: "移行先なし", slug: "no-such-category" }],
      }),
    )

    expect(converted.properties.category).toEqual({ type: "relation", relation: [] })
    expect(converted.children.map(blockType)).toEqual(["paragraph"])
    expect(converted.warnings.map((warning) => warning.code)).toEqual([
      "invalid_url",
      "unknown_category",
    ])
  })

  test("Notion の文字数上限より短い単位にテキストを分割する", () => {
    const converted = convertWordPressContent(makeRecord(`<p>${"a".repeat(2_001)}</p>`))
    const firstBlock = converted.children[0]
    const richText = firstBlock && "paragraph" in firstBlock ? firstBlock.paragraph.rich_text : []

    expect(richText.map((item) => ("text" in item ? item.text.content.length : 0))).toEqual([
      1_900, 101,
    ])
  })
})
