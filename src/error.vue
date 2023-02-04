<template>
  <div id="error">
    <ModulesTheHeader />
    <NotFoundPage v-if="error.statusCode === '404'" />
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

// ローカルサーバーモード(=SSR) では下記のコードで問題なく全てが動作する（404以外も含めて）が、S3 上に置いた状態だとどうやら 404 じゃないものが渡っている？らしく、すぐにリダイレクトされてしまうためこれは使わない。fatal: true が必須（クライアント扱い）なのも確認済み。
// if (p.error.statusCode !== "404") {
//   clearError({ redirect: "/" })
// }
</script>

<style lang="scss" scoped>
#error {}
</style>
