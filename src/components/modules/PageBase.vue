<template>
  <div class="page_base article_layout">
    <main role="main" itemscope itemtype="https://schema.org/Blog">
      <header itemscope itemprop="blogPost" itemtype="https://schema.org/BlogPosting">
        <h1 class="title page_transition_target" itemprop="headline">
          {{ page.title }}
        </h1>
        <div v-if="slug === 'nice-to-meet-you-10'" class="thumbnail page_transition_target" itemprop="image" itemscope itemtype="https://schema.org/ImageObject">
          <img :src="page.thumbnail_url.replace(/\.(png|jpg|jpeg)$/gmi, '.webp')" :alt="page.title" width="1200" height="630">
          <meta itemprop="url" :content="page.thumbnail_url" />
          <meta itemprop="width" content="1200" />
          <meta itemprop="height" content="630" />
        </div>
      </header>
      <article class="page_transition_target">
        <div id="content" v-html="page.content" @click="handleClick" itemprop="mainEntityOfPage"></div>
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

const slug = route.name as string

const { data } = await useFetch(`/mirumi/page_data/${slug}`, {
  baseURL: appConfig.baseURL,
  parseResponse: JSON.parse,
})
const page = data.value as Record<string, any>

const handleClick = (e: any) => {
  const link = e.target.closest("a")
  if (!link) return

  const to = link.getAttribute("href")
  if (to.startsWith(appConfig.siteFullPath)) {
    // In case of `https://mirumi.me/slug`
    e.preventDefault()
    navigateTo(to.replace(appConfig.siteFullPath, ""))
  } else if (!to.startsWith("/")) {
    // In case of normal external links
    return    
  }

  if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) {
    // For open new tab etc
    return
  }

  // In case of start with `/slug` 
  e.preventDefault()
  navigateTo(to)
}

usePageInfo({
  title: page.title,
  description: page.meta_description,
  keywords: page.meta_keywords,
  url: appConfig.siteFullPath + "/" + slug,
  createdAt: page.date,
  updatedAt: page.modified,
  thumbnail: page.thumbnail_url,
})
</script>
