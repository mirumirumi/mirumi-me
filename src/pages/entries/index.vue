<template>
  <div class="entries_view indexes_single_column">
    <ModulesPaginationBase
      :currentPage="page"
      :pageCount="pageCount"
      :isCsr="false"
      style="margin-top: 0"
    />
    <ModulesPostIndexes :posts="posts" />
    <ModulesPaginationBase :currentPage="page" :pageCount="pageCount" :isCsr="false" />
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

const { data } = await useFetch("/mirumi/post_ids", {
  baseURL: appConfig.baseURL,
  params: {
    page: page.value,
    per_page: appConfig.perPage,
  },
})
const postIds: number[] = (data.value as PostIdsRes).post_ids.map((id) => Number(id))
pageCount.value = (data.value as PostIdsRes).total_pages

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
