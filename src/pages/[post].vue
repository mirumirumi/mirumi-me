<template>
  <div class="post_view">
    <div class="header">
      <div class="title">

      </div>
      <div class="thumbnail">

      </div>
      <div class="meta">
        <div class="category">
          <span>かてごり: </span>
          <NuxtLink :to="`/category/${categorySlug}`">{{ categoryName }}</NuxtLink>
        </div>
        <div class="created_at">
          <span>投稿日: </span>
          <time :datetime="post.date">{{ friendlyDatetime(post.date) }}</time>
        </div>
        <div class="updated_at">
          <span>更新日: </span>
          <time :datetime="post.modified">{{ friendlyDatetime(post.modified) }}</time>
        </div>
        <div class="author">
          <span>書いた人: </span>
          <a href="https://twitter.com/milmemo_net" target="_top">@mirumi</a>
        </div>
      </div>
      <div class="share">

      </div>
    </div>
    <div class="content" v-html="post.content.rendered"></div>
    <div class="footer">

    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const appConfig = useAppConfig()

const { data: resPosts } = await useFetch(`/posts`, {
  baseURL: appConfig.baseURL,
  params: {
    slug: route.path.replace("/", ""),
  },
})
const post = JSON.parse(resPosts.value as string)[0]

console.log(post)

const { data: resCategories } = await useFetch(`/categories/${post.categories[0]}`, {  // absolutely `[0]`
  baseURL: appConfig.baseURL,
  params: {
    _fields: "name,slug",
  },
})
const category: {
  name: string,
  slug: string,
} = JSON.parse(resCategories.value as string)
const categoryName = category.name
const categorySlug = category.slug

post.date = post.date + "+09:00"
post.modified = post.modified + "+09:00"

const { data: resTags } = await useFetch(`/tags`, {
  baseURL: appConfig.baseURL,
  params: {
    include: post.tags,
    _fields: "name",
  },
})
const tags = JSON.parse(resTags.value as string)

const { data: resMetaDesc } = await useFetch(`${appConfig.siteFullPath}/wp-json/cocoon/meta_description/${post.id}`)
const metaDesc = JSON.parse(resMetaDesc.value as string)






useSetMeta({
  title: post.title.rendered,
  description: metaDesc,
  keywords: tags.join(","),
  url: appConfig.siteFullPath + route.path,
  createdAt: post.date,
  updatedAt: post.modified,
})
</script>

<style lang="scss" scoped>
.post_view {
  .header {
    .title {

    }
    .thumbnail {

    }
    .meta {
      .category {

      }
      .created_at {

      }
      .updated_at {

      }
      .author {

      }
    }
    .share {

    }
  }
  .content {

  }
  .footer {

  }
}
</style>
