<template>
  <div class="category_view">
    
  </div>
</template>

<script setup lang="ts">



useSetMeta({
  title: category.categoryName,
  description: content.meta_description,
  keywords: content.meta_keywords,
  url: appConfig.siteFullPath + route.fullPath,
})
</script>

<style lang="scss" scoped>
.category_view {
  
}
</style>
