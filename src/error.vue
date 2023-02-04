<template>
  <div id="error">
    <ModulesTheHeader />
    <NotFoundPage />
    <!-- Same as below comment -->
    <!-- <NotFoundPage v-if="error.statusCode === '404'" /> -->
    <ModulesTheFooter />
  </div>
</template>

<script setup lang="ts">
import NotFoundPage from "@/pages/404.vue"

const p = defineProps<{
  error: {
    message: string
    stack: string
    statusCode: string
    url: string
  }
}>()

// In local server mode (=SSR), the following code works fine (including non-404s), but when placed on S3, 
// it seems that non - 404s are being passed? (Mystery!), so I don't use this because they are immediately redirected.
// I have also confirmed that `fatal: true` is required (treated as a client).
// if (p.error.statusCode !== "404") {
//   clearError({ redirect: "/" })
// }

// onMounted(() => {
//   // このデプロイ方式では createError() したエラーを処理しきれないため、通常の id="app" が残ってしまう、ので消す
//   document.getElementById("app")?.remove()
// })
</script>

<style lang="scss" scoped>
#error {
  background-color: var(--color-background);
}
</style>
