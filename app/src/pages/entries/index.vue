<template>
  <div class="entries_view indexes_single_column">
    <ModulesPaginationBase
      :currentPage="page"
      :pageCount="pageCount"
      :isCsr="false"
      style="margin-top: 0;"
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
import type { BuildPageSummary, PageSummariesManifest } from "shared/build-manifest"

const p = defineProps<{
  pageNumber?: number
}>()

const route = useRoute()
const appConfig = useAppConfig()

const page = ref(Number(p.pageNumber ?? 1))
const posts = ref<Array<BuildPageSummary>>([])
const pageCount = ref(0)

const { data } = await useFetch<PageSummariesManifest>("/api/_build/page-summaries")
const summaries = data.value?.pages ?? []
pageCount.value = Math.ceil(summaries.length / appConfig.perPage)
const offset = (page.value - 1) * appConfig.perPage
posts.value = summaries.slice(offset, offset + appConfig.perPage)

usePageInfo({
  title: "記事一覧",
  description: "呆れるほど話題に統一感のない雑記ブログ。",
  keywords: "みるめも,みるみ,ブログ,雑記ブログ",
  url: appConfig.siteFullPath + route.fullPath,
  createdAt: appConfig.createdAt,
  updatedAt: today(),
})
</script>
