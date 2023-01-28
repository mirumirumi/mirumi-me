<template>
  <div class="post_view article_layout">
    <main role="main">
      <header>
        <h1 class="title">
          {{ post.title }}
        </h1>
        <div class="thumbnail">
          <img :src="post.thumbnail_url.replace(/\.(png|jpg|jpeg)$/gmi, '.webp')" :alt="post.title" width="1200" height="630">
        </div>
        <div class="meta" role="contentinfo">
          <div class="category">
            <span>かてごり: </span>
            <NuxtLink :to="`/category/${post.category_slug}`">{{ post.category_name }}</NuxtLink>
          </div>
          <div class="created_at">
            <span>投稿日: </span>
            <time :datetime="post.date">{{ friendlyDatetime(post.date) }}</time>
          </div>
          <div class="updated_at">
            <span>更新日: </span>
            <time :datetime="post.modified">{{ friendlyDatetime(post.modified) }}</time>
          </div>
          <div class="author">
            <span>書いた人: </span>
            <a :href="`https://twitter.com/${appConfig.twitterName}`" target="_blank" rel="nofollow">＠みるみ</a>
          </div>
        </div>
        <div class="share">
          <ModulesShareButtons :slug="slug" :title="post.title" :counts="counts" />
        </div>
      </header>
      <article>
        <div id="content" v-html="post.content" @click="clickHandle"></div>
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

const slug = route.params.post as string

const { data } = await useFetch(`/mirumi/post_data/${slug}`, {
  baseURL: appConfig.baseURL,
  parseResponse: JSON.parse,
})
const post = data.value as Record<string, any>

const counts = {
  twitter: Number(post.twitter),
  hatebu: Number(post.hatebu),
  feedly: Number(post.feedly),
  pocket: Number(post.pocket),
  like: Number(post.like),
}

post.content = post.content.replace(
  /<pre( class=\"(.*?)\")?>/gmi,
  "<pre class=\"language-$2\"><code class=\"$2 language-$2\">"
).replace(
  /<\/pre>/gmi,
  "</code></pre>"
)

useHead({ script: [{ src: "/assets/prism.js", defer: true }] })

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
  title: post.title,
  description: post.meta_description,
  keywords: post.meta_keywords,
  url: appConfig.siteFullPath + "/" + slug,
  createdAt: post.date,
  updatedAt: post.modified,
})
</script>
