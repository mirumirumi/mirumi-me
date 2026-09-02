import { describe, expect, test } from "vitest"

import { selectMigrationTargets } from "./migration-targets"
import type { WordPressContentRecord } from "./types"

describe("selectMigrationTargets", () => {
  const record = (postType: "page" | "post", slug: string): WordPressContentRecord => {
    return {
      id: 1,
      postType,
      postDate: "2026-08-26 00:00:00",
      postModified: "2026-08-26 00:00:00",
      slug,
      title: slug,
      excerpt: "",
      content: "",
      categories: [],
      thumbnailUrl: null,
      showThumbnailOnFrontend: false,
      tocHidden: false,
      tocClosed: false,
    }
  }

  test("CMS 移行対象外の旧固定ページを Notion 移行から除外する", () => {
    const records = [
      record("page", "home"),
      record("page", "new-entries"),
      record("page", "what-is-this-blog"),
      record("page", "profile"),
      record("post", "article"),
    ]

    expect(selectMigrationTargets(records).map(({ slug }) => slug)).toEqual(["profile", "article"])
  })
})
