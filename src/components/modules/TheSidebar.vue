<template>
  <div class="sidebar_wrap">
    <!-- <aside class="ad">
      
    </aside> -->
    <aside class="">
      
    </aside>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  html: string,
}>()
</script>

<style lang="scss" scoped>
.sidebar_wrap {
  position: sticky;
  top: 6px;
  width: var(--width-sidebar);
  height: calc(100vh - 13px * 2);
  padding: 13px 13px;
  .ad {
    height: 250px !important;
  }
  @include tablet {
    padding: 13px 0 13px 26px;
  }
  @include mobile {
    display: none;
  }
}
</style>
