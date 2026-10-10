<template>
  <div class="category_view_pages">
    <Index :pageNumber="Number($route.params.pageNumber)" />
  </div>
</template>

<script setup lang="ts">
import Index from "../index.vue"
</script>
