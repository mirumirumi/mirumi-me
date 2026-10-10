import { describe, expect, test } from "vitest"

import {
  CONTENT_CACHE_COPY_PREFIXES,
  createBulkPutEntries,
  parseBulkGetOutput,
  parseKvKeyList,
  planContentCacheCopy,
} from "./content-cache-copy"

describe("content cache copy", () => {
  const now = 1_800_000_000

  describe("CONTENT_CACHE_COPY_PREFIXES", () => {
    test("X ポストとブログカードの cache だけを写す", () => {
      expect(CONTENT_CACHE_COPY_PREFIXES).toEqual(["x-post:v4:", "bookmark:v1:"])
    })
  })

  describe("parseKvKeyList", () => {
    test("wrangler kv key list の JSON から key と有効期限を読む", () => {
      expect(
        parseKvKeyList([
          { name: "x-post:v4:1", expiration: now + 100 },
          { name: "bookmark:v1:a", metadata: { source: "test" } },
        ]),
      ).toEqual([
        { name: "x-post:v4:1", expiration: now + 100, metadata: null },
        { name: "bookmark:v1:a", expiration: null, metadata: { source: "test" } },
      ])
    })
  })

  describe("planContentCacheCopy", () => {
    test("prd にすでにある key と、有効期限が 2 分を切った key は写さない", () => {
      expect(
        planContentCacheCopy(
          [
            { name: "x-post:v4:copy", expiration: now + 3_600, metadata: null },
            { name: "x-post:v4:forever", expiration: null, metadata: null },
            { name: "x-post:v4:existing", expiration: now + 3_600, metadata: null },
            { name: "bookmark:v1:expiring", expiration: now + 119, metadata: null },
          ],
          new Set(["x-post:v4:existing"]),
          now,
        ),
      ).toEqual({
        copy: [
          { name: "x-post:v4:copy", expiration: now + 3_600, metadata: null },
          { name: "x-post:v4:forever", expiration: null, metadata: null },
        ],
        existing: ["x-post:v4:existing"],
        expiring: ["bookmark:v1:expiring"],
      })
    })
  })

  describe("parseBulkGetOutput", () => {
    test("open beta の注意書きを飛ばして、key と値の JSON を読む", () => {
      expect(
        parseBulkGetOutput(
          [
            "▲ [WARNING] 🚧 `wrangler kv bulk get` is an open beta command.",
            "",
            "",
            "{",
            '  "x-post:v4:1": "{\\"version\\":1}"',
            "}",
          ].join("\n"),
        ),
      ).toEqual({ "x-post:v4:1": '{"version":1}' })
    })
  })

  describe("createBulkPutEntries", () => {
    test("値と有効期限と metadata をそのまま bulk put の形にする", () => {
      expect(
        createBulkPutEntries(
          [
            { name: "x-post:v4:1", expiration: now + 3_600, metadata: { source: "test" } },
            { name: "bookmark:v1:a", expiration: null, metadata: null },
          ],
          { "x-post:v4:1": "post", "bookmark:v1:a": "card" },
        ),
      ).toEqual([
        {
          key: "x-post:v4:1",
          value: "post",
          expiration: now + 3_600,
          metadata: { source: "test" },
        },
        { key: "bookmark:v1:a", value: "card" },
      ])
    })

    test("値を取れなかった key があれば、半端に写さないよう止める", () => {
      expect(() =>
        createBulkPutEntries([{ name: "x-post:v4:1", expiration: null, metadata: null }], {}),
      ).toThrow("値を取れなかった key があります: x-post:v4:1")
    })
  })
})
