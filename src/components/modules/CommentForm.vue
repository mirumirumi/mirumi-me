<template>
  <div class="comment_form">
    <h3 class="title">
      {{ reply_to === "0" ? "新しいコメントを書く" : "このコメントに返信する" }}
    </h3>
    <div class="description">
      <ul>
        <li
          >必須項目はコメント本文のみですが、お名前はぜひご記入いただけると嬉しいです。<br />
          ※メールアドレスを書いた場合も公開されることはないのでご安心ください。</li
        >
        <li v-if="reply_to === '0'"
          >特定のコメントに返信したい場合は各コメントにある「返信する」ボタンからどうぞ。</li
        >
        <li
          >コメントはこちらで承認の作業を行うまでは表示されません。ご了承ください。<br />
          ※ここ数年スパムが激化しており、誤って削除されてしまうケースが増えてきました。スパムボックスも毎日自分の目で確認するようにはしているのですが、どうしても限界があります。確実に僕に連絡を取りたい方は
          <a href="mailto:mail@mirumi.me">メール</a> か
          <a
            :href="`https://x.com/${appConfig.twitterName}`"
            target="_blank"
            rel="nofollow"
            >X</a
          >
          からお願いします。</li
        >
      </ul>
    </div>
    <form autocomplete="off">
      <div class="form" style="margin-bottom: 1.7em">
        <label for="comment" class="form_label">
          コメント
          <span class="required">*</span>
        </label>
        <textarea
          id="comment"
          class="input"
          cols="43"
          rows="8"
          maxlength="5555"
          v-model="comment"
          required
        />
      </div>
      <div class="form">
        <label for="name" class="form_label">おなまえ</label>
        <input
          type="text"
          id="name"
          class="input"
          v-model="name"
          autocomplete="on"
          placeholder="匿名"
        />
      </div>
      <div class="form">
        <label for="email" class="form_label">メールアドレス</label>
        <input
          type="email"
          id="email"
          class="input"
          v-model="email"
          autocomplete="on"
          placeholder="mail@example.com"
        />
      </div>
      <div class="button">
        <PartsBaseButton
          :type="'fill'"
          :isSubmitButton="true"
          :isSubmitting="isSubmitting"
          @click="submit"
        >
          コメントを送信する
        </PartsBaseButton>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { useToast } from "vue-toastification/dist/index.mjs"

const p = withDefaults(
  defineProps<{
    reply_to?: string
  }>(),
  {
    reply_to: "0",
  }
)

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const appConfig = useAppConfig()
const toast = useToast()

const slug = route.params.post as string
const isSubmitting = ref(false)
const comment = ref("")
const name = ref("")
const email = ref("")

const submit = async () => {
  if (comment.value.length === 0) {
    toast.error("コメント本文を入力してください")
    return
  }

  isSubmitting.value = true

  const { data: postId } = await useFetch(`/mirumi/post_id_with_post_slug/${slug}`, {
    baseURL: appConfig.baseURL,
    parseResponse: JSON.parse,
  })

  const { error } = await useFetch(`/wp/v2/comments`, {
    baseURL: appConfig.baseURL,
    method: "POST",
    headers: {
      Authorization: `Basic ${window.btoa(
        runtimeConfig.userName + ":" + runtimeConfig.applicationPassword
      )}`,
    },
    body: {
      author_email: email.value !== "" ? email.value : "",
      author_name: name.value !== "" ? name.value : "匿名",
      content: {
        raw: comment.value,
      },
      parent: p.reply_to,
      post: postId.value,
    },
  })
  if (error.value) {
    isSubmitting.value = false
    toast.error("コメントを送信できませんした。再度お試しください")
    return
  }

  isSubmitting.value = false
  toast.success("コメントが投稿されました。承認までしばらくお待ちください")

  comment.value = ""
  name.value = ""
  email.value = ""
}
</script>

<style lang="scss" scoped>
.comment_form {
  margin-top: 5em;
  .description {
    margin-bottom: 1.7em;
    font-size: 0.7em;
    line-height: 1.5;
    ul {
      padding-left: 2em;
      li {
        margin: 0.5em 0;
        list-style: disc;
      }
      @include mobile {
        padding-left: 1.2em;
      }
    }
  }
  form {
    label {
      .required {
        margin-left: 0em;
        padding: 0;
        color: #ff5151;
        font-size: 1em;
        background: none;
        transform: translateY(0.05em);
      }
    }
    .button {
      margin-top: 2.3em;
      text-align: center;
    }
  }
  @include mobile {
    padding: 0 0.3em;
  }
}
</style>
