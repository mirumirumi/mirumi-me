<template>
  <div class="entry_list_view indexes_single_column">
    <ul>
      <li
        v-for="entries in entriesByCategories"
        class="category"
        :key="entries.categorySlug"
      >
        <NuxtLink :to="`/category/${entries.categorySlug}/`">
          {{ entries.categoryName }}
        </NuxtLink>
        <ul>
          <li v-for="e in entries.entries" class="entry" :key="e.slug">
            <NuxtLink :to="`/${e.slug}/`">
              {{ e.title }}
            </NuxtLink>
          </li>
        </ul>
      </li>
    </ul>
    <Teleport to="body">
      <ClientOnly>
        <PartsTopButton />
      </ClientOnly>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const appConfig = useAppConfig()

const { data } = await useFetch(`/mirumi/entry_list`, {
  baseURL: appConfig.baseURL,
  parseResponse: JSON.parse,
})
// biome-ignore lint:
const entries = data.value as Record<string, any>[]

interface Entry {
  slug: string
  title: string
}
interface EntriesByCategory {
  categoryName: string
  categorySlug: string
  entries: Entry[]
}

const entriesByCategories: EntriesByCategory[] = []
let categoryIndex = -1
for (const [i, e] of entries.entries()) {
  if (i === 0) {
    entriesByCategories.push({
      categoryName: e.categoryName,
      categorySlug: e.categorySlug,
      entries: [
        {
          slug: e.slug,
          title: e.title,
        },
      ],
    })
    categoryIndex++
    continue
  } else {
    if (entries[i].categorySlug !== entries[i - 1].categorySlug) {
      entriesByCategories.push({
        categoryName: e.categoryName,
        categorySlug: e.categorySlug,
        entries: [
          {
            slug: e.slug,
            title: e.title,
          },
        ],
      })
      categoryIndex++
      continue
    }
  }
  entriesByCategories[categoryIndex].entries.push({
    slug: e.slug,
    title: e.title,
  })
}

usePageInfo({
  title: "全記事一覧",
  description: "みるめもの全記事を一覧で確認できるページです。",
  keywords: "みるめも,サイトマップ,記事一覧",
  url: appConfig.siteFullPath + route.fullPath,
  createdAt: appConfig.createdAt,
  updatedAt: today(),
})
</script>

<style lang="scss" scoped>
.entry_list_view {
  margin-bottom: 3em !important;
  > ul {
    > li.category {
      font-size: 0.88em;
      &:first-child {
        a {
          margin-top: 0;
        }
      }
      > a {
        display: block;
        margin: 2.1em 0 0.7em;
        padding: 0 0 0.3em 0.3em;
        border-bottom: solid 1px #e5e5e5;
        text-decoration: none;
      }
      > ul {
        padding-left: 0.5em;
        > li.entry {
          margin: 0 0 0.1em 1.1em;
          padding: 0 0 0 0.1em;
          font-size: 0.8125em;
          list-style: disc;
          > a {
            text-decoration: none;
          }
        }
      }
    }
  }
}
</style>
