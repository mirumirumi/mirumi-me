<template>
  <div class="post_view">
    <main>
      <header>
        <h1 class="title">
          {{ post.title }}
        </h1>
        <div class="thumbnail">
          <img :src="post.thumbnail_url.replace(/\.(png|jpg|jpeg)$/gmi, '.webp')" alt="">
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
          <!-- https://twitter.com/intent/tweet?text=%E7%89%A9%E4%BB%B6%E9%81%B8%E3%81%B3%EF%BD%9E%E5%BC%95%E3%81%A3%E8%B6%8A%E3%81%97%E5%AE%8C%E4%BA%86%E3%81%BE%E3%81%A7%E3%81%AE%E4%BD%9C%E6%A5%AD%E3%83%A1%E3%83%A2%2F%E6%B3%A8%E6%84%8F%E4%BA%8B%E9%A0%85%2F%E6%A4%9C%E8%A8%8E%E5%86%85%E5%AE%B9%E3%81%BE%E3%81%A8%E3%82%81+%28%E4%B8%BB%E3%81%AB%E8%B3%83%E8%B2%B8%29%20-%20%E3%81%BF%E3%82%8B%E3%82%81%E3%82%82%20@milmemo_net&url=https%3A%2F%2Fmirumi.me%2Fmoving -->
          <a :href="`https://twitter.com/intent/tweet?text=${0}@${appConfig.twitterName}&url=${appConfig.siteFullPath}/${slug}`" class="share-button twitter-button twitter-share-button-sq" target="_top" rel="nofollow noopener noreferrer">
            <svg style="width: 32px; height: 31.9px; transform: scale(1.3)"><path fill="#8cbadb" d="M31.939 6.092c-1.18 0.519-2.44 0.872-3.767 1.033 1.352-0.815 2.392-2.099 2.884-3.631-1.268 0.74-2.673 1.279-4.169 1.579-1.195-1.279-2.897-2.079-4.788-2.079-3.623 0-6.56 2.937-6.56 6.556 0 0.52 0.060 1.020 0.169 1.499-5.453-0.257-10.287-2.876-13.521-6.835-0.569 0.963-0.888 2.081-0.888 3.3 0 2.28 1.16 4.284 2.917 5.461-1.076-0.035-2.088-0.331-2.971-0.821v0.081c0 3.18 2.257 5.832 5.261 6.436-0.551 0.148-1.132 0.228-1.728 0.228-0.419 0-0.82-0.040-1.221-0.115 0.841 2.604 3.26 4.503 6.139 4.556-2.24 1.759-5.079 2.807-8.136 2.807-0.52 0-1.039-0.031-1.56-0.089 2.919 1.859 6.357 2.945 10.076 2.945 12.072 0 18.665-9.995 18.665-18.648 0-0.279 0-0.56-0.020-0.84 1.281-0.919 2.4-2.080 3.28-3.397z"></path></svg>
          </a>
          <!-- <span class="snsbadge" style="color: #8cbadb;"><?php echo fetch_twitter_count(get_permalink()); ?></span> -->
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

const slug = route.params.post

const { data: resPostData } = await useFetch(`${appConfig.siteFullPath}/wp-json/mirumi/post_data/${slug}`)
const post = JSON.parse(resPostData.value as string)

console.log(post)






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
    padding: 0 13px;
    header {
      h1.title {
        margin: 0 0 1.1em;
        color: #770000;
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
        margin: 1.5em auto 1.7em;
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
      .share {

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
