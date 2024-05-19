<template>
  <div class="post_view article_layout">
    <main role="main" itemscope itemtype="https://schema.org/Blog">
      <header itemscope itemprop="blogPost" itemtype="https://schema.org/BlogPosting">
        <h1 class="title page_transition_target" itemprop="headline">
          {{ post.title }}
        </h1>
        <div
          class="thumbnail page_transition_target"
          itemprop="image"
          itemscope
          itemtype="https://schema.org/ImageObject"
        >
          <picture>
            <source
              :media="'(max-width: 428px)'"
              :srcset="thumbnailUrl.replace('.webp', '') + '-600x315.webp 600w'"
              :sizes="'600w'"
            />
            <source :srcset="thumbnailUrl + ' 1200w'" :sizes="'1200w'" />
            <img :src="thumbnailUrl" :alt="post.title" width="1200" height="630" />
          </picture>
          <meta itemprop="url" :content="post.thumbnail_url" />
          <meta itemprop="width" content="1200" />
          <meta itemprop="height" content="630" />
        </div>
        <div class="meta page_transition_target" role="contentinfo">
          <div class="grid_container">
            <div class="category">
              <span>かてごり: </span>
              <NuxtLink :to="`/category/${post.category_slug}`">{{
                post.category_name
              }}</NuxtLink>
            </div>
            <div class="created_at">
              <span>投稿日: </span>
              <time :datetime="post.date" itemprop="datePublished">{{
                friendlyDatetime(post.date)
              }}</time>
            </div>
            <div class="updated_at">
              <span>更新日: </span>
              <time :datetime="post.modified" itemprop="dateModified">{{
                friendlyDatetime(post.modified)
              }}</time>
            </div>
            <div class="author">
              <span>書いた人: </span>
              <a
                :href="`https://twitter.com/${appConfig.twitterName}`"
                target="_blank"
                rel="nofollow"
                >＠みるみ</a
              >
            </div>
          </div>
        </div>
        <div class="share page_transition_target">
          <ModulesShareButtons :slug="slug" :title="post.title" :counts="counts" />
        </div>
        <div
          class="display_none"
          itemprop="editor author creator copyrightHolder"
          itemscope
          itemtype="https://schema.org/Person"
        >
          <meta itemprop="url" :content="appConfig.siteFullPath" />
          <div itemprop="name">みるみ</div>
        </div>
      </header>
      <article class="page_transition_target">
        <div
          id="content"
          v-html="post.content"
          @click="useClickLink"
          itemprop="mainEntityOfPage"
        ></div>
      </article>
      <footer>
        <div class="share page_transition_target">
          <ModulesShareButtons :slug="slug" :title="post.title" :counts="counts" />
        </div>
        <div class="profile page_transition_target">
          <ModulesProfileBox :category="post.category_slug" />
        </div>
      </footer>
      <PartsAdSenseBase :kind="'記事下ディスプレイ'" />
      <ModulesCommentList class="page_transition_target" />
      <ModulesCommentForm class="page_transition_target" />
      <PartsAdSenseBase :kind="'Multiplex'" />
    </main>
    <Teleport to="body">
      <ClientOnly>
        <PartsTopButton />
      </ClientOnly>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import * as cs from "@/assets/scripts/content-scripts"
import { insertAdSense } from "@/assets/scripts/insert-adsense"

const route = useRoute()
const appConfig = useAppConfig()

onMounted(async () => {
  await usePageTransition(0.7)
})

const slug = route.params.post as string

let post: any = undefined
do {
  post = undefined

  const { data } = await useFetch(`/mirumi/post_data/${slug}`, {
    baseURL: appConfig.baseURL,
  })

  // Hack for JSON parse error (unexpected token)
  post = JSON.parse(JSON.stringify(data.value as any))

  if (typeof post === "string") {
    console.log("Failed to fetch the post, will retry. The post slug is:", slug)
    await delay(10000)
  }
} while (typeof post === "string")

const thumbnailUrl = post.thumbnail_url.replace(/\.(png|jpg|jpeg)$/gim, ".webp")

// Insert Google AdSense before each h2
post.content = insertAdSense(post.content)

const counts = ref({
  twitter: Number(post.twitter),
  hatebu: Number(post.hatebu),
  feedly: Number(post.feedly),
  pocket: Number(post.pocket),
  like: Number(post.like),
})

// Exec content scripts
onMounted(() => {
  cs.loadYouTube()
})

// Re-fetch page contents
onMounted(async () => {
  counts.value = await $fetch(`/mirumi/share_counts/${slug}`, {
    baseURL: appConfig.baseURL,
    parseResponse: JSON.parse,
  })
})

useHead({ script: [{ src: "/assets/prism.js", defer: true }] })
useHead({ script: [{ src: "https://platform.twitter.com/widgets.js", async: true }] })

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
