import { describe, expect, test } from "vitest"

import { PAGES_DATA_SOURCE_ID, POSTS_DATA_SOURCE_ID } from "./config"
import { selectConversions, type UploadOptions } from "./select"
import type { NotionPageInput } from "./types"

const makeInput = (slug: string, dataSourceId: string): NotionPageInput => {
  return {
    sourceId: 1,
    slug,
    parent: { type: "data_source_id", data_source_id: dataSourceId },
    properties: {},
    children: [],
    warnings: [],
  }
}

const makeOptions = (overrides: Partial<UploadOptions> = {}): UploadOptions => {
  return {
    slugs: [],
    limit: null,
    postsDataSourceId: POSTS_DATA_SOURCE_ID,
    pagesDataSourceId: PAGES_DATA_SOURCE_ID,
    statePath: "upload-state.json",
    ...overrides,
  }
}

const conversions = [
  makeInput("first-post", POSTS_DATA_SOURCE_ID),
  makeInput("second-post", POSTS_DATA_SOURCE_ID),
  makeInput("third-post", POSTS_DATA_SOURCE_ID),
  makeInput("about", PAGES_DATA_SOURCE_ID),
]

describe("selectConversions", () => {
  test("指定がなければ全件をそのまま返す", () => {
    expect(selectConversions(conversions, makeOptions())).toEqual(conversions)
  })

  test("slug を指定した順番どおりに絞り込む", () => {
    const selected = selectConversions(conversions, makeOptions({ slugs: ["third-post", "about"] }))

    expect(selected.map((conversion) => conversion.slug)).toEqual(["third-post", "about"])
  })

  test("存在しない slug は取り違えを避けるためエラーにする", () => {
    expect(() => selectConversions(conversions, makeOptions({ slugs: ["no-such-post"] }))).toThrow(
      "slug が見つかりません: no-such-post",
    )
  })

  test("limit で先頭から件数を絞る", () => {
    expect(
      selectConversions(conversions, makeOptions({ limit: 2 })).map(
        (conversion) => conversion.slug,
      ),
    ).toEqual(["first-post", "second-post"])
  })

  test("投入先のデータソースを posts と pages で別々に差し替える", () => {
    const selected = selectConversions(
      conversions,
      makeOptions({ postsDataSourceId: "copied-posts", pagesDataSourceId: "copied-pages" }),
    )

    expect(selected.map((conversion) => conversion.parent)).toEqual([
      { type: "data_source_id", data_source_id: "copied-posts" },
      { type: "data_source_id", data_source_id: "copied-posts" },
      { type: "data_source_id", data_source_id: "copied-posts" },
      { type: "data_source_id", data_source_id: "copied-pages" },
    ])
  })
})
