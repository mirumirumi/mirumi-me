<template>
  <a :href="hashLink" v-if="hover" class="hash_link" @click="copyCommentUrl()">
    <PartsSvgIcon :icon="'link'" :color="'#9b9b9b'" />
  </a>
</template>

<script setup lang="ts">
const p = defineProps<{
  hashLink: string
  hover: boolean
}>()

const route = useRoute()

const copyCommentUrl = () => {
  const currentPath = window.location.origin + route.path
  const commentUrl = `${currentPath}${p.hashLink}`

  navigator.clipboard.writeText(commentUrl)
}
</script>

<style lang="css" scoped>
.hash_link {
  position: relative;
  cursor: pointer;
  svg {
    width: 1.3em;
    transform: rotate(-23deg);
  }
}
</style>
