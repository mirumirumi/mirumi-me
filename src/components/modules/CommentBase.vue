<template>
  <div class="comment_base">
    <div :class="`comment depth-${depth}`" :id="`comment-${c.comment_ID}`">
      <div class="meta_data" @mouseenter="hover = true" @mouseleave="hover = false">
        <div class="icon">
          <img
            v-if="c.user_id === '1'"
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
            {{ c.comment_author === "" ? "匿名" : c.comment_author }}
          </div>
          <div class="timestamp">
            {{ formatTimestamp(c.comment_date) }}
          </div>
        </div>
        <div class="link">
          <ModulesHashLink :hash-link="`#comment-${c.comment_ID}`" :hover="hover" />
        </div>
      </div>
      <div class="content" v-html="formatContent(c.comment_content)"></div>
      <div class="reply_button">
        <PartsBaseButton :type="'outline'" @click="isOpenReply = !isOpenReply">
          {{ isOpenReply ? "やめる" : "返信する" }}
        </PartsBaseButton>
      </div>
    </div>
    <div v-if="isOpenReply" class="reply">
      <ModulesCommentForm :reply_to="c.comment_ID" />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  c: Record<string, any>
  depth: number
}>()

const isOpenReply = ref(false)
const hover = ref(false)

const formatContent = (content: string) => {
  return (
    content
      // https://regex101.com/r/DWX3oZ/1
      .replace(/(([^\r\n]+(\r?\n)?)+)/gim, "<p>$1</p>")
      // https://regex101.com/r/lUK6Rc/1
      .replaceAll(/\r?\n([^<])/gim, "<br />$1")
      // https://regex101.com/r/bjsDHH/1
      .replaceAll(
        /((<p>)|<br \/>)?(https?:\/\/[\w\/:;%#\$&\?\(\)~\.=\+\-]+)(\r?\n)?((<\/p>)|<br \/>)/gim,
        '$1<a href="$3" rel="nofollow ugc">$3</a>$5'
      )
  )
}

const formatTimestamp = (timestamp: string) => {
  return timestamp.replace(
    /(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}):\d{2}/gim,
    "$1/$2/$3 $4"
  )
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
        margin-right: 1em;
        padding: 0.25em 1em 0.3em;
        font-size: 0.73em;
        box-shadow: none;
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
