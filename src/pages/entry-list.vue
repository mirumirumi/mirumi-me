<template>
  <div class="entry_list_view indexes_single_column">
    <ul>
      <li
        v-for="entries in entriesByCategories"
        class="category"
        :key="entries.categorySlug"
      >
        <NuxtLink :to="`/category/${entries.categorySlug}/`">
          <span v-html="entries.categoryName"></span>
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
import { categories, others } from "../constants/category"

interface Entry {
  slug: string
  title: string
}

interface EntryListItem {
  slug: string
  title: string
  categoryName: string
  categorySlug: string
}

interface EntriesByCategory {
  categoryName: string
  categorySlug: string
  entries: Array<Entry>
}

const route = useRoute()
const appConfig = useAppConfig()

const { data } = await useFetch("/mirumi/entry_list", {
  baseURL: appConfig.baseURL,
  parseResponse: JSON.parse,
})
const entries = data.value as Array<EntryListItem>

const entriesByCategories: Array<EntriesByCategory> = []
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

// Sort order by categories/others defined in constants
const orderedSlugs: Array<string> = [
  ...categories.filter((c) => c.slug !== "others").map((c) => c.slug),
  ...others.map((o) => o.slug),
]

const map = new Map(entriesByCategories.map((c) => [c.categorySlug, c]))
const sorted: Array<EntriesByCategory> = []
for (const slug of orderedSlugs) {
  const found = map.get(slug)
  if (found) sorted.push(found)
}
for (const c of entriesByCategories) {
  if (!orderedSlugs.includes(c.categorySlug)) {
    sorted.push(c)
  }
}
entriesByCategories.splice(0, entriesByCategories.length, ...sorted)

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
.dark {
  .entry_list_view {
    > ul {
      > li.category {
        > a {
          border-bottom-color: #7f7f7f;
        }
      }
    }
  }
}
</style>
