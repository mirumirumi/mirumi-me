<template>
  <div class="_404_view article_layout">
    <main>
      <header>
        <h1 class="title page_transition_target">
          お探しのページを見つけられません <span style="font-family: initial;">(´｡･ڡ･｡`)</span>
        </h1>
      </header>
      <div class="image page_transition_target">
        <img src="@/assets/images/404.png" alt="not-found">
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
const p = defineProps<{
  error: Object
}>()

const route = useRoute()
const appConfig = useAppConfig()

// Handle for the 404 error by `createError()`
console.log(p.error)
await clearError()

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

usePageInfo({
  title: "ちょっと惜しかったみたいです",
  description: "指定されたページは現在サーバー上に存在していません。",
  keywords: "みるめも,404,Not Found",
  url: appConfig.siteFullPath + route.fullPath,
  createdAt: appConfig.createdAt,
  updatedAt: today(),
})
</script>

<style lang="scss" scoped>
._404_view {
  .title {
    text-align: center;
  }
  .image {
    img {
      display: block;
      width: 77.7%;
      max-width: 222px;
      margin: 100px auto 111px;
    }
  }
}
</style>
