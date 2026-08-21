import { PAGES_DATA_SOURCE_ID, POSTS_DATA_SOURCE_ID } from "./config"
import type { NotionPageInput } from "./types"

export interface UploadOptions {
  slugs: Array<string>
  limit: number | null
  postsDataSourceId: string
  pagesDataSourceId: string
  statePath: string
}

const dataSourceId = (parent: NotionPageInput["parent"]): string | null => {
  return "data_source_id" in parent ? parent.data_source_id : null
}

// 動作確認では複製したデータソースへ入れたいので、投入先を差し替えられるようにする
export const withDataSource = (input: NotionPageInput, options: UploadOptions): NotionPageInput => {
  const current = dataSourceId(input.parent)
  const next =
    current === POSTS_DATA_SOURCE_ID
      ? options.postsDataSourceId
      : current === PAGES_DATA_SOURCE_ID
        ? options.pagesDataSourceId
        : null
  if (!next || next === current) {
    return input
  }

  return { ...input, parent: { type: "data_source_id", data_source_id: next } }
}

export const selectConversions = (
  conversions: Array<NotionPageInput>,
  options: UploadOptions,
): Array<NotionPageInput> => {
  const selected =
    0 < options.slugs.length
      ? options.slugs.flatMap((slug) => {
          const found = conversions.filter((conversion) => conversion.slug === slug)
          if (found.length === 0) {
            throw Error(`slug が見つかりません: ${slug}`)
          }
          return found
        })
      : conversions

  return (options.limit === null ? selected : selected.slice(0, options.limit)).map((conversion) =>
    withDataSource(conversion, options),
  )
}
