<template>
  <div class="page_base article_layout">
    <main role="main" itemscope itemtype="https://schema.org/Blog">
      <header itemscope itemprop="blogPost" itemtype="https://schema.org/BlogPosting">
        <h1 class="title page_transition_target" itemprop="headline">
          {{ page.title }}
        </h1>
        <div
          v-if="slug.startsWith('nice-to-meet-you-10') && page.thumbnailUrls"
          class="thumbnail page_transition_target"
          itemprop="image"
          itemscope
          itemtype="https://schema.org/ImageObject"
        >
          <picture>
            <source media="(max-width: 428px)" :srcset="page.thumbnailUrls.mobile" />
            <img
              :src="page.thumbnailUrls.article"
              :alt="page.title"
              width="1200"
              height="630"
            />
          </picture>
          <meta itemprop="url" :content="page.thumbnailUrls.article" />
          <meta itemprop="width" content="1200" />
          <meta itemprop="height" content="630" />
        </div>
      </header>
      <article class="page_transition_target">
        <div
          id="content"
          v-html="page.contentHtml"
          @click="useClickLink"
          itemprop="mainEntityOfPage"
        ></div>
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
import type { BuildPage } from "shared/build-manifest"
import { resolvePublicRoute } from "shared/site-routes"

const route = useRoute()
const appConfig = useAppConfig()

onMounted(async () => {
  await usePageTransition(0.7)
})

const slug = route.name as string
const publicRoute = resolvePublicRoute("page", slug)
if (!publicRoute) {
  throw createError({ statusCode: 404, statusMessage: "Page not found" })
}
const { data } = await useFetch<BuildPage>("/api/_build/page", {
  query: { route: publicRoute },
})
const page = data.value
if (!page || page.kind !== "page") {
  throw createError({ statusCode: 404, statusMessage: "Page not found" })
}
if (page.customCss) {
  useHead({ style: [{ textContent: page.customCss }] })
}

usePageInfo({
  title: page.title,
  url: appConfig.siteFullPath + "/" + slug,
  createdAt: page.publishedAt,
  updatedAt: page.updatedAt ?? page.publishedAt,
  thumbnail: page.ogImageUrl,
})
</script>
