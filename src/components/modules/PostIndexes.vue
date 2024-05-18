<template>
  <div class="post_indexes">
    <template v-for="p in posts" :key="p.slug">
      <NuxtLink :to="`/${p.slug}/`" class="post page_transition_target">
        <div class="thumbnail">
          <img
            :src="p.thumbnailUrl.replace(/(.*?)\.([^\.]+)$/, '$1-412x216.$2')"
            :alt="p.title"
            loading="lazy"
            width="412"
            height="216"
          />
        </div>
        <div class="content">
          <h2 class="title">
            {{ p.title }}
          </h2>
          <div class="meta">
            <div class="created_at">
              <PartsSvgIcon :icon="'pen'" :color="'var(--color-gray)'" />
              <time :datetime="p.createdAt">{{ friendlyDatetime(p.createdAt!) }}</time>
            </div>
            <div class="updated_at">
              <PartsSvgIcon :icon="'reload'" :color="'var(--color-gray)'" />
              <time :datetime="p.updatedAt">{{ friendlyDatetime(p.updatedAt!) }}</time>
            </div>
          </div>
        </div>
      </NuxtLink>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { PageSummary } from "@/utils/defines"

const p = defineProps<{
  posts: PageSummary[]

  // For search page
  loaded?: boolean
}>()

const route = useRoute()

const _loaded = ref(p.loaded)

onMounted(async () => {
  // Wait for search page (untill all post indexes are prepared)
  if (route.path === "/s") {
    do {
      await delay(100)
    } while (!_loaded)
  }
  await delay(100)

  await usePageTransition(0.6)
})

watch(
  () => p.loaded,
  (newValue) => {
    if (newValue === true) {
      _loaded.value = true
    }
  }
)
</script>

<style lang="scss" scoped>
.post_indexes {
  margin: 2em 0 3.5em;
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
      width: 16%;
      img {
        width: 100%;
        height: auto;
        border-radius: 5px;
        aspect-ratio: 412 / 216;
        @include mobile {
          aspect-ratio: 1/0.93;
          object-fit: cover;
        }
      }
      @include mobile {
        width: 19%;
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
        min-height: 2.4em;
        margin: 0;
        color: #545454;
        line-height: 1.2;
        font-size: 0.87em;
        font-weight: bold;
      }
      .meta {
        margin-top: 0.17em;
        line-height: 1;
        .created_at,
        .updated_at {
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
      @include mobile {
        margin-left: 1.1em;
        padding: 0.9em 0;
      }
    }
    &:hover {
      box-shadow: none;
      transform: translateY(0.9px);
    }
    @include mobile {
      max-width: 100%;
      height: auto;
      padding: 0 0.7em;
    }
  }
  @include mobile {
    padding: 0 0.7em;
  }
}
</style>
