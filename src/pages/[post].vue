<template>
  <div class="post_view">
    <main>
      <header>
        <h1 class="title">
          {{ post.title }}
        </h1>
        <div class="thumbnail">
          <img :src="post.thumbnail_url.replace(/\.(png|jpg|jpeg)$/gmi, '.webp')" :alt="post.title" width="1200" height="630">
        </div>
        <div class="meta">
          <div class="category">
            <span>かてごり: </span>
            <NuxtLink :to="`/category/${post.category_slug}`">{{ post.category_name }}</NuxtLink>
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
            <a :href="`https://twitter.com/${appConfig.twitterName}`" target="_top" rel="nofollow">@mirumi</a>
          </div>
        </div>
        <div class="share">
          <ModulesShareButtons :slug="slug" :title="post.title" :counts="counts" />
        </div>
      </header>
      <article>
        <div class="content" v-html="post.content"></div>
      </article>
      <footer>

      </footer>
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const appConfig = useAppConfig()

const slug = route.params.post as string

const { data: resPostData } = await useFetch(`${appConfig.siteFullPath}/wp-json/mirumi/post_data/${slug}`)
const post = JSON.parse(resPostData.value as string)

console.log(post)

const counts = {
  twitter: Number(post.twitter),
  hatebu: Number(post.hatebu),
  feedly: Number(post.feedly),
  pocket: Number(post.pocket),
  like: Number(post.like),
}





useSetMeta({
  title: post.title,
  description: post.meta_description,
  keywords: post.meta_keywords,
  url: appConfig.siteFullPath + "/" + slug,
  createdAt: post.date,
  updatedAt: post.modified,
})
</script>

<style lang="scss" scoped>
.post_view {
  main {
    width: 100%;
    max-width: calc(785px + 13px + 13px);
    margin: auto;
    padding: 0.1em 13px 0;
    header {
      h1.title {
        margin: 0 0 1em;
        color: #554545;
        line-height: 1.5;
        font-size: 1.4em;
        font-weight: bold;
      }
      .thumbnail {
        position: relative;
        max-width: 100%;
        margin-bottom: 0.13em;
        img {
          max-width: 100%;
          height: 100%;
          border-radius: 0.5em;
          aspect-ratio: 1200 / 630;
        }
      }
      .meta {
        margin: 1.1em auto 1.7em;
        font-size: 0.78em;
        text-align: center;
        > * {
          display: inline-block;
          margin: auto 1.3em;
          a, span, time {
            color: var(--color-gray);
          }
        }
      }
    }
    article {
      .content {
        margin-top: 5em;
      }
    }
    footer {

    }
  }
}
</style>
