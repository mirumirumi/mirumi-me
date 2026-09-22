<template>
  <div class="comment_list">
    <div class="title">この記事へのコメント</div>
    <div v-if="rootComments.length === 0" class="no_contents">
      コメントはまだひとつもありません :)
    </div>
    <div v-else class="comments_wrap">
      <ModulesCommentBase
        v-for="entry in leadingComments"
        :key="entry.comment.id"
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
          :key="entry.comment.id"
          :c="entry.comment"
          :depth="entry.depth"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BuildComment } from "shared/comments"

interface StructuredComment extends BuildComment {
  children: Array<StructuredComment>
}

interface CommentEntry {
  comment: StructuredComment
  depth: number
}

// コメントは build manifest 経由で BuildPage に焼き込まれている。generate 中も browser でも取得通信はしない
const p = defineProps<{
  comments: Array<BuildComment>
}>()

const loadMoreStatus = ref<"none" | "loading" | "completed">("none")

const commentsById = new Map<string, StructuredComment>()
for (const comment of p.comments) {
  if (commentsById.has(comment.id)) {
    throw Error(`Duplicate comment ID: ${comment.id}`)
  }
  commentsById.set(comment.id, { ...comment, children: [] })
}

const rootComments: Array<StructuredComment> = []
for (const comment of p.comments) {
  const structuredComment = commentsById.get(comment.id)
  if (!structuredComment) {
    throw Error(`Comment not found: ${comment.id}`)
  }
  if (comment.parentId === null) {
    rootComments.push(structuredComment)
    continue
  }
  const parent = commentsById.get(comment.parentId)
  if (!parent) {
    throw Error(`Parent comment not found: ${comment.parentId}`)
  }
  parent.children.push(structuredComment)
}

// 全件を描画し、インデントだけ depth 4 で止める（実データには depth 6 まである）
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

const leadingComments = flattenComments(rootComments.slice(0, 5), 1)
const remainingConversationCount = Math.max(rootComments.length - 5, 0)
const remainingComments = flattenComments(rootComments.slice(5), 1)
const loadMore = async () => {
  loadMoreStatus.value = "loading"
  await delay(Math.floor(Math.random() * 600) + 100) // 0.1s ~ 0.7s
  loadMoreStatus.value = "completed"
}

if (p.comments.length !== leadingComments.length + remainingComments.length) {
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
