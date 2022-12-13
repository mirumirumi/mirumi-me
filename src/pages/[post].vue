<template>
  <div class="post_view">
    
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const appConfig = useAppConfig()

const { data: resPosts } = await useFetch(`/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    slug: route.path.replace("/", ""),
  },
})
const post = JSON.parse(resPosts.value as string)[0]

console.log(post)

const { data: resTags } = await useFetch(`/tags`, {
  baseURL: appConfig.baseURL,
  params: {
    include: post.tags,
    _fields: "name",
  },
})
const tags = JSON.parse(resTags.value as string)

const { data: resMetaDesc } = await useFetch(`${appConfig.siteFullPath}/wp-json/cocoon/meta_description/${post.id}`)
const metaDesc = JSON.parse(resMetaDesc.value as string)







useSetMeta({
  title: post.title.rendered,
  description: metaDesc,
  keywords: tags.join(","),
  url: appConfig.siteFullPath + route.path,
  createdAt: post.date + "+09:00",
  updatedAt: post.modified + "+09:00",
})
</script>

<style lang="scss" scoped>
.post_view {
  
}
</style>
