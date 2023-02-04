<template>
  <NotFoundView />
</template>

<script setup lang="ts">
import NotFoundView  from "@/pages/404.vue"

const p = defineProps<{
  error: Object
}>()

console.error(p.error)

// Handle for the 404 error by `createError()`
clearError()
</script>
