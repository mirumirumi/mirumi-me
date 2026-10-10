import type { BlockObjectRequest } from "@notionhq/client"
import { describe, expect, test } from "vitest"

import { childrenOf, countBlockRequests, planBlockBatches } from "./batch"

const paragraph = (
  content: string,
  children: Array<BlockObjectRequest> = [],
): BlockObjectRequest => {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content } }],
      ...(0 < children.length ? { children } : {}),
    },
  } as unknown as BlockObjectRequest
}

const nest = (depth: number): BlockObjectRequest => {
  return 1 < depth ? paragraph(`${depth}`, [nest(depth - 1)]) : paragraph("1")
}

const paragraphs = (count: number): Array<BlockObjectRequest> => {
  return Array.from({ length: count }, (_, index) => paragraph(`${index}`))
}

const table = (rows: number): BlockObjectRequest => {
  return {
    object: "block",
    type: "table",
    table: {
      table_width: 1,
      has_column_header: false,
      has_row_header: false,
      children: Array.from({ length: rows }, () => ({
        object: "block" as const,
        type: "table_row" as const,
        table_row: { cells: [[]] },
      })),
    },
  } as unknown as BlockObjectRequest
}

describe("planBlockBatches", () => {
  test("100 件以内でネストもなければ 1 リクエストにまとめる", () => {
    const batches = planBlockBatches(paragraphs(100))

    expect(batches.length).toEqual(1)
    expect(batches[0]?.children.length).toEqual(100)
    expect(batches[0]?.deferred).toEqual([])
  })

  test("100 件を超えるトップレベルを順番どおりのバッチへ分割する", () => {
    const batches = planBlockBatches(paragraphs(250))

    expect(batches.map((batch) => batch.children.length)).toEqual([100, 100, 50])
    expect(batches.flatMap((batch) => batch.deferred)).toEqual([])
    expect(JSON.stringify(batches[2]?.children[49])).toContain('"content":"249"')
  })

  test("2 段までのネストはリクエストにそのまま含める", () => {
    const batches = planBlockBatches([nest(3)])

    expect(batches.length).toEqual(1)
    expect(batches[0]?.deferred).toEqual([])
    const child = childrenOf(batches[0]?.children[0] as BlockObjectRequest)
    expect(JSON.stringify(childrenOf(child[0] as BlockObjectRequest))).toContain('"content":"1"')
  })

  test("3 段目より深いネストは親までの経路つきで切り離す", () => {
    const batches = planBlockBatches([paragraph("x"), nest(5)])
    const deferred = batches[0]?.deferred ?? []

    expect(deferred.length).toEqual(1)
    // トップレベルの 2 番目 → その子 → さらにその子、が切り離しの親になる
    expect(deferred[0]?.path).toEqual([1, 0, 0])
    expect(JSON.stringify(deferred[0]?.children)).toContain('"content":"2"')
    // 切り離した先はリクエストから消えている
    expect(JSON.stringify(batches[0]?.children)).not.toContain('"content":"2"')
  })

  test("100 件を超える子は先頭 100 件だけ残して超過分を切り離す", () => {
    const batches = planBlockBatches([table(169)])
    const deferred = batches[0]?.deferred ?? []

    expect(childrenOf(batches[0]?.children[0] as BlockObjectRequest).length).toEqual(100)
    expect(deferred.length).toEqual(1)
    expect(deferred[0]?.path).toEqual([0])
    expect(deferred[0]?.children.length).toEqual(69)
  })

  test("切り離した子をもう一度分割しても制限を超えない", () => {
    const deep = paragraph("root", paragraphs(250))
    const deferred = planBlockBatches([deep])[0]?.deferred ?? []

    expect(
      planBlockBatches(deferred[0]?.children ?? []).map((batch) => batch.children.length),
    ).toEqual([100, 50])
  })
})

describe("countBlockRequests", () => {
  test("バッチ数と切り離し分の追加リクエストを合計する", () => {
    expect(countBlockRequests(paragraphs(10))).toEqual(1)
    expect(countBlockRequests(paragraphs(250))).toEqual(3)
    // テーブル本体の 1 回 + あふれた 69 行の 1 回
    expect(countBlockRequests([table(169)])).toEqual(2)
    // トップレベル 1 回 + 深い階層の 1 回
    expect(countBlockRequests([nest(5)])).toEqual(2)
  })
})
