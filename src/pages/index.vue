<template>
  <div class="index_view" role="main" itemscope itemtype="https://schema.org/Blog">
    <div class="row page_transition_target">
      <PartsTopPageIndexBlock
        :blockTitle="'はじめましての 10 記事'"
        :indexes="posts.slice(0, 4)"
        :linkText="'残りの 6 記事'"
        :linkTo="'/nice-to-meet-you-10'"
      />
      <PartsTopPageIndexBlock
        :blockTitle="'新しい記事'"
        :indexes="posts.slice(4, 8)"
        :linkText="'新着記事一覧'"
        :linkTo="'/entries'"
      />
    </div>
    <div class="row">
      <PartsTopPageIndexBlock
        :blockTitle="'PC'"
        :indexes="posts.slice(8, 12)"
        :linkText="'PC カテゴリ'"
        :linkTo="'/category/pc'"
      />
      <PartsTopPageIndexBlock
        :blockTitle="'スマートフォン'"
        :indexes="posts.slice(12, 16)"
        :linkText="'スマートフォン カテゴリ'"
        :linkTo="'/category/mobile'"
      />
    </div>
    <div class="row">
      <PartsTopPageIndexBlock
        :blockTitle="'くらし'"
        :indexes="posts.slice(16, 20)"
        :linkText="'くらし カテゴリ'"
        :linkTo="'/category/life'"
      />
      <PartsTopPageIndexBlock
        :blockTitle="'ゲーム'"
        :indexes="posts.slice(20, 24)"
        :linkText="'ゲーム カテゴリ'"
        :linkTo="'/category/game'"
      />
    </div>
    <div class="row">
      <PartsTopPageIndexBlock
        :blockTitle="'ブログ'"
        :indexes="posts.slice(24, 28)"
        :linkText="'ブログ カテゴリ'"
        :linkTo="'/category/blog'"
      />
      <PartsTopPageIndexBlock
        :blockTitle="'Software Design'"
        :indexes="posts.slice(28, 32)"
        :linkText="'Software Design サマリー記事一覧'"
        :linkTo="'/category/software-design'"
      />
    </div>
    <div class="row">
      <PartsTopPageIndexBlock
        :blockTitle="'明晰夢/体外離脱'"
        :indexes="posts.slice(32, 34)"
        :linkText="'明晰夢/体外離脱 …？'"
        :linkTo="'/category/dreaming'"
      />
      <PartsTopPageIndexBlock
        :blockTitle="'雑記'"
        :indexes="posts.slice(34)"
        :linkText="'雑記'"
        :linkTo="'/category/notes'"
      />
    </div>
    <Teleport to="body">
      <ClientOnly>
        <PartsTopButton />
      </ClientOnly>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { PageSummary } from "@/utils/defines"

const appConfig = useAppConfig()

onMounted(async () => {
  await usePageTransition(null)
})

let postIds: number[] = []

/**
 * Prepare nice-to-meet-you-10 entries
 */
let posts: PageSummary[] = [
  {
    slug: "pc-freesoft",
    title: "Windows にまず入れるべきおすすめフリーソフト/便利アプリ 40 選",
    thumbnailUrl: "https://mirumi.media/windows-freesoft-recommend-list-412x216-1.webp",
  },
  {
    slug: "good-goods",
    title: "これまでの人生で「本当に買ってよかった」と思えるもの 40 選",
    thumbnailUrl: "https://mirumi.media/good-recommend-goods-milmemo-412x216.webp",
  },
  {
    slug: "out-of-body",
    title: "この記事で人生変わるかも？体外離脱 (幽体離脱) 総まとめ",
    thumbnailUrl:
      "https://mirumi.media/taigai-ridatsu-lucid-dreaming-milmemo-412x216-1.webp",
  },
  {
    slug: "blog-for-you",
    title: "「みるめも」のような雑記ブログで副業したい人のために頑張って書いた記事",
    thumbnailUrl: "https://mirumi.media/blog-for-you-only-start-412x216.webp",
  },
]

/**
 * Prepare new entries
 */
const { data: resNewEntries } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    // Retrieve only the first 4 (or 2) indexes
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories_exclude: [1877], // Software Design
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resNewEntries.value as Record<string, number>[]) {
  postIds.push(p.id)
}

/**
 * Prepare "pc" category entries
 */
const { data: resPc } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [982],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resPc.value as Record<string, number>[]) {
  postIds.push(p.id)
}

/**
 * Prepare "mobile" category entries
 */
const { data: resMobile } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [1010],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resMobile.value as Record<string, number>[]) {
  postIds.push(p.id)
}

/**
 * Prepare "life" category entries
 */
const { data: resLife } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [169],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resLife.value as Record<string, number>[]) {
  postIds.push(p.id)
}

/**
 * Prepare "game" category entries
 */
const { data: resGame } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [3],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resGame.value as Record<string, number>[]) {
  postIds.push(p.id)
}

/**
 * Prepare "blog" category entries
 */
const { data: resBlog } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [548],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resBlog.value as Record<string, number>[]) {
  postIds.push(p.id)
}

/**
 * Prepare "software-design" category entries
 */
const { data: resSoftwareDesign } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [1877],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resSoftwareDesign.value as Record<string, number>[]) {
  postIds.push(p.id)
}

/**
 * Prepare "dreaming" category entries
 */
const { data: resDreaming } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 2,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [594],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resDreaming.value as Record<string, number>[]) {
  postIds.push(p.id)
}

/**
 * Prepare "notes" category entries
 */
const { data: resNotes } = await useFetch(`/wp/v2/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 2,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [1230],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resNotes.value as Record<string, number>[]) {
  postIds.push(p.id)
}

/**
 * Merge them
 */
const { data: postSummaries } = await useFetch(
  `/mirumi/post_summaries_with_post_ids/${postIds.join(",")}`,
  {
    baseURL: appConfig.baseURL,
    parseResponse: JSON.parse,
  }
)
posts = posts.concat(postSummaries.value as PageSummary[])

usePageInfo({
  title: "みるめも",
  description: "呆れるほど話題に統一感のない雑記ブログ。",
  keywords: "みるめも,みるみ,ブログ,雑記ブログ",
  url: appConfig.siteFullPath,
  createdAt: appConfig.createdAt,
  updatedAt: today(),
})
</script>

<style lang="scss" scoped>
.index_view {
  .row {
    display: flex;
    justify-content: space-between;
    > * {
      width: 45%;
      @include mobile {
        width: 100%;
      }
    }
    @include mobile {
      flex-direction: column;
    }
  }
}
</style>
