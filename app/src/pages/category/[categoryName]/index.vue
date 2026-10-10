<template>
  <div class="category_view indexes_single_column">
    <h1 class="title">
      <span v-html="category.name"></span>
    </h1>
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
import type {
  BuildPageSummary,
  CategoriesManifest,
  PageSummariesManifest,
} from "shared/build-manifest"

const p = defineProps<{
  pageNumber?: number
}>()

const route = useRoute()
const appConfig = useAppConfig()

/**
 * Prepare post list
 */
const page = ref(Number(p.pageNumber ?? 1))
const posts = ref<Array<BuildPageSummary>>([])
const pageCount = ref(0)

const categorySlug = route.params.categoryName as string
const [{ data: categories }, { data: summaries }] = await Promise.all([
  useFetch<CategoriesManifest>("/api/_build/categories"),
  useFetch<PageSummariesManifest>("/api/_build/page-summaries"),
])
const category = categories.value?.categories.find(({ slug }) => slug === categorySlug)
if (!category) {
  throw createError({ statusCode: 404, statusMessage: "Category not found" })
}
const categoryPages = (summaries.value?.pages ?? []).filter(
  (summary) => summary.category.slug === categorySlug,
)
pageCount.value = Math.ceil(categoryPages.length / appConfig.perPage)
const offset = (page.value - 1) * appConfig.perPage
posts.value = categoryPages.slice(offset, offset + appConfig.perPage)

/**
 * Utils
 */
usePageInfo({
  title: category.name,
  url: appConfig.siteFullPath + route.fullPath,
})
</script>

<style lang="scss" scoped>
h1.title {
  margin: 0 0 2em;
  padding: 0 0.1em;
  color: var(--color-text-title-heading);
  line-height: 1.5;
  font-size: 1.4em;
  font-weight: bold;
  text-align: center;
}
</style>
