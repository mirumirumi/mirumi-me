s<template>
  <div class="search_box">
    <input type="text" ref="search" class="input" placeholder="記事を検索..." 
      v-model="query"
      @keydown.enter.prevent="move"
    >
    <PartsSvgIcon :icon="'search'" :color="'#bbbbba'" @click="move" />
  </div>
</template>

<script setup lang="ts">
const p = defineProps<{
  query?: string
}>()

const emit = defineEmits<{
  (e: "closeSearchBox"): void
}>()

const router = useRouter()
const query = ref("")
const search = ref()

watch(() => p.query, () => {
  query.value = p.query ?? ""
})

const move = () => {
  router.push({ query: { s: query.value } })
  emit("closeSearchBox")
}
</script>

<style lang="scss" scoped>
.search_box {
  position: relative;
  width: 100%;
  height: 100%;
  input {
    padding: 0.395em 3.3em 0.355em 1.3em;
    font-size: 0.9em;
    line-height: 1.5;
    border: 1.9px solid #e5e5e5;
    border-radius: 31px;
    background-color: transparent;
    &::placeholder {
      font-size: 0.85em;
    }
  }
  svg {
    right: 1.7em;
    cursor: pointer;
  }
}
</style>
