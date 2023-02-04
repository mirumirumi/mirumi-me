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

if (p.error.statusCode !== "404") {
  clearError({ redirect: "/" })
}
</script>

<style lang="scss" scoped>
#error {}
</style>
