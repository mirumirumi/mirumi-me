<template>
  <div class="contact_view article_layout">
    <main>
      <header>
        <h1 class="title page_transition_target">
          お問い合わせ
        </h1>
      </header>
      <article class="page_transition_target">
        <div id="content">
          <p>各種サービスに関するお問い合わせ、広告掲載や PR 記事の執筆依頼などを受け付けています。<br />ご意見・ご感想などももちろん嬉しいです…！お気軽にどうぞ。</p>
          <p>よりフランクな連絡手段をご希望の場合は <a :href="`https://twitter.com/${appConfig.twitterName}`" target="_blank" rel="nofollow">Twitter</a> もご検討ください。</p>
          <div class="box-common box-alert" style="margin-bottom: 5em;">
          <p>全てへの返信はお約束できませんが、必ず目は通していますのでご安心ください。</p>
          </div>
          <form autocomplete="off">
            <div class="form">
              <label for="name" class="form_label">
                ご氏名
                <span class="required">必須</span>
              </label>
              <input type="text" id="name" class="input" name="text-74" v-model="name" autocomplete="on" placeholder="みるみ" required />
            </div>
            <div class="form">
              <label for="email" class="form_label">
                ご連絡先メールアドレス
                <span class="required">必須</span>
              </label>
              <input type="email" id="email" class="input" name="your-email" v-model="email" autocomplete="on" placeholder="mail@example.com" required />
            </div>
            <div class="form">
              <label for="subject" class="form_label">
                件名
                <span class="no_required">任意</span>
              </label>
              <input type="text" id="subject" class="input" name="your-subject" v-model="subject" autocomplete="on" placeholder="今度お茶しませんか" />
            </div>
            <div class="form">
              <label for="body" class="form_label">
                お問い合わせ内容
                <span class="required">必須</span>
              </label>
              <textarea id="body" class="input" name="your-message" cols="43" rows="10" maxlength="5555" v-model="body" required />
            </div>
            <div class="button">
              <PartsBaseButton
                :type="'fill'"
                :isSubmitButton="true"
                :isSubmitting="isSubmitting"
                @click="submit"
              >
                送信する
              </PartsBaseButton>
            </div>
          </form>
        </div>
      </article>
    </main>
  </div>
</template>

<script setup lang="ts">
import { useToast } from "vue-toastification/dist/index.mjs"

const route = useRoute()
const appConfig = useAppConfig()
const toast = useToast()

// Page transition
onMounted(async () => {
  await delay(1)  // 🤔
  const nodes = document.querySelectorAll(".page_transition_target")
  let duration = 131.3
  for (const n of nodes) {
    n.classList.add("run")
    await delay(duration)
    duration *= 0.7
  }
})

const isSubmitting = ref(false)
const name = ref("")
const email = ref("")
const subject = ref("")
const body = ref("")

const submit = async () => {
  switch (0) {
    case name.value.length: 
      toast.error("おなまえを入力してください")
      return
    case email.value.length: 
      toast.error("メールアドレスを入力してください")
      return
    case body.value.length: 
      toast.error("本文を入力してください")
      return
  }

  isSubmitting.value = true

  const { error } = await useFetch(`https://wxdwbxfdjdqc7ekpokyjnhmhd40dcldj.lambda-url.ap-northeast-1.on.aws/`, {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data",
    },
    body: {
      name: name.value,
      email: email.value,
      subject: subject.value,
      body: body.value,
    },
  })
  if (error.value) {
    isSubmitting.value = false
    toast.error("お問い合わせ内容を送信できませんした。再度お試しください")
    return
  }

  isSubmitting.value = false
  toast.success("お問い合わせ内容は正常に送信されました")

  name.value = ""
  email.value = ""
  subject.value = ""
  body.value = ""
}

usePageInfo({
  title: "お問い合わせ",
  description: "みるめも、もしくは運営者自身へのお問い合わせ等を受け付けているページです。",
  keywords: "みるめも,お問い合わせ,Contact,Inquiry",
  url: appConfig.siteFullPath + route.fullPath,
  createdAt: appConfig.createdAt,
  updatedAt: today(),
})
</script>

<style lang="scss" scoped>
.contact_view {
  form {
    .button {
      margin-top: 2.7em;
      text-align: center;
    }
  }
}
</style>
