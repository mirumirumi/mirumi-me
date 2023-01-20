<template>
  <div class="page_base article_layout">
    <main>
      <header>
        <h1 class="title">
          {{ page.title }}
        </h1>
        <div v-if="slug === 'nice-to-meet-you-10'" class="thumbnail">
          <img :src="page.thumbnail_url.replace(/\.(png|jpg|jpeg)$/gmi, '.webp')" :alt="page.title" width="1200" height="630">
        </div>
      </header>
      <article>
        <div id="content" v-html="page.content" @click="clickHandle"></div>
      </article>
    </main>
    <Teleport to="body">
      <ClientOnly>
        <PartsTopButton />
      </ClientOnly>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const appConfig = useAppConfig()

const slug = route.name as string

const { data } = await useFetch(`/mirumi/page_data/${slug}`, {
  baseURL: appConfig.baseURL,
  parseResponse: JSON.parse,
})
const page = data.value as Record<string, any>

const clickHandle = (e: any) => {
  const link = e.target.closest("a")
  if (!link)
    return

  const to = link.getAttribute("href")
  if (to.startsWith(appConfig.siteFullPath)) {
    // In case of `https://mirumi.me/slug`
    e.preventDefault()
    navigateTo(to.replace(appConfig.siteFullPath, ""))
  } else if (!to.startsWith("/")) {
    // In case of normal external links
    return    
  }

  if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey)
    // For open new tab etc
    return

  // In case of start with `/slug` 
  e.preventDefault()
  navigateTo(to)
}

useSetMeta({
  title: page.title,
  description: page.meta_description,
  keywords: page.meta_keywords,
  url: appConfig.siteFullPath + "/" + slug,
  createdAt: page.date,
  updatedAt: page.modified,
})
</script>

<style lang="scss" scoped>
.page_base {
  
}
</style>
