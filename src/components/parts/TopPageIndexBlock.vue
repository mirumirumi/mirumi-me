<template>
  <div class="top_page_index_block">
    <h3 class="block_title">
      {{ blockTitle }}
    </h3>
    <div class="indexes">
      <NuxtLink v-for="index in indexes" :to="`/${index.slug}`" class="index" :key="index.slug">
        <div class="thumbnail">
          <img
            :src="index.thumbnailUrl.includes('412x216') ? index.thumbnailUrl : index.thumbnailUrl.replace(/(.*)(\..*?)$/gmi, '$1-412x216$2')"
            :alt="index.title"
            loading="lazy"
            width="412"
            height="216"
          />
        </div>
        <div class="title">
          {{ index.title }}
        </div>
      </NuxtLink>
    </div>
    <div class="link">
      <NuxtLink :to="linkTo">
        <span class="text">{{ linkText }}</span><span class="arrow">&nbsp;→</span>
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { PageSummary } from "@/utils/defines"

defineProps<{
  blockTitle: string
  indexes: PageSummary[]
  linkText: string
  linkTo: string
}>()
</script>

<style lang="scss" scoped>
.top_page_index_block {
  .block_title {
    padding: 1em;
    color: #a39d98;
    font-size: 1.13em;
    line-height: 1;
    font-weight: bold;
    text-align: center;
    user-select: none;
  }
  .indexes {
    display: grid;
    grid-template-columns: 50% 50%;
    a.index {
      display: inline-block;
      margin: auto 0.3em 0.7em;
      padding: 0.3em;
      text-decoration: none;
      border-radius: 8px;
      transition: 0.23s all ease;
      .thumbnail {
        img {
          width: 100%;
          height: auto;
          border: solid 2.3px #e4dcd2;
          border-radius: 10px;
          aspect-ratio: 412 / 216;
        }
      }
      .title {
        height: 80px;
        margin: 0.4em;
        color: #545454;
        line-height: 1.3;
        font-size: 0.777em;
        font-weight: bold;
      }
    }
  }
  .link {
    margin-bottom: 4.3em;
    font-size: 0.93em;
    font-weight: bold;
    text-align: center;
    a {
      color: var(--color-link);
      user-select: none;
      text-decoration: none;
      .text {
        text-decoration: underline;
      }
      .arrow {
        text-decoration: none;
      }
      &:hover {
        filter: saturate(0.7);
      }
    }
  }
}
</style>
