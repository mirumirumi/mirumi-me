<template>
  <div class="header_wrap">
    <header>
      <div class="site_logo">
        <NuxtLink :to="{ path: '/', force: true, replace: true }">
          <img src="/assets/site-icon.png" alt="site-icon">
        </NuxtLink>
      </div>
      <nav aria-label="global-menu">
        
      </nav>
    </header>
  </div>
</template>

<script setup lang="ts">
</script>

<style lang="scss" scoped>
.header_wrap{
  header {
  }
}
</style>
