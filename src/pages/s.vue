<template>
  <div class="search_view indexes_single_column">
    <ModulesSearchBox :query="(keyword as string)" @onEnter="onEnter" />
    <div v-if="!keyword" class="no_keywords">
      検索ワードを入力してください :)
    </div>
    <template v-else>
      <div v-if="isLoading || !posts" class="loading">
        <PartsLoadSpinner :kind="'long'" />
      </div>
      <template v-else>
        <ModulesPostIndexes v-if="posts && 1 <= posts.length" :posts="posts" />
        <div v-else class="no_contents">
          ちょっと見つけられませんでした :)
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { PageSummary } from "@/utils/defines"

const router = useRouter()
const appConfig = useAppConfig()

const keyword = ref(router.currentRoute.value.query.q)
const page = ref(router.currentRoute.value.query.p || 1)

const posts = ref<PageSummary[] | null>(null)
const isLoading = ref(false)

onMounted(async () => {
  await search()
})

watch(() => router.currentRoute.value, async (newValue, oldValue) => {
  if (newValue.query.q !== oldValue.query.q) {
    keyword.value = newValue.query.q
    page.value = 1
    await search()
  } else if (newValue.query.p !== oldValue.query.p) {
    await search()
  }
})

const onEnter = async () => {
  keyword.value = router.currentRoute.value.query.q
  page.value = 1
  await search()
}

async function search() {
  if (!keyword.value) return

  isLoading.value = true

  const postIdObjs = await $fetch<Record<string, number>[]>(`/wp/v2/search`, {
    baseURL: appConfig.baseURL,
    params: {
      page: page.value,
      per_page: appConfig.perPage,
      search: keyword.value,
      type: "post",
      subtype: "post",
      _fields: "id",
    },
    parseResponse: JSON.parse,
  })
  if (postIdObjs.length === 0) {
    posts.value = []
    isLoading.value = false
    return
  }

  const postIds: number[] = []
  for (const p of postIdObjs) {
    postIds.push(p.id)
  }

  const { data: postSummaries } = await useFetch(`/mirumi/post_summaries_with_post_ids/${(postIds as number[]).join(",")}`, {
    baseURL: appConfig.baseURL,
    parseResponse: JSON.parse,
  })
  posts.value = postSummaries.value as any

  // Prevent flickering of previous results
  await delay(300)

  isLoading.value = false
}
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
