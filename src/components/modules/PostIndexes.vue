<template>
  <div class="post_indexes">
    <template v-for="p in posts" :key="p.slug">
      <NuxtLink :to="`/${p.slug}`" class="post">
        <div class="thumbnail">
          <img :src="p.thumbnailUrl" :alt="p.title" width="412" height="216">
        </div>
        <div class="content">
          <h2 class="title">
            {{ p.title }}
          </h2>
          <div class="meta">
            <div class="created_at">
              <PartsSvgIcon :icon="'pen'" :color="'var(--color-gray)'" />
              <time :datetime="p.createdAt">{{ friendlyDatetime(p.createdAt) }}</time>
            </div>
            <div class="updated_at">
              <PartsSvgIcon :icon="'reload'" :color="'var(--color-gray)'" />
              <time :datetime="p.updatedAt">{{ friendlyDatetime(p.updatedAt) }}</time>
            </div>
          </div>
        </div>
      </NuxtLink>
    </template>
  </div>
</template>

<script setup lang="ts">
import { PageSummary } from "@/utils/defines"

defineProps<{
  posts: PageSummary[],
}>()
</script>

<style lang="scss" scoped>
.post_indexes {
  margin: 2em 0 4em;
  padding: 0 2em;
  a.post {
    display: flex;
    flex-direction: row;
    justify-content: center;
    width: 100%;
    max-width: 725px;
    height: 96.51px;
    margin: auto auto 2em;
    padding: 1em 1em 1em 0.5em;
    text-decoration: none;
    background-color: var(--color-background);
    border-radius: 8px;
    box-shadow: 1.3px 1px 4px 0.3px rgb(0 0 0 / 13%);
    transition: 0.23s all ease;
    .thumbnail {
      display: flex;
      flex-direction: row;
      align-items: center;
      width: 15%;
      img {
        width: 100%;
        height: auto;
        border-radius: 5px;
        aspect-ratio: 412 / 216;
      }
    }
    .content {
      display: flex;
      flex-direction: column;
      justify-content: center;
      width: 75%;
      margin-left: 2em;
      transform: translateY(-2.3px);
      .title {
        margin: 0;
        color: #545454;
        line-height: 1.2;
        font-size: 0.87em;
        font-weight: bold;
      }
      .meta {
        margin-top: 0.17em;
        line-height: 1;
        .created_at, .updated_at {
          position: relative;
          display: inline-block;
          margin: auto 1.3em;
          color: var(--color-gray);
          font-size: 0.7em;
          svg {
            top: 0.21em;
            left: -1.1em;
            width: 0.8em;
          }
        }
      }
    }
    &:hover {
      box-shadow: none;
      transform: translateY(0.9px);
    }
  }
}
</style>
