<template>
  <div class="comment_list">
    <div class="title">この記事へのコメント</div>
    <div v-if="allComments.length === 0" class="no_contents">
      コメントはまだひとつもありません :)
    </div>
    <div v-else class="comments_wrap">
      <ModulesCommentBase
        v-for="entry in leadingComments"
        :key="entry.comment.comment_ID"
        :c="entry.comment"
        :depth="entry.depth"
      />
      <div v-if="0 < remainingConversationCount" class="load_more" @click="loadMore()">
        <PartsBaseButton
          v-if="loadMoreStatus !== 'completed'"
          :type="'text'"
          :isSubmitting="loadMoreStatus === 'loading'"
          :spinner-color="'var(--color-text)'"
          >すべて読み込む ({{ remainingConversationCount }} 件)</PartsBaseButton
        >
      </div>
      <!-- v-if にすると残りのコメントが SSG の HTML に載らず検索エンジンに拾われないため、意図的に v-show -->
      <div v-show="loadMoreStatus === 'completed'">
        <ModulesCommentBase
          v-for="entry in remainingComments"
          :key="entry.comment.comment_ID"
          :c="entry.comment"
          :depth="entry.depth"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface CommentData {
  comment_ID: string
  comment_parent: string
  user_id: string
  comment_author: string
  comment_date: string
  comment_content: string
}

interface StructuredComment extends CommentData {
  children: Array<StructuredComment>
}

interface CommentEntry {
  comment: StructuredComment
  depth: number
}

const route = useRoute()
const appConfig = useAppConfig()

const slug = route.params.post as string
const loadMoreStatus = ref<"none" | "loading" | "completed">("none")

const selectPublicCommentFields = (comment: CommentData): CommentData => {
  return {
    comment_ID: comment.comment_ID,
    comment_parent: comment.comment_parent,
    user_id: comment.user_id,
    comment_author: comment.comment_author,
    comment_date: comment.comment_date,
    comment_content: comment.comment_content,
  }
}

const { data } = await useFetch<Array<CommentData>>(`/mirumi/comments_per_post/${slug}`, {
  baseURL: appConfig.baseURL,
  transform: (comments) => {
    return comments.map(selectPublicCommentFields)
  },
})

// Hack for JSON parse error (unexpected token)
const res = JSON.parse(JSON.stringify(data.value)) as Array<CommentData>
const commentsById = new Map<string, StructuredComment>()

for (const comment of res) {
  if (commentsById.has(comment.comment_ID)) {
    throw Error(`Duplicate comment ID: ${comment.comment_ID}`)
  }
  commentsById.set(comment.comment_ID, { ...comment, children: [] })
}

const allComments: Array<StructuredComment> = []
for (const comment of res) {
  const structuredComment = commentsById.get(comment.comment_ID)
  if (!structuredComment) {
    throw Error(`Comment not found: ${comment.comment_ID}`)
  }
  if (comment.comment_parent === "0") {
    allComments.push(structuredComment)
    continue
  }
  const parent = commentsById.get(comment.comment_parent)
  if (!parent) {
    throw Error(`Parent comment not found: ${comment.comment_parent}`)
  }
  parent.children.push(structuredComment)
}

const flattenComments = (
  comments: Array<StructuredComment>,
  depth: number,
): Array<CommentEntry> => {
  const entries: Array<CommentEntry> = []
  for (const comment of comments) {
    entries.push({ comment, depth: Math.min(depth, 4) })
    entries.push(...flattenComments(comment.children, depth + 1))
  }
  return entries
}

const leadingComments = flattenComments(allComments.slice(0, 5), 1)
const remainingConversationCount = Math.max(allComments.length - 5, 0)
const remainingComments = flattenComments(allComments.slice(5), 1)
const loadMore = async () => {
  loadMoreStatus.value = "loading"
  await delay(Math.floor(Math.random() * 600) + 100) // 0.1s ~ 0.7s
  loadMoreStatus.value = "completed"
}

if (res.length !== leadingComments.length + remainingComments.length) {
  throw Error("Comments could not be structured correctly")
}
</script>

<style lang="scss" scoped>
.comment_list {
  margin-top: 5em;

  .title {
    padding-bottom: 0.3em;
    color: #6c6c6c;
    font-size: 1.09em;
    font-weight: bold;
    border-bottom: solid 1.3px #dedbd8;
  }

  .no_contents {
    margin: 1.5em 1.3em 1em;
    font-size: 0.95em;
  }

  .comments_wrap {
    margin: 1.7em 0 3em;

    .load_more {
      margin: 2.9em auto 1em;
      text-align: center;

      button {
        width: 100%;
        padding: 0.5em 1.5em 0.59em;
        background-color: #f1ede9;

        &:hover {
          opacity: 0.7;
          filter: contrast(0.9);
        }
      }
    }
  }
}

.dark {
  .comment_list {
    .title {
      color: #c8c8c8;
    }

    .comments_wrap {
      .load_more {
        button {
          background-color: #3e3e3e;

          &:hover {
            filter: contrast(0.8);
          }
        }
      }
    }
  }
}
</style>
