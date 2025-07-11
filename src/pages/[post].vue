<template>
  <div class="post_view article_layout">
    <main role="main" itemscope itemtype="https://schema.org/Blog">
      <header itemscope itemprop="blogPost" itemtype="https://schema.org/BlogPosting">
        <h1 class="title page_transition_target" itemprop="headline">
          {{ post.title }}
        </h1>
        <div class="meta page_transition_target" role="contentinfo">
          <div class="meta_block">
            <div class="author">
              <PartsSvgIcon :icon="'at'" :color="'var(--color-gray)'" />
              <a
                :href="`https://x.com/${appConfig.twitterName}`"
                target="_blank"
                rel="nofollow"
                >みるみ</a
              >
            </div>
            <div class="category">
              <PartsSvgIcon :icon="'folder'" :color="'var(--color-gray)'" />
              <NuxtLink :to="`/category/${post.category_slug}`">{{
                post.category_name
              }}</NuxtLink>
            </div>
            <div class="dates">
              <PartsSvgIcon :icon="'calendar_days'" :color="'var(--color-gray)'" />
              <span class="created_at">
                <time :datetime="post.date" itemprop="datePublished">{{
                  friendlyDatetime(post.date)
                }}</time>
              </span>
              <span class="updated_at"
                ><span class="parentheses first">（</span>
                <PartsSvgIcon :icon="'clock_rotate_left'" :color="'var(--color-gray)'" />
                <time :datetime="post.modified" itemprop="dateModified">{{
                  friendlyDatetime(post.modified)
                }}</time>
                <span class="parentheses">）</span></span
              >
            </div>
          </div>
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

const { data } = await useFetch(`/mirumi/post_data/${slug}`, {
  baseURL: appConfig.baseURL,
})
// biome-ignore lint:
const post = data.value as any

// Insert Google AdSense before each h2
post.content = insertAdSense(post.content)

// Exec content scripts
onMounted(() => {
  cs.loadYouTube()
})

useHead({ script: [{ src: "/assets/prism.js", defer: true }] })
useHead({ script: [{ src: "https://platform.x.com/widgets.js", async: true }] })

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
