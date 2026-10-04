<template>
  <div class="search_view indexes_single_column">
    <ModulesSearchBox :query="(keyword as string)" @onEnter="onEnter" />
    <ModulesPaginationBase
      :currentPage="page"
      :pageCount="pageCount"
      :itemCount="itemCount"
      :isCsr="true"
    />
    <ClientOnly>
      <div v-if="!keyword" class="no_keywords"> 検索ワードを入力してください :) </div>
      <template v-else>
        <div v-if="isLoading || !posts" class="loading">
          <PartsLoadSpinner :kind="'long'" />
        </div>
        <template v-else>
          <div v-if="errorMessage" class="no_contents"> {{ errorMessage }} </div>
          <ModulesPostIndexes
            v-else-if="posts && 1 <= posts.length"
            :posts="posts"
            :loaded="!isLoading"
          />
          <div v-else class="no_contents"> ちょっと見つけられませんでした :) </div>
        </template>
      </template>
    </ClientOnly>
    <ModulesPaginationBase
      :currentPage="page"
      :pageCount="pageCount"
      :itemCount="itemCount"
      :isCsr="true"
    />
  </div>
</template>

<script setup lang="ts">
import type { SearchResponse } from "shared/search"

import type { PostIndexSummary } from "@/utils/defines"

const router = useRouter()
const appConfig = useAppConfig()
const runtimeConfig = useRuntimeConfig()

const keyword = ref(router.currentRoute.value.query.q)
const page = ref(Number(router.currentRoute.value.query.p ?? 1))

const posts = ref<Array<PostIndexSummary> | null>(null)
const pageCount = ref(0)
const itemCount = ref(0)
const isLoading = ref(false)
const errorMessage = ref<string | null>(null)
// 続けて検索したりページを送ったりしたとき、前の検索の応答で表示を戻さないよう、最後に始めた検索だけを反映する
let latestSearch = 0

onMounted(async () => {
  await search()
})

watch(
  () => router.currentRoute.value,
  async (newValue, oldValue) => {
    if (newValue.query.q !== oldValue.query.q) {
      keyword.value = newValue.query.q
      page.value = 1
      await search()
    } else if (newValue.query.p !== oldValue.query.p) {
      page.value = Number(newValue.query.p ?? 1)
      await search()
    }
  },
)

const onEnter = async () => {
  keyword.value = router.currentRoute.value.query.q
  page.value = 1
  await search()
}

async function search() {
  if (!keyword.value) return

  const current = ++latestSearch
  isLoading.value = true
  errorMessage.value = null

  try {
    // Workers の検索 API が 13 件ずつ返す（shared/search の SEARCH_PER_PAGE）
    const res = await $fetch<SearchResponse>("/api/search", {
      baseURL: runtimeConfig.public.workersApiOrigin,
      params: { q: keyword.value, page: page.value },
    })
    if (current !== latestSearch) {
      return
    }

    pageCount.value = res.pages
    itemCount.value = res.total
    posts.value = res.posts
  } catch (err) {
    if (current !== latestSearch) {
      return
    }

    pageCount.value = 0
    itemCount.value = 0
    posts.value = []
    errorMessage.value =
      (err as { statusCode?: number }).statusCode === 429
        ? "検索が混み合っています。少し待ってからもう一度お試しください :)"
        : "うまく検索できませんでした。時間をおいてもう一度お試しください :)"
  } finally {
    if (current === latestSearch) {
      isLoading.value = false
    }
  }
}

useHead({
  meta: [{ name: "robots", content: "noindex" }],
})

usePageInfo({
  title: `検索: ${keyword.value}`,
  description: "呆れるほど話題に統一感のない雑記ブログ。",
  keywords: "みるめも,みるみ,ブログ,雑記ブログ",
  url: appConfig.siteFullPath + router.currentRoute.value.fullPath,
  createdAt: appConfig.createdAt,
  updatedAt: today(),
})
</script>

<style lang="scss" scoped>
.search_view {
  padding-top: 2em !important;

  .search_box {
    max-width: 33em;
    margin: -0.9em auto 2.5em;
  }

  .no_keywords {
    height: 44.4vh;
    font-size: 0.9em;
    text-align: center;
  }

  .loading {
    height: 100vh;
    text-align: center;

    > * {
      margin-top: 3em;
    }
  }

  .no_contents {
    height: 222px;
    font-size: 0.9em;
    text-align: center;
  }
}
</style>
