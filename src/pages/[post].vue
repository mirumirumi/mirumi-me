<template>
  <div class="post_view article_layout">
    <main role="main" itemscope itemtype="https://schema.org/Blog">
      <header itemscope itemprop="blogPost" itemtype="https://schema.org/BlogPosting">
        <h1 class="title page_transition_target" itemprop="headline">
          {{ post.title }}
        </h1>
        <div class="thumbnail page_transition_target" itemprop="image" itemscope itemtype="https://schema.org/ImageObject">
          <img :src="post.thumbnail_url.replace(/\.(png|jpg|jpeg)$/gmi, '.webp')" :alt="post.title" width="1200" height="630">
          <meta itemprop="url" :content="post.thumbnail_url" />
          <meta itemprop="width" content="1200" />
          <meta itemprop="height" content="630" />
        </div>
        <div class="meta page_transition_target" role="contentinfo">
          <div class="category">
            <span>かてごり: </span>
            <NuxtLink :to="`/category/${post.category_slug}`">{{ post.category_name }}</NuxtLink>
          </div>
          <div class="created_at">
            <span>投稿日: </span>
            <time :datetime="post.date" itemprop="datePublished">{{ friendlyDatetime(post.date) }}</time>
          </div>
          <div class="updated_at">
            <span>更新日: </span>
            <time :datetime="post.modified" itemprop="dateModified">{{ friendlyDatetime(post.modified) }}</time>
          </div>
          <div class="author">
            <span>書いた人: </span>
            <a :href="`https://twitter.com/${appConfig.twitterName}`" target="_blank" rel="nofollow">＠みるみ</a>
          </div>
        </div>
        <div class="share page_transition_target">
          <ModulesShareButtons :slug="slug" :title="post.title" :counts="counts" />
        </div>
      </header>
      <article class="page_transition_target">
        <div id="content" v-html="post.content" @click="clickHandle" itemprop="mainEntityOfPage"></div>
      </article>
      <footer>
        <div class="share">
          <ModulesShareButtons :slug="slug" :title="post.title" :counts="counts" />
        </div>
        <div class="profile">
          <ModulesProfileBox :category="post.category_slug" />
        </div>
      </footer>
      <ModulesCommentList />
      <ModulesCommentForm />
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

// To suppress a workload for WordPress server
if (process.server) await delay(999)

const slug = route.params.post as string

const { data } = await useFetch(`/mirumi/post_data/${slug}`, {
  baseURL: appConfig.baseURL,
  parseResponse: JSON.parse,
})
const post = data.value as Record<string, any>
if (!post) throw createError({ statusCode: 404, statusMessage: "Invalid page fetched" })

const counts = {
  twitter: Number(post.twitter),
  hatebu: Number(post.hatebu),
  feedly: Number(post.feedly),
  pocket: Number(post.pocket),
  like: Number(post.like),
}

useHead({ script: [{ src: "/assets/prism.js", defer: true }] })

const clickHandle = (e: any) => {
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
  title: post.title,
  description: post.meta_description,
  keywords: post.meta_keywords,
  url: appConfig.siteFullPath + "/" + slug,
  createdAt: post.date,
  updatedAt: post.modified,
  thumbnail: post.thumbnail_url,
})
</script>
