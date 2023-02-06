<template>
  <div v-if="2 <= pageCount" class="pagination_base">
    <NuxtLink
      v-if="1 < currentPage"
      :to="isCsr
        ? { query: { ...$route.query, p: currentPage - 1 } }
        : { path: `${basePath}/page/${currentPage - 1}` }"
      class="arrow prev"
      @click="toTop"
    >
      <PartsSvgIcon :icon="'arrow_left'" :color="'#727272'" />
    </NuxtLink>
    <template v-if="currentPage === 1">
      <div class="page_latest current">
        {{ 1 }}
      </div>
    </template>
    <template v-else>
      <NuxtLink
        :to="isCsr
          ? { query: { ...$route.query, p: 1 } }
          : { path: `${basePath}/page/${1}` }"
        class="page_latest"
        @click="toTop"
      >
        {{ 1 }}
      </NuxtLink>
    </template>
    <div v-if="LINKS_TO_SHOW <= currentPage" class="ellipsis">
      <PartsSvgIcon :icon="'ellipsis'" :color="'#727272'" />
    </div>

    <template v-for="x in BEFORE_AND_AFTER.slice().reverse()" :key="x">
      <NuxtLink
        v-if="1 < currentPage - x"
        :to="isCsr
          ? { query: { ...$route.query, p: currentPage - x } }
          : { path: `${basePath}/page/${currentPage - x}` }"
        @click="toTop"
      >
        {{ currentPage - x }}
      </NuxtLink>
    </template>
    <div v-if="currentPage !== 1 && currentPage !== pageCount" class="current">
      {{ currentPage }}
    </div>      
    <template v-for="x in BEFORE_AND_AFTER" :key="x">
      <NuxtLink
        v-if="currentPage + x < pageCount"
        :to="isCsr
          ? { query: { ...$route.query, p: currentPage + x } }
          : { path: `${basePath}/page/${currentPage + x}` }"
        @click="toTop"
      >
        {{ currentPage + x }}
      </NuxtLink>
    </template>

    <div v-if="currentPage <= pageCount - (LINKS_TO_SHOW - 1)" class="ellipsis">
      <PartsSvgIcon :icon="'ellipsis'" :color="'#727272'" />
    </div>
    <template v-if="currentPage === pageCount">
      <div class="page_oldest current">
        {{ pageCount }}
      </div>
    </template>
    <template v-else>
      <NuxtLink
        :to="isCsr
          ? { query: { ...$route.query, p: pageCount } }
          : { path: `${basePath}/page/${pageCount}` }"
        class="page_oldest"
        @click="toTop"
      >
        {{ pageCount }}
      </NuxtLink>
    </template>
    <NuxtLink
      v-if="currentPage < pageCount"
      :to="isCsr
        ? { query: { ...$route.query, p: currentPage + 1 } }
        : { path: `${basePath}/page/${currentPage + 1}` }"
      class="arrow next"
      @click="toTop"
    >
      <PartsSvgIcon :icon="'arrow_right'" :color="'#727272'" />
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
const p = defineProps<{
  currentPage: number
  pageCount: number
  itemCount: number
  isCsr: boolean
}>()

const route = useRoute()

const LINKS_TO_SHOW = 3  // Only odd
const BEFORE_AND_AFTER = [...Array((LINKS_TO_SHOW - 1) / 2).keys()].map((x) => x + 1)

const basePath = ref(route.path.replace(/\/page\/\d+/gmi, ""))

const toTop = () => {
  if (p.isCsr) {
    window.scrollTo({
      top: 0,
      left: 0,
    })
  }
}
</script>

<style lang="scss" scoped>
.pagination_base {
  position: relative;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  margin: 2.7em 0 2.5em;
  > * {
    display: flex;
    justify-content: center;
    width: 46px;
    height: 45.5px;
    margin: 0 0.3em;
    color: #727272;
    font-size: 0.95em;
    font-weight: bold;
    line-height: 44.4px;
    border-radius: 50%;
    transition: 0.23s all ease-out;
    &:hover {
      background-color: #f5efeb;
    }
  }
  a {
    color: #727272;
    text-decoration: none;
  }
  .arrow {
    svg {
      width: 0.5em;
    }
  }
  .current {
    background-color: #f5efeb;
    pointer-events: none;
    &:hover {
      background-color: transparent;
    }
  }
  .ellipsis {
    svg {
      width: 0.7em;
    }
    &:hover {
      background-color: transparent;
    }
  }
}
</style>
