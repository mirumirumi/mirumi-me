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
import type { BuildPageSummary, PageSummariesManifest } from "shared/build-manifest"

import goodGoodsCardImage from "@/assets/images/top-thumbnails/good-goods.webp"
import indiesGameRecommendCardImage from "@/assets/images/top-thumbnails/indies-game-recommend.webp"
import outOfBodyCardImage from "@/assets/images/top-thumbnails/out-of-body.webp"
import pcFreesoftCardImage from "@/assets/images/top-thumbnails/pc-freesoft.webp"

const appConfig = useAppConfig()

onMounted(async () => {
  await usePageTransition(null)
})

const { data } = await useFetch<PageSummariesManifest>("/api/_build/page-summaries")
const summaries = data.value?.pages ?? []
const summaryBySlug = new Map(summaries.map((summary) => [summary.slug, summary]))
// 冒頭の 4 件だけは記事の title / thumbnail ではなく、トップ専用に用意した文言と画像を出す
const featuredEntries: Array<Pick<BuildPageSummary, "slug" | "title" | "cardImageUrl">> = [
  {
    slug: "pc-freesoft",
    title: "Windows にまず入れたいおすすめフリーソフト/便利アプリ 40 選",
    cardImageUrl: pcFreesoftCardImage,
  },
  {
    slug: "good-goods",
    title: "これまでの人生で「本当に買ってよかった」と思えるもの 40 選",
    cardImageUrl: goodGoodsCardImage,
  },
  {
    slug: "indies-game-recommend",
    title: "個人的インディーズゲームおすすめ 30 本くらいを紹介する！",
    cardImageUrl: indiesGameRecommendCardImage,
  },
  {
    slug: "out-of-body",
    title: "この記事で人生変わるかも？体外離脱 (幽体離脱) 総まとめ",
    cardImageUrl: outOfBodyCardImage,
  },
]
const featured = featuredEntries.flatMap((entry) => {
  const summary = summaryBySlug.get(entry.slug)

  return summary ? [{ ...summary, ...entry }] : []
})
const categoryEntries = (categorySlug: string): Array<BuildPageSummary> => {
  return summaries.filter(({ category }) => category.slug === categorySlug).slice(0, 4)
}
const posts: Array<BuildPageSummary> = [
  ...featured,
  ...summaries.slice(0, 4),
  ...categoryEntries("life"),
  ...categoryEntries("notes"),
  ...categoryEntries("software-design"),
  ...categoryEntries("up-and-coming"),
]

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
