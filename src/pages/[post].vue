<template>
  <div class="post_view article_layout">
    <main role="main" itemscope itemtype="https://schema.org/Blog">
      <header itemscope itemprop="blogPost" itemtype="https://schema.org/BlogPosting">
        <h1 class="title page_transition_target" itemprop="headline">
          {{ post.title }}
        </h1>
        <div
          v-if="post.show_thumbnail_on_frontend"
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
    <ClientOnly>
      <Teleport to="body">
        <PartsTopButton />
      </Teleport>
      <Teleport v-for="[i, tocId] in tocIds.entries()" :to="`#${tocId}`" :key="tocId">
        <PartsHashLink
          :hash-link="`#${tocId.replace('-heading', '')}`"
          :hover="hover[i]"
          style="
            position: absolute;
            top: 0.6em;
            bottom: 0;
            right: 2.1em;
            font-size: 0.8em;
          "
        />
      </Teleport>
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import * as cs from "@/assets/scripts/content-scripts"
import { insertAdSense } from "@/assets/scripts/insert-adsense"

const route = useRoute()
const appConfig = useAppConfig()

const slug = route.params.post as string
const { data } = await useFetch(`/mirumi/post_data/${slug}`, {
  baseURL: appConfig.baseURL,
})
const post = data.value as any
const thumbnailUrl = post.thumbnail_url.replace(/\.(png|jpg|jpeg)$/gim, ".webp")

// Insert Google AdSense before each h2
post.content = insertAdSense(post.content)

const headings = ref<Array<HTMLHeadingElement>>([])
const tocIds = ref<Array<string>>([])
const hover = ref<Array<boolean>>([])
const onMouseEnter = (index: number) => {
  hover.value[index] = true
}
const onMouseLeave = (index: number) => {
  hover.value[index] = false
}

onMounted(async () => {
  await usePageTransition(0.7)

  // Exec content scripts
  cs.loadYouTube()

  // Insert toc hash links
  headings.value = Array.from(
    document.querySelectorAll<HTMLHeadingElement>(
      "#content h2, #content h3, #content h4, #content h5, #content h6"
    )
  )
  headings.value.forEach((el, i) => {
    // Bind mouse hover evenets for HashLink component
    el.addEventListener("mouseenter", () => onMouseEnter(i))
    el.addEventListener("mouseleave", () => onMouseLeave(i))
    // Give ids
    const spanId = `${el.children[0].id}-heading`
    el.id = spanId
    tocIds.value.push(spanId)
  })
  // tocIds.value = Array.from(document.querySelectorAll<HTMLAnchorElement>('[id^="toc"]'))
  //   .filter((el) => /^toc\d+$/.test(el.id))
  //   .map((el) => el.id)
})

onUnmounted(() => {
  headings.value.forEach((el, i) => {
    el.removeEventListener("mouseenter", () => onMouseEnter(i))
    el.removeEventListener("mouseleave", () => onMouseLeave(i))
  })
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

// Don't use scoped <style> because this component scoped style has overridden styles of `content.scss`
</script>
