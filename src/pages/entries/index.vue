<template>
  <div class="entries_view indexes_single_column">
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

const page = ref(Number(p.pageNumber ?? 1))
const posts = ref<PageSummary[]>([])
const pageCount = ref(0)
const itemCount = ref(0)

const { data, refresh } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: page.value,
    per_page: appConfig.perPage,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories_exclude: [1877], // Software Design
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

usePageInfo({
  title: "記事一覧",
  description: "呆れるほど話題に統一感のない雑記ブログ。",
  keywords: "みるめも,みるみ,ブログ,雑記ブログ",
  url: appConfig.siteFullPath + route.fullPath,
  createdAt: appConfig.createdAt,
  updatedAt: today(),
})
</script>
