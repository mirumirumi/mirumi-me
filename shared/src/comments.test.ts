import { describe, expect, test, vi } from "vitest"

import {
  type CommentRecord,
  compareBuildComments,
  createBuildComments,
  formatCommentContent,
  groupCommentRecordsBySlug,
  inheritCommentSlugs,
  normalizeCommentContent,
  parseCommentPublicId,
  resolveCommentPublicId,
  resolveSafeCommentHref,
  sanitizeCommentHtml,
  splitNotionRichTextContent,
} from "./comments"

describe("comments", () => {
  const record = (overrides: Partial<CommentRecord>): CommentRecord => ({
    pageId: "00000000-0000-0000-0000-000000000001",
    slug: "article",
    parentPageId: null,
    authorName: "読者",
    content: "本文",
    contentFormat: "plain-text",
    createdAt: "2026-09-01T00:00:00.000Z",
    state: "approved",
    isOwner: false,
    source: "wordpress",
    legacyCommentId: 100,
    uniqueId: null,
    requestId: null,
    notifiedAt: null,
    refreshError: null,
    lastEditedTime: "2026-09-01T00:00:00.000Z",
    ...overrides,
  })

  describe("parseCommentPublicId", () => {
    test("legacy の数字と c- prefix の Unique ID だけを受け付ける", () => {
      expect(parseCommentPublicId("123")).toEqual({ kind: "legacy", number: 123 })
      expect(parseCommentPublicId("c-42")).toEqual({ kind: "unique", number: 42 })
      expect(parseCommentPublicId("c42")).toEqual(null)
      expect(parseCommentPublicId("-1")).toEqual(null)
      expect(parseCommentPublicId("00000000-0000-0000-0000-000000000001")).toEqual(null)
      expect(parseCommentPublicId("")).toEqual(null)
    })
  })

  describe("resolveCommentPublicId", () => {
    test("legacy ID を優先し、なければ Unique ID に prefix を付ける", () => {
      expect(resolveCommentPublicId({ legacyCommentId: 123, uniqueId: 5 })).toEqual("123")
      expect(resolveCommentPublicId({ legacyCommentId: null, uniqueId: 5 })).toEqual("c-5")
      expect(resolveCommentPublicId({ legacyCommentId: null, uniqueId: null })).toEqual(null)
    })
  })

  describe("resolveSafeCommentHref", () => {
    test("http(s) とサイト内の絶対 path だけを許す", () => {
      expect(resolveSafeCommentHref("https://example.com/a?b=1&amp;c=2")).toEqual(
        "https://example.com/a?b=1&c=2",
      )
      expect(resolveSafeCommentHref("/game-ranking")).toEqual("/game-ranking")
      expect(resolveSafeCommentHref("//evil.example.com")).toEqual(null)
      expect(resolveSafeCommentHref("/\\evil.example.com/x")).toEqual(null)
      expect(resolveSafeCommentHref("&#106;avascript:alert(1)")).toEqual(null)
      expect(resolveSafeCommentHref("jav&#x09;ascript:alert(1)")).toEqual(null)
      expect(resolveSafeCommentHref(" \tjavascript:alert(1)")).toEqual(null)
      expect(resolveSafeCommentHref("javascript:alert(1)")).toEqual(null)
      expect(resolveSafeCommentHref("mailto:a@example.com")).toEqual(null)
      expect(resolveSafeCommentHref("relative/path")).toEqual(null)
    })
  })

  describe("sanitizeCommentHtml", () => {
    test("許可 tag だけを残し a の属性を正規化する", () => {
      expect(
        sanitizeCommentHtml(
          '<p>見て<a href="https://example.com/" target="_blank" rel="noopener nofollow" onclick="x()">リンク</a></p>',
        ),
      ).toEqual(
        '<p>見て<a href="https://example.com/" rel="nofollow ugc noopener" target="_blank">リンク</a></p>',
      )
      expect(sanitizeCommentHtml('<a href="/tasker-example" rel="nofollow ugc">ここ</a>')).toEqual(
        '<a href="/tasker-example" rel="nofollow ugc">ここ</a>',
      )
    })

    test("危険な tag と属性は落とし、中の文字は残す", () => {
      expect(sanitizeCommentHtml("<script>alert(1)</script><b>太字</b>")).toEqual(
        "alert(1)<b>太字</b>",
      )
      expect(
        sanitizeCommentHtml(
          '<img border="0" width="1" height="1" src="https://tracker.example.com/p.gif" alt="">',
        ),
      ).toEqual("")
      expect(sanitizeCommentHtml('<a href="javascript:alert(1)">危険</a>')).toEqual("危険")
      expect(sanitizeCommentHtml('<del datetime="2019-10-30T03:26:27+00:00">取消</del>')).toEqual(
        "<del>取消</del>",
      )
      expect(sanitizeCommentHtml("<ruby>体<rt>てい</rt></ruby>")).toEqual(
        "<ruby>体<rt>てい</rt></ruby>",
      )
    })

    test("href や属性値経由の注入は落とすか escape する", () => {
      expect(sanitizeCommentHtml('<a href="&#106;avascript:alert(1)">x</a>')).toEqual("x")
      expect(sanitizeCommentHtml('<a href="//evil.example.com/">x</a>')).toEqual("x")
      expect(
        sanitizeCommentHtml('<a href="https://example.com/" onmouseover="x()" target="x">x</a>'),
      ).toEqual('<a href="https://example.com/" rel="nofollow ugc">x</a>')
      expect(
        sanitizeCommentHtml('<a href="https://example.com/?a=1&quot; onclick=&quot;x">x</a>'),
      ).toEqual('<a href="https://example.com/?a=1%22%20onclick=%22x" rel="nofollow ugc">x</a>')
      // 属性値の途中の > は tag の終わりとして扱うので、a は落ちて残りは text になる
      expect(sanitizeCommentHtml('<a href="https://example.com/a>b">x</a>')).toEqual('b"&gt;x')
      expect(sanitizeCommentHtml('<b onclick="x()">x</b><p style="color:red">y</p>')).toEqual(
        "<b>x</b><p>y</p>",
      )
    })

    test("閉じ忘れと対応しない閉じ tag を直して well-formed にする", () => {
      expect(sanitizeCommentHtml("<p><ul><li>a</li></p><p><li>b</li></ul></p>")).toEqual(
        "<p><ul><li>a</li></ul></p><p><li>b</li></p>",
      )
      expect(sanitizeCommentHtml("<b>開きっぱなし")).toEqual("<b>開きっぱなし</b>")
      expect(sanitizeCommentHtml("</b>閉じだけ")).toEqual("閉じだけ")
    })

    test("text の entity は残し、裸の記号は escape する", () => {
      expect(sanitizeCommentHtml("A &gt; B &amp; C &#12354; & D < E")).toEqual(
        "A &gt; B &amp; C &#12354; &amp; D &lt; E",
      )
      expect(sanitizeCommentHtml("<!-- comment -->x")).toEqual("&lt;!-- comment --&gt;x")
      expect(sanitizeCommentHtml("a < b > c")).toEqual("a &lt; b &gt; c")
    })
  })

  describe("formatCommentContent", () => {
    // 段落末尾や段落間の改行が残るのは現行 formatContent と同じ挙動（`<` の直前の改行は br にしない）
    test("plain-text は escape してから段落・改行・linkify する", () => {
      expect(
        formatCommentContent(
          "1 行目 <b>\n2 行目\n\n段落 2\nhttps://example.com/?a=1&b=2\n",
          "plain-text",
        ),
      ).toEqual(
        '<p>1 行目 &lt;b&gt;<br>2 行目\n</p>\n<p>段落 2<br><a href="https://example.com/?a=1&amp;b=2" rel="nofollow ugc">https://example.com/?a=1&amp;b=2</a></p>',
      )
    })

    test("wordpress-html は現行 formatContent の変換を再現してから sanitize する", () => {
      expect(
        formatCommentContent(
          '記事は<a href="/game-ranking" rel="nofollow ugc">こちら</a>です。\r\n\r\n<del>消し</del>\r\nhttps://example.com/path\r\n',
          "wordpress-html",
        ),
      ).toEqual(
        '<p>記事は<a href="/game-ranking" rel="nofollow ugc">こちら</a>です。\r\n</p>\r\n<p><del>消し</del><br><a href="https://example.com/path" rel="nofollow ugc">https://example.com/path</a></p>',
      )
    })

    test("wordpress-html の entity はそのまま残る", () => {
      expect(formatCommentContent("A &gt; B", "wordpress-html")).toEqual("<p>A &gt; B</p>")
    })
  })

  describe("compareBuildComments", () => {
    test("投稿日時、legacy ID、Unique ID の順で安定して並ぶ", () => {
      const comments = [
        { id: "c-2", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "10", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "9", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "c-1", createdAt: "2026-09-01T00:00:00.000Z" },
        { id: "1", createdAt: "2026-08-31T00:00:00.000Z" },
      ]

      expect(comments.toSorted(compareBuildComments).map(({ id }) => id)).toEqual([
        "1",
        "9",
        "10",
        "c-1",
        "c-2",
      ])
    })
  })

  describe("createBuildComments", () => {
    test("親を public ID に正規化し、公開に必要な項目だけを返す", () => {
      const parent = record({
        pageId: "00000000-0000-0000-0000-000000000001",
        legacyCommentId: 100,
      })
      const owner = record({
        pageId: "00000000-0000-0000-0000-000000000002",
        parentPageId: parent.pageId,
        authorName: "みるみ",
        content: "返信\nです",
        createdAt: "2026-09-02T00:00:00.000Z",
        isOwner: true,
        legacyCommentId: null,
        uniqueId: 7,
        source: "owner",
      })
      const anonymous = record({
        pageId: "00000000-0000-0000-0000-000000000003",
        authorName: "  ",
        legacyCommentId: 50,
        createdAt: "2026-08-01T00:00:00.000Z",
      })

      expect(createBuildComments([owner, parent, anonymous], "article")).toEqual([
        {
          id: "50",
          parentId: null,
          authorName: "匿名",
          createdAt: "2026-08-01T00:00:00.000Z",
          contentHtml: "<p>本文</p>",
          isOwner: false,
        },
        {
          id: "100",
          parentId: null,
          authorName: "読者",
          createdAt: "2026-09-01T00:00:00.000Z",
          contentHtml: "<p>本文</p>",
          isOwner: false,
        },
        {
          id: "c-7",
          parentId: "100",
          authorName: "みるみ",
          createdAt: "2026-09-02T00:00:00.000Z",
          contentHtml: "<p>返信<br>です</p>",
          isOwner: true,
        },
      ])
    })

    test("非表示の親を持つ子は、最も近い表示中の先祖につなぎ直す", () => {
      const root = record({
        pageId: "root",
        legacyCommentId: 1,
        createdAt: "2026-09-01T00:00:00.000Z",
      })
      const hidden = record({
        pageId: "hidden",
        parentPageId: "root",
        legacyCommentId: 2,
        state: "spam",
        createdAt: "2026-09-02T00:00:00.000Z",
      })
      const hiddenToo = record({
        pageId: "hidden-too",
        parentPageId: "hidden",
        legacyCommentId: 3,
        state: "pending",
        createdAt: "2026-09-03T00:00:00.000Z",
      })
      const child = record({
        pageId: "child",
        parentPageId: "hidden-too",
        legacyCommentId: 4,
        createdAt: "2026-09-04T00:00:00.000Z",
      })

      expect(
        createBuildComments([child, hiddenToo, hidden, root], "article").map(({ id, parentId }) => [
          id,
          parentId,
        ]),
      ).toEqual([
        ["1", null],
        ["4", "1"],
      ])
    })

    test("本文が空の承認済み row は描画せず、非表示の親と同じ扱いにする", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
      try {
        const root = record({ pageId: "root", legacyCommentId: 1 })
        const empty = record({
          pageId: "empty",
          parentPageId: "root",
          legacyCommentId: 2,
          content: " \n ",
          createdAt: "2026-09-02T00:00:00.000Z",
        })
        const child = record({
          pageId: "child",
          parentPageId: "empty",
          legacyCommentId: 3,
          createdAt: "2026-09-03T00:00:00.000Z",
        })

        expect(
          createBuildComments([root, empty, child], "article").map(({ id, parentId }) => [
            id,
            parentId,
          ]),
        ).toEqual([
          ["1", null],
          ["3", "1"],
        ])
        expect(warn).toHaveBeenCalledWith(
          JSON.stringify({ event: "comment_content_empty", pageId: "empty", slug: "article" }),
        )
      } finally {
        warn.mockRestore()
      }
    })

    test("親の row 自体が無い（削除済みなど）子は root へ繰り上げる", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
      try {
        expect(
          createBuildComments(
            [record({ pageId: "orphan", parentPageId: "deleted", legacyCommentId: 9 })],
            "article",
          ).map(({ id, parentId }) => [id, parentId]),
        ).toEqual([["9", null]])
        expect(warn).toHaveBeenCalledTimes(1)
      } finally {
        warn.mockRestore()
      }
    })

    test("別記事、ID 欠損、重複、循環は 0 件へ縮退せず失敗する", () => {
      const base = record({})

      expect(() => createBuildComments([record({ slug: "other" })], "article")).toThrowError(
        "別の記事",
      )
      expect(() =>
        createBuildComments([record({ legacyCommentId: null, uniqueId: null })], "article"),
      ).toThrowError("コメント ID がありません")
      expect(() => createBuildComments([base, base], "article")).toThrowError("重複")
      expect(() =>
        createBuildComments(
          [base, record({ pageId: "00000000-0000-0000-0000-000000000002", legacyCommentId: 100 })],
          "article",
        ),
      ).toThrowError("コメント ID が重複")
      expect(() =>
        createBuildComments(
          [
            record({ pageId: "a", parentPageId: "b", legacyCommentId: 1, state: "pending" }),
            record({ pageId: "b", parentPageId: "a", legacyCommentId: 2, state: "pending" }),
            record({ pageId: "c", parentPageId: "a", legacyCommentId: 3 }),
          ],
          "article",
        ),
      ).toThrowError("循環")
    })

    test("親が子より後の投稿日時なら失敗する", () => {
      const parent = record({ pageId: "p", createdAt: "2026-09-02T00:00:00.000Z" })
      const child = record({
        pageId: "c",
        parentPageId: "p",
        legacyCommentId: 101,
        createdAt: "2026-09-01T00:00:00.000Z",
      })

      expect(() => createBuildComments([parent, child], "article")).toThrowError(
        "親コメントが子より後に投稿されています",
      )
    })
  })

  describe("groupCommentRecordsBySlug", () => {
    test("slug ごとに順序を保って分ける", () => {
      const a1 = record({ pageId: "a1", slug: "a" })
      const b1 = record({ pageId: "b1", slug: "b" })
      const a2 = record({ pageId: "a2", slug: "a" })

      expect([...groupCommentRecordsBySlug([a1, b1, a2])]).toEqual([
        ["a", [a1, a2]],
        ["b", [b1]],
      ])
    })
  })

  describe("inheritCommentSlugs", () => {
    test("slug が空の row は親をたどって最初に見つかった slug を継ぐ", () => {
      const root = record({ pageId: "root", slug: "a" })
      const reply = record({ pageId: "reply", slug: "", parentPageId: "root" })
      const nested = record({ pageId: "nested", slug: "", parentPageId: "reply" })
      const other = record({ pageId: "other", slug: "b" })

      expect(
        inheritCommentSlugs([nested, other, reply, root]).map(({ pageId, slug }) => [pageId, slug]),
      ).toEqual([
        ["nested", "a"],
        ["other", "b"],
        ["reply", "a"],
        ["root", "a"],
      ])
    })

    test("slug がある row はそのまま、親が無い・辿れない・循環している row は空のまま warn する", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
      const own = record({ pageId: "own", slug: "a", parentPageId: "root-b" })
      const rootB = record({ pageId: "root-b", slug: "b" })
      const noParent = record({ pageId: "no-parent", slug: "" })
      const missing = record({ pageId: "missing", slug: "", parentPageId: "deleted" })
      const loop1 = record({ pageId: "loop1", slug: "", parentPageId: "loop2" })
      const loop2 = record({ pageId: "loop2", slug: "", parentPageId: "loop1" })
      const result = inheritCommentSlugs([own, rootB, noParent, missing, loop1, loop2])

      expect(result.map(({ slug }) => slug)).toEqual(["a", "b", "", "", "", ""])
      expect(warn).toHaveBeenCalledTimes(4)
      warn.mockRestore()
    })
  })

  describe("splitNotionRichTextContent", () => {
    test("2,000 文字ごとに分け、サロゲートペアの途中では切らない", () => {
      expect(splitNotionRichTextContent("")).toEqual([])
      expect(splitNotionRichTextContent("a".repeat(2_000))).toEqual(["a".repeat(2_000)])
      expect(splitNotionRichTextContent("a".repeat(4_481)).map((chunk) => chunk.length)).toEqual([
        2_000, 2_000, 481,
      ])
      const emoji = `${"a".repeat(1_999)}😀b`
      const chunks = splitNotionRichTextContent(emoji)
      expect(chunks).toEqual(["a".repeat(1_999), "😀b"])
    })
  })

  describe("normalizeCommentContent", () => {
    test("CRLF と CR を LF に揃える", () => {
      expect(normalizeCommentContent("a\r\nb\rc\nd")).toEqual("a\nb\nc\nd")
    })
  })
})
