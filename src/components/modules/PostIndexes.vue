<template>
  <div class="post_indexes">
    <template v-for="p in posts" :key="p.slug">
      <NuxtLink :to="`/${p.slug}/`" class="post page_transition_target">
        <h2 class="title">{{ p.title }}</h2>
        <div class="meta">
          <div class="created_at">
            <PartsSvgIcon :icon="'calendar_days'" :color="'#c5c5c5'" :dark="'#606060'" />
            <time :datetime="p.createdAt">{{ friendlyDatetime(p.createdAt!) }}</time>
          </div>
          <div v-if="p.createdAt !== p.updatedAt" class="updated_at">
            <PartsSvgIcon
              :icon="'clock_rotate_left'"
              :color="'#c5c5c5'"
              :dark="'#606060'"
            />
            <time :datetime="p.updatedAt">{{ friendlyDatetime(p.updatedAt!) }}</time>
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
    display: block;
    width: 100%;
    margin-bottom: 2em;
    padding: 0.9em 2em 1.1em 1.7em;
    text-decoration: none;
    border: solid 1.7px #e6e3e1;
    border-radius: 11px;
    background-color: var(--color-background);
    transition: 0.23s all ease;
    .title {
      margin: 0 0 0.8em;
      color: var(--color-text);
      line-height: 1.3;
      font-size: 0.87em;
      font-weight: bold;
      @include mobile {
        margin-bottom: 0.3em;
      }
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
          left: -1.1em;
          width: 0.8em;
        }
      }
      .updated_at svg {
        top: 1px;
      }
    }
    &:hover {
      filter: brightness(0.98);
    }
    @include mobile {
      margin-bottom: 1.5em;
      padding: 0.65em 1.3em 0.8em;
    }
  }
  @include mobile {
    margin-bottom: 2.7em;
    padding: 0 0.7em;
  }
}
.dark {
  .post_indexes {
    a.post {
      border-color: #686868;
      &:hover {
        filter: brightness(1.1);
      }
    }
  }
}
</style>
