import { isIgnoredFixedPageSlug } from "shared/site-routes"

import type { WordPressContentRecord } from "./types"

export const selectMigrationTargets = (
  records: Array<WordPressContentRecord>,
): Array<WordPressContentRecord> => {
  return records.filter((record) => {
    return record.postType !== "page" || !isIgnoredFixedPageSlug(record.slug)
  })
}
