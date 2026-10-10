<template>
  <div id="comment_form" class="comment_form">
    <h3 class="title">
      {{ parentId === null ? "新しいコメントを書く" : "このコメントに返信する" }}
    </h3>
    <div v-if="parentId === null" class="description">
      <ul>
        <li
          >必須項目はコメント本文のみですが、お名前はぜひご記入いただけると嬉しいです。<br />
          ※メールアドレスを書いた場合も公開されることはないのでご安心ください。</li
        >
        <li
          >特定のコメントに返信したい場合は各コメントにある「返信する」ボタンからどうぞ。</li
        >
        <li>コメントはこちらで承認の作業を行うまでは表示されません。ご了承ください。</li>
      </ul>
    </div>
    <form autocomplete="off">
      <div class="form" style="margin-bottom: 1.7em;">
        <label for="comment" class="form_label">
          コメント
          <span class="required">*</span>
        </label>
        <textarea
          id="comment"
          class="input"
          cols="43"
          rows="8"
          :maxlength="MAX_COMMENT_CONTENT_LENGTH"
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
      <!-- Turnstile。SSG の HTML には空の箱だけを載せ、browser で widget を描く -->
      <div class="turnstile" ref="turnstileContainer"></div>
      <div class="button">
        <PartsBaseButton
          :type="'fill'"
          :isSubmitButton="true"
          :isSubmitting="isSubmitting"
          @click="submit"
          >コメントを送信する</PartsBaseButton
        >
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { MAX_COMMENT_CONTENT_LENGTH } from "shared/comments"

import { useToast } from "@/utils/vue-toastification"

// Worker 側の COMMENT_TURNSTILE_ACTION と一致させる
const TURNSTILE_ACTION = "comment"

const p = withDefaults(
  defineProps<{
    parentId?: string | null
  }>(),
  {
    parentId: null,
  },
)

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const toast = useToast()
const turnstile = useTurnstile(TURNSTILE_ACTION)

const slug = route.params.post as string
// Worker が返す error code ごとの文言。無いものは汎用の文言に倒す
const ERROR_MESSAGES: Record<string, string> = {
  turnstile: "スパム対策の確認に失敗しました。再度お試しください",
  "rate-limited": "送信が続きすぎています。少し時間をおいてから再度お試しください",
  "unknown-article": "この記事にはコメントできません。ページを再読み込みしてください",
  "unknown-parent": "返信先のコメントが見つかりません。ページを再読み込みしてください",
  origin: "このページからはコメントを送信できません",
}
const turnstileContainer = ref<HTMLElement | null>(null)
const isSubmitting = ref(false)
const comment = ref("")
const name = ref("")
const email = ref("")
// 不明時（通信断など）の再試行で二重投稿にならないよう、受付が確定するまで同じ request ID を使う
let requestId = crypto.randomUUID()

onMounted(async () => {
  if (!turnstileContainer.value) {
    return
  }
  try {
    await turnstile.render(turnstileContainer.value)
  } catch {
    toast.error("スパム対策の読み込みに失敗しました。ページを再読み込みしてください")
  }
})

onUnmounted(() => {
  turnstile.remove()
})

const submit = async () => {
  if (comment.value.trim().length === 0) {
    toast.error("コメント本文を入力してください")
    return
  }
  if (!turnstile.token.value) {
    toast.error("スパム対策の確認が終わるまで少しお待ちください")
    return
  }

  isSubmitting.value = true
  let status: number | null = null
  let errorCode: string | null = null
  try {
    const response = await fetch(`${runtimeConfig.public.workersApiOrigin}/api/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        parentId: p.parentId,
        authorName: name.value,
        authorEmail: email.value,
        content: comment.value,
        requestId,
        turnstileToken: turnstile.token.value,
      }),
    })
    status = response.status
    errorCode = await readErrorCode(response)
  } catch {
    status = null
  }
  isSubmitting.value = false
  // token は single-use なので、成功・失敗どちらでも次の送信のために作り直す
  turnstile.reset()

  if (status === 202) {
    toast.success("コメントが投稿されました。承認までしばらくお待ちください")
    requestId = crypto.randomUUID()
    comment.value = ""
    name.value = ""
    email.value = ""
    return
  }
  toast.error(
    ERROR_MESSAGES[errorCode ?? ""] ?? "コメントを送信できませんでした。再度お試しください",
  )
}

const readErrorCode = async (response: Response): Promise<string | null> => {
  if (response.ok) {
    return null
  }
  try {
    const body: unknown = await response.json()
    return typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
      ? body.error
      : null
  } catch {
    return null
  }
}
</script>

<style lang="scss" scoped>
.comment_form {
  margin-top: 4em;

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
      font-size: 0.9em;

      .required {
        margin-left: 0em;
        padding: 0;
        color: #ff5151;
        font-size: 1em;
        background: none;
        transform: translateY(0.05em);
      }
    }

    .turnstile {
      display: flex;
      justify-content: center;
      min-height: 65px;
      padding-top: 10px;
      margin-bottom: -5px;
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

.dark {
  .comment_form {
    form {
      label {
        .required {
          color: #d77777;
        }
      }
    }
  }
}
</style>
