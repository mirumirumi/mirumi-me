<template>
  <svg focusable="false" role="img" xmlns="http://www.w3.org/2000/svg" :viewBox="viewBox">
    <path v-if="icon == `close`" :fill="color" d="M310.6 361.4c12.5 12.5 12.5 32.75 0 45.25C304.4 412.9 296.2 416 288 416s-16.38-3.125-22.62-9.375L160 301.3L54.63 406.6C48.38 412.9 40.19 416 32 416S15.63 413.9 9.375 406.6c-12.5-12.5-12.5-32.75 0-45.25l105.4-105.4L9.375 150.6c-12.5-12.5-12.5-32.75 0-45.25s32.75-12.5 45.25 0L160 210.8l105.4-105.4c12.5-12.5 32.75-12.5 45.25 0s12.5 32.75 0 45.25l-105.4 105.4L310.6 361.4z"/>
    <path v-if="icon == `check`" :fill="color" d="M0 256C0 114.6 114.6 0 256 0C397.4 0 512 114.6 512 256C512 397.4 397.4 512 256 512C114.6 512 0 397.4 0 256zM371.8 211.8C382.7 200.9 382.7 183.1 371.8 172.2C360.9 161.3 343.1 161.3 332.2 172.2L224 280.4L179.8 236.2C168.9 225.3 151.1 225.3 140.2 236.2C129.3 247.1 129.3 264.9 140.2 275.8L204.2 339.8C215.1 350.7 232.9 350.7 243.8 339.8L371.8 211.8z" />
    <path v-if="icon == `search`" :fill="color" d="M500.3 443.7l-119.7-119.7c27.22-40.41 40.65-90.9 33.46-144.7C401.8 87.79 326.8 13.32 235.2 1.723C99.01-15.51-15.51 99.01 1.724 235.2c11.6 91.64 86.08 166.7 177.6 178.9c53.8 7.189 104.3-6.236 144.7-33.46l119.7 119.7c15.62 15.62 40.95 15.62 56.57 0C515.9 484.7 515.9 459.3 500.3 443.7zM79.1 208c0-70.58 57.42-128 128-128s128 57.42 128 128c0 70.58-57.42 128-128 128S79.1 278.6 79.1 208z" />
    <path v-if="icon == ``" :fill="color" d="" />
  </svg>
</template>

<script setup lang="ts">
const theme = useState("theme")

const p = defineProps<{
  icon: string,
  color: string,
  dark?: string,
}>()

const color = ref(p.color)
const viewBox = ref("0 0 512 512")

onMounted(() => {
  color.value = theme.value === "dark" ? (p.dark ?? p.color) : p.color
})

setViewBox()

watch(theme, () => {
  if (theme.value === "dark") {
    color.value = p.dark ?? p.color
  } else {
    color.value = p.color
  }
})

function setViewBox(): void {
  switch (p.icon) {
    case "check":
    case "search":
      viewBox.value = "0 0 512 512"
      break
    case "close":
      viewBox.value = "0 0 320 512"
      break
  }
}
</script>

<style lang="scss" scoped>
svg {
  position: absolute;
  top: 0;
  bottom: 0;
  margin: auto;
  width: 1.1em;
}
</style>
