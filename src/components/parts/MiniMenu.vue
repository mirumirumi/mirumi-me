<template>
  <div class="mini_menu" v-if="_isShown">
    <ul>
      <li v-for="item in items" @click="clickItem(item)" :key="item.name">
        <NuxtLink :to="item.path">{{ item.name }}</NuxtLink>
      </li>
    </ul>
    <Teleport to="body">
      <PartsTransparentBack @click="closeSelections" />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const p = defineProps<{
  isShown: boolean,
  items: Array<any>,
  current?: string,
  width?: string,
  // styles?: Record<string, string>,
}>()

const emit = defineEmits<{
  (e: "clickItem", value: string): void,
  (e: "close" ): void,
}>()

const _isShown = ref(p.isShown)
const _width = ref(p.width || "130px")

watch(p, () => {
  _isShown.value = p.isShown
})

const clickItem = (item: any) => {
  emit("clickItem", item.name)
  closeSelections()
}

const closeSelections = () => {
  _isShown.value = false
  emit("close")
}
</script>

<style lang="scss" scoped>
.mini_menu {
  position: absolute;
  width: v-bind(_width);
  padding: 7px 5px;
  border-radius: 13px;
  background-color: var(--color-background);
  box-shadow: 1px 5px 13px -7px rgb(0 0 0 / 23%);
  z-index: 14;
  ul {
    li {
      padding: 0 0.9em;
      line-height: 2;
      text-align: left;
    }
  }
}
</style>
