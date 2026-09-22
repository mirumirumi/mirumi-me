import type { Client } from "@notionhq/client"

import type { BuildComment, CommentRecord } from "shared/comments"
import {
  createBuildComments,
  groupCommentRecordsBySlug,
  inheritCommentSlugs,
} from "shared/comments"
import {
  type CommentDataSourceSchema,
  createArticleCommentsFilter,
  fetchCommentRecords,
  resolveCommentDataSourceSchema,
} from "shared/notion-comments"

export interface PublishCommentSource {
  loadForSlug(slug: string): Promise<Array<BuildComment>>
}

// 公開 build が使うコメントの取得口。partial は slug ごとに query し、full / bootstrap は
// 最初に全件を取って slug で引く。approved 以外の row は非表示の親をつなぎ直すためだけに読み、
// メールはどの経路でも受け取らない
export class NotionPublishCommentSource implements PublishCommentSource {
  readonly #client: Client
  readonly #schema: CommentDataSourceSchema
  #preloaded: Map<string, Array<CommentRecord>> | null = null

  private constructor(client: Client, schema: CommentDataSourceSchema) {
    this.#client = client
    this.#schema = schema
  }

  static async create(client: Client, dataSourceId: string): Promise<NotionPublishCommentSource> {
    return new NotionPublishCommentSource(
      client,
      await resolveCommentDataSourceSchema(client, dataSourceId),
    )
  }

  async preloadAll(): Promise<void> {
    // slug の無い owner reply は comment-refresh が書き戻すまで query に掛からないので、全件読む経路では親から補う
    this.#preloaded = groupCommentRecordsBySlug(
      inheritCommentSlugs(
        await fetchCommentRecords(this.#client, this.#schema, createArticleCommentsFilter(null)),
      ),
    )
  }

  async loadForSlug(slug: string): Promise<Array<BuildComment>> {
    const records = this.#preloaded
      ? (this.#preloaded.get(slug) ?? [])
      : await fetchCommentRecords(this.#client, this.#schema, createArticleCommentsFilter(slug))

    return createBuildComments(records, slug)
  }
}
