import { describe, expect, test } from "vitest"

import { createAmazonItemBatches } from "./content-scripts"

describe("createAmazonItemBatches", () => {
  test("同じ ASIN を重複除去しながら最大 10 件の直列 batch に分ける", () => {
    const items = Array.from({ length: 53 }, (_, index) => ({
      asin: `B${index.toString().padStart(9, "0")}`,
      signature: `signature-${index}`,
    }))

    expect(createAmazonItemBatches([...items, items[0]!]).map((batch) => batch.length)).toEqual([
      10, 10, 10, 10, 10, 3,
    ])
    expect(
      createAmazonItemBatches([...items, items[0]!])
        .at(0)
        ?.at(0),
    ).toEqual("B000000000.signature-0")
  })
})
