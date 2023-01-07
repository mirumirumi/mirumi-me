<template>
  <div id="app">
    <ModulesTheHeader />
    <NuxtPage id="container" />
    <ModulesTheFooter />
  </div>
</template>

<script setup lang="ts">
</script>

<style lang="scss">
#app {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  background-color: var(--color-background);
  #container {
    width: var(--width-max-screen);
    margin: 0 auto;
    padding: 0.9em 0.5em 1em;
    @include tablet {
      width: 100%;
    }
    @include mobile {
      width: 100%;
      padding: 1.7em 0.87em 1em;
    }
  }
}
</style>
