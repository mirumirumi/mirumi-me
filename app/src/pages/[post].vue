<template>
  <div class="post_view article_layout">
    <main role="main" itemscope itemtype="https://schema.org/Blog">
      <header itemscope itemprop="blogPost" itemtype="https://schema.org/BlogPosting">
        <h1 class="title page_transition_target" itemprop="headline">
          {{ post.title }}
        </h1>
        <div
          v-if="post.thumbnailUrls"
          class="thumbnail page_transition_target"
          itemprop="image"
          itemscope
          itemtype="https://schema.org/ImageObject"
        >
          <picture>
            <source
              media="(max-width: 428px)"
              :srcset="post.thumbnailUrls.mobile"
            />
            <img
              :src="post.thumbnailUrls.article"
              :alt="post.title"
              width="1200"
              height="630"
            />
          </picture>
          <meta itemprop="url" :content="post.thumbnailUrls.article" />
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
              <NuxtLink :to="`/category/${postCategory.slug}`">
                <span>{{ postCategory.name }}</span>
              </NuxtLink>
            </div>
            <div class="dates">
              <PartsSvgIcon :icon="'calendar_days'" :color="'var(--color-gray)'" />
              <span class="created_at">
                <time :datetime="post.publishedAt" itemprop="datePublished">{{
                  friendlyDatetime(post.publishedAt)
                }}</time>
              </span>
              <span v-if="post.updatedAt && post.publishedAt !== post.updatedAt" class="updated_at"
                ><span class="parentheses first">（</span>
                <PartsSvgIcon :icon="'clock_rotate_left'" :color="'var(--color-gray)'" />
                <time :datetime="post.updatedAt" itemprop="dateModified">{{
                  friendlyDatetime(post.updatedAt)
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
          v-html="contentHtml"
          @click="useClickLink"
          itemprop="mainEntityOfPage"
        ></div>
      </article>
      <footer>
        <div class="profile page_transition_target">
          <ModulesProfileBox :category="postCategory.slug" />
        </div>
      </footer>
      <PartsAdSenseBase :kind="'記事下ディスプレイ'" />
      <ModulesCommentList class="page_transition_target" :comments="post.comments" />
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
          :hover="hover[i] ?? false"
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
import type { BuildPage } from "shared/build-manifest"
import { resolvePublicRoute } from "shared/site-routes"

import * as cs from "@/assets/scripts/content-scripts"
import { insertAdSense } from "@/assets/scripts/insert-adsense"
import * as ps from "@/assets/scripts/post-scripts"

const route = useRoute()
const appConfig = useAppConfig()
const runtimeConfig = useRuntimeConfig()

const slug = route.params.post as string
const publicRoute = resolvePublicRoute("post", slug)
if (!publicRoute) {
  throw createError({ statusCode: 404, statusMessage: "Article not found" })
}
const { data } = await useFetch<BuildPage>("/api/_build/page", {
  query: { route: publicRoute },
})
const post = data.value
if (!post || post.kind !== "post" || !post.category) {
  throw createError({ statusCode: 404, statusMessage: "Article not found" })
}
const postCategory = post.category
useCurrentCategorySlug().value = postCategory.slug

// Insert Google AdSense before each h2
const contentHtml = insertAdSense(post.contentHtml, runtimeConfig.public.isProductionSite)

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

  // Load content scripts
  cs.loadYouTube()
  cs.switchTwitterColorTheme()
  void cs.hydrateAmazonCards(runtimeConfig.public.workersApiOrigin)

  // Insert toc hash links
  headings.value = Array.from(
    document.querySelectorAll<HTMLHeadingElement>(
      "#content h2, #content h3, #content h4, #content h5, #content h6",
    ),
  )
  headings.value.forEach((el, i) => {
    const headingContent = el.children.item(0)
    if (!headingContent) {
      return
    }

    // Bind mouse hover evenets for HashLink component
    el.addEventListener("mouseenter", () => onMouseEnter(i))
    el.addEventListener("mouseleave", () => onMouseLeave(i))
    // Give ids
    const spanId = `${headingContent.id}-heading`
    el.id = spanId
    tocIds.value.push(spanId)
  })

  // Load post scripts
  // biome-ignore lint/complexity/useOptionalChain: 既存踏襲
  ps.POST_SCRIPTS_MAP[slug] && ps.POST_SCRIPTS_MAP[slug](contentHtml)
})

onUnmounted(() => {
  headings.value.forEach((el, i) => {
    el.removeEventListener("mouseenter", () => onMouseEnter(i))
    el.removeEventListener("mouseleave", () => onMouseLeave(i))
  })
})

useHead({ script: [{ src: "/assets/prism.js", defer: true }] })
useHead({ script: [{ src: "https://platform.x.com/widgets.js", async: true }] })
if (post.customCss) {
  useHead({ style: [{ textContent: post.customCss }] })
}

usePageInfo({
  title: post.title,
  url: appConfig.siteFullPath + "/" + slug,
  createdAt: post.publishedAt,
  updatedAt: post.updatedAt ?? post.publishedAt,
  thumbnail: post.ogImageUrl,
})

// Don't use scoped <style> because this component scoped style has overridden styles of `content.scss`
</script>
