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
        :blockTitle="'くらし'"
        :indexes="posts.slice(8, 12)"
        :linkText="'くらし カテゴリ'"
        :linkTo="'/category/life'"
      />
      <PartsTopPageIndexBlock
        :blockTitle="'雑記'"
        :indexes="posts.slice(12, 16)"
        :linkText="'雑記 カテゴリ'"
        :linkTo="'/category/notes'"
      />
    </div>
    <div class="row">
      <PartsTopPageIndexBlock
        :blockTitle="'Software Design'"
        :indexes="posts.slice(16, 20)"
        :linkText="'Software Design サマリー記事一覧'"
        :linkTo="'/category/software-design'"
      />
      <PartsTopPageIndexBlock
        :blockTitle="'Up&Coming'"
        :indexes="posts.slice(20, 24)"
        :linkText="'Up&Coming への寄稿記事一覧'"
        :linkTo="'/category/up-and-coming'"
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

const postIds: number[] = []

/**
 * Prepare nice-to-meet-you-10 entries
 */
let posts: PageSummary[] = [
  {
    slug: "pc-freesoft",
    title: "Windows にまず入れたいおすすめフリーソフト/便利アプリ 40 選",
    thumbnailUrl: "https://mirumi.media/windows-freesoft-recommend-list-412x216-1.webp",
  },
  {
    slug: "good-goods",
    title: "これまでの人生で「本当に買ってよかった」と思えるもの 40 選",
    thumbnailUrl: "https://mirumi.media/good-recommend-goods-milmemo-412x216.webp",
  },
  {
    slug: "indies-game-recommend",
    title: "個人的インディーズゲームおすすめ 30 本くらいを紹介する！",
    thumbnailUrl: "https://mirumi.media/indies-game-recommend-1-412x216.webp",
  },
  {
    slug: "out-of-body",
    title: "この記事で人生変わるかも？体外離脱 (幽体離脱) 総まとめ",
    thumbnailUrl:
      "https://mirumi.media/taigai-ridatsu-lucid-dreaming-milmemo-412x216-1.webp",
  },
]

/**
 * Prepare new entries
 */
const { data: resNewEntries } = await useFetch("/wp/v2/posts", {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resNewEntries.value as Array<Record<string, number>>) {
  postIds.push(p.id)
}

/**
 * Prepare "life" category entries
 */
const { data: resLife } = await useFetch("/wp/v2/posts", {
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
for (const p of resLife.value as Array<Record<string, number>>) {
  postIds.push(p.id)
}

/**
 * Prepare "notes" category entries
 */
const { data: resNotes } = await useFetch("/wp/v2/posts", {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [1230],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resNotes.value as Array<Record<string, number>>) {
  postIds.push(p.id)
}

/**
 * Prepare "software-design" category entries
 */
const { data: resSoftwareDesign } = await useFetch("/wp/v2/posts", {
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
for (const p of resSoftwareDesign.value as Array<Record<string, number>>) {
  postIds.push(p.id)
}

/**
 * Prepare "up-and-coming" category entries
 */
const { data: resUpAndComing } = await useFetch("/wp/v2/posts", {
  baseURL: appConfig.baseURL,
  params: {
    page: 1,
    per_page: 4,
    type: "post",
    subtype: "post",
    status: ["publish"],
    categories: [1898],
    _fields: "id",
  },
  parseResponse: JSON.parse,
})
for (const p of resUpAndComing.value as Array<Record<string, number>>) {
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
posts = posts.concat(postSummaries.value as Array<PageSummary>)

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
  h3 {
    padding: 1em;
    color: #a39d98;
    font-size: 1.13em;
    line-height: 1;
    font-weight: bold;
    text-align: center;
    user-select: none;
    @include mobile {
      padding: 0 0 0.9em;
    }
  }
  .more {
    margin-bottom: 4.3em;
    font-size: 0.93em;
    font-weight: bold;
    text-align: center;
    a {
      color: var(--color-link);
      user-select: none;
      &:hover {
        filter: saturate(0.7);
      }
    }
  }
}
.dark {
  h3 {
    color: #8e8c8b;
  }
}
</style>
