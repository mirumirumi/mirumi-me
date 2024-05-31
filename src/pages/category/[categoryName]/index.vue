<template>
  <div class="category_view indexes_single_column">
    <h1 class="title">
      {{ category.categoryName }}
      {{ category.categoryName === "雑記" ? "&nbsp;&nbsp;...です" : "に関する記事" }}
    </h1>
    <ModulesPaginationBase
      :currentPage="page"
      :pageCount="pageCount"
      :itemCount="itemCount"
      :isCsr="false"
      style="margin-top: 0"
    />
    <ModulesPostIndexes :posts="posts" />
    <ModulesPaginationBase
      :currentPage="page"
      :pageCount="pageCount"
      :itemCount="itemCount"
      :isCsr="false"
    />
    <Teleport to="body">
      <ClientOnly>
        <PartsTopButton />
      </ClientOnly>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { PageSummary } from "@/utils/defines"

const p = defineProps<{
  pageNumber?: number
}>()

const route = useRoute()
const appConfig = useAppConfig()

/**
 * Prepare post list
 */
const page = ref(Number(p.pageNumber ?? 1))
const posts = ref<PageSummary[]>([])
const pageCount = ref(0)
const itemCount = ref(0)

const { data: resCategory } = await useFetch(
  `/mirumi/category_id_with_category_slug/${route.params.categoryName}`,
  {
    baseURL: appConfig.baseURL,
  }
)

// Hack for JSON parse error (unexpected token)
// biome-ignore lint:
const category = JSON.parse(JSON.stringify(resCategory.value as any))

const { data, refresh } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: page.value,
    per_page: appConfig.perPage,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [Number(category.categoryId)],
    _fields: "id",
  },
  parseResponse: JSON.parse,
  onResponse: ({ response }) => {
    pageCount.value = Number(response.headers.get("x-wp-totalpages"))
    itemCount.value = Number(response.headers.get("x-wp-total"))
  },
})

// FIXME: `onResponse` does not work at page first loading, so I have no choice but to run it 2 times (#1)
await refresh()

const postIdObjs = data.value as Record<string, number>[]
if (postIdObjs.length === 0) {
  posts.value = []
}

const postIds: number[] = []
for (const p of postIdObjs) {
  postIds.push(p.id)
}

const { data: postSummaries } = await useFetch(
  `/mirumi/post_summaries_with_post_ids/${(postIds as number[]).join(",")}`,
  {
    baseURL: appConfig.baseURL,
    parseResponse: JSON.parse,
  }
)
posts.value = postSummaries.value as PageSummary[]

/**
 * Prepare category page content body
 */
const { data: resCategoryContent } = await useFetch(
  `/mirumi/category_content/${category.categoryId}`,
  {
    baseURL: appConfig.baseURL,
    parseResponse: JSON.parse,
  }
)
const content = resCategoryContent.value as Record<string, string>

/**
 * Utils
 */
usePageInfo({
  title: category.categoryName,
  description: content.meta_description,
  keywords: content.meta_keywords,
  url: appConfig.siteFullPath + route.fullPath,
})
</script>

<style lang="scss" scoped>
h1.title {
  margin: 0 0 2em;
  padding: 0 0.1em;
  color: #554545;
  line-height: 1.5;
  font-size: 1.4em;
  font-weight: bold;
  text-align: center;
}
</style>
