<template>
  <div class="search_box">
    <input
      type="text"
      ref="search"
      class="input"
      placeholder="記事を検索..."
      role="search"
      v-model="_query"
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
  (e: "onEnter"): void
}>()

const router = useRouter()
const _query = ref(p.query)
const search = ref()

watch(() => p.query, () => {
  _query.value = p.query ?? ""
})

const move = async () => {
  router.push({ name: "s", query: { q: _query.value } })
  emit("onEnter")
  search.value.blur()

  await delay(100)

  if (_query.value?.includes("斜め") || _query.value?.includes("skew")) {
    document.getElementsByTagName("body")[0].style.transform = "rotate(1.3deg) "
  }

  if (_query.value?.includes("逆") || _query.value?.includes("reverse")) {
    document.getElementsByTagName("body")[0].style.transform
    if (document.getElementsByTagName("body")[0].style.transform !== "none") {
      document.getElementsByTagName("body")[0].style.transform += " scaleX(-1)"
    } else {
      document.getElementsByTagName("body")[0].style.transform = "scaleX(-1)"
    }
  }
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
