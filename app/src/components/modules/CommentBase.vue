<template>
  <div class="comment_base">
    <div :class="`comment depth-${depth}`" :id="`comment-${c.id}`">
      <div class="meta_data" @mouseenter="hover = true" @mouseleave="hover = false">
        <div class="icon">
          <img
            v-if="c.isOwner"
            src="@/assets/images/mirumi.png"
            alt="みるみ"
            loading="lazy"
            width="48"
            height="48"
          />
          <img
            v-else
            src="@/assets/images/profile_icon.png"
            class="default"
            alt="comment author"
            loading="lazy"
            width="45"
            height="44"
          />
        </div>
        <div class="info">
          <div class="name">
            {{ c.authorName }}
          </div>
          <div class="timestamp">
            {{ formatTimestamp(c.createdAt) }}
          </div>
        </div>
        <div class="link">
          <PartsHashLink :hash-link="`#comment-${c.id}`" :hover="hover" />
        </div>
      </div>
      <!-- contentHtml は build 時に段落化・linkify・sanitize 済み -->
      <div class="content" v-html="c.contentHtml"></div>
      <div class="reply_button">
        <!-- Using this with `v-show` breaks the dynamic width calculation -->
        <button type="button" @click="isOpenReply = !isOpenReply">{{
          isOpenReply ? "やめる" : "返信する"
        }}</button>
      </div>
    </div>
    <div v-if="isOpenReply" class="reply">
      <ModulesCommentForm :parent-id="c.id" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BuildComment } from "shared/comments"

defineProps<{
  c: BuildComment
  depth: number
}>()

const isOpenReply = ref(false)
const hover = ref(false)

// 旧 WordPress の comment_date（JST）と同じ見た目。build は UTC で走るので timezone を固定する
const formatTimestamp = (isoformat: string) => {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoformat))
}
</script>

<style lang="scss" scoped>
.comment_base {
  .comment {
    margin: 3em 0 0.7em;

    .meta_data {
      position: relative;
      display: flex;
      align-items: center;

      .icon {
        margin-right: 1.5em;

        img {
          display: block;
          width: 48.33px;
          height: 47.7px;
          padding: 1px;
          border: solid 1.9px #e6e4e3;
          border-radius: 50%;

          &.default {
            transform: scale(0.93);

            @include mobile {
              transform: scale(0.87);
            }
          }

          @include mobile {
            transform: scale(0.9);
          }
        }

        @include mobile {
          margin-right: 0.7em;
        }
      }

      .info {
        margin-bottom: 3px;
        font-size: 0.9em;

        .name {
        }

        .timestamp {
          color: #999999;
          font-size: 0.85em;
        }
      }

      .link {
        position: absolute;
        right: 3em;
        top: 1.3em;
        bottom: 0;
      }
    }

    .content {
      margin: 0.7em 0 0;
      padding-left: 0.23em;
      padding-right: 1em;
    }

    &.depth-2 {
      padding-left: calc(1.07em * 1);
    }

    &.depth-3 {
      padding-left: calc(1.07em * 2);
    }

    &.depth-4 {
      padding-left: calc(1.07em * 3);
    }

    .reply_button {
      text-align: right;

      button {
        display: inline-block;
        margin-right: 1em;
        padding: 0.25em 1em 0.3em;
        font-size: 0.73em;
        font-weight: bold;
        font-family: var(--font-family);
        line-height: 1.5;
        text-align: center;
        text-decoration: none;
        color: #887a76;
        border: 1.9px solid #887a76;
        border-radius: 7px;
        background-color: var(--color-background);
        box-shadow: none;
        cursor: pointer;
        user-select: none;
        transition: all 0.13s ease-out;

        &:hover {
          opacity: 0.7;
          filter: contrast(0.9);
        }
      }
    }
  }

  .reply {
    .comment_form {
      margin-top: 1em;
    }
  }
}

.dark {
  .comment_base {
    .reply_button {
      button {
        color: #887a76;
        border-color: #887a76;
      }
    }
  }
}
</style>
