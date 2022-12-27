<template>
  <div class="index_view">
    
  </div>
</template>

<script setup lang="ts">





const appConfig = useAppConfig()

useSetMeta({
  title: "みるめも",
  description: "呆れるほど話題に統一感のない雑記ブログ。",
  keywords: "みるめも,みるみ,ブログ,雑記ブログ",
  url: appConfig.siteFullPath,
  createdAt: appConfig.createdAt,
  updatedAt: today(),
})
</script>

<style lang="scss" scoped>
.index_view {

}
</style>
