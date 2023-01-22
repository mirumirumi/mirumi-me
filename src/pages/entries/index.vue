<template>
  <div class="entries_view indexes_single_column">
    <ModulesEntryList />
    <ClientOnly>
      <ModulesPaginationBase
        :currentPage="page"
        :pageCount="pageCount"
        :itemCount="itemCount"
        :isCsr="true"
        style="margin-top: 0;"
      />
    </ClientOnly>
    <ModulesPostIndexes :posts="posts" />
    <ClientOnly>
      <ModulesPaginationBase
        :currentPage="page"
        :pageCount="pageCount"
        :itemCount="itemCount"
        :isCsr="true"
      />
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import { PageSummary } from "@/utils/defines"

const route = useRoute()
const appConfig = useAppConfig()

const page = ref(Number(route.params.pageNumber ?? 1))
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
    _fields: "id",
  },
  parseResponse: JSON.parse,
  onResponse: ({ response }) => {
    pageCount.value = Number(response.headers.get("x-wp-totalpages"))
    itemCount.value = Number(response.headers.get("x-wp-total"))
  },
})

// TODO: `onResponse` does not work at page first loading, so I have no choice but to run it 2 times (#1)
refresh()

const postIdObjs = data.value as Record<string, number>[]
if (postIdObjs.length === 0) {
  posts.value = []
}

const postIds: number[] = []
for (const p of postIdObjs) {
  postIds.push(p.id)
}

const { data: postSummaries } = await useFetch(`/mirumi/post_summaries_with_post_ids/${(postIds as number[]).join(",")}`, {
  baseURL: appConfig.baseURL,
  parseResponse: JSON.parse,
})
posts.value = postSummaries.value as PageSummary[]
</script>

<style lang="scss" scoped>
.entries_view {}
</style>
