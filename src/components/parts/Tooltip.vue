<template>
  <div class="tooltip" :class="{ 'auto_width': isAutoWidth, 'ws_normal': isDecidedWidth, 'above': isAbove, 'below': isBelow }" ref="tooltip">
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
const p = defineProps<{
  position: "above" | "below",
  shift: string,
}>()

const MAX_WIDTH = 200

const tooltip = ref()
const width = ref("")
const height = ref("")
const isAbove = ref(false)
const isBelow = ref(false)
const isDecidedWidth = ref(false)

onMounted(() => {
  const renderedWidth = tooltip.value.offsetWidth + 1  // roundup

  if (MAX_WIDTH <= renderedWidth) {
    width.value = MAX_WIDTH.toString() + "px"
  } else {
    width.value = renderedWidth.toString() + "px"
  }

  isDecidedWidth.value = true

  height.value = p.shift

  if (p.position === "above") {
    isAbove.value = true
  } else {  // "below"
    isBelow.value = true
  }
})

const isAutoWidth = computed(() => {
  return !width.value.includes("undefined")
})
</script>

<style lang="scss" scoped>
.tooltip {
  position: absolute;
  display: inline-block;
  width: auto;
  padding: 0.25em 1.3em 0.35em;
  color: $text_white;
  font-size: 0.65em;
  text-align: center;
  text-decoration: none;
  border-radius: 7px;
  background-color: #434343;
  box-shadow: 1px 1px 1px 0 rgba(0, 0, 0, 0.17);
  white-space: nowrap;
  z-index: 1;
  &.above {
    bottom: v-bind(height);
    &::before {
      content: "";
      position: absolute;
      display: inline-block;
      bottom: -14px;
      left: 50%;
      transform: translateX(-50%);
      border: 8px solid transparent;
      border-top-color: #434343;
    }
    &::after {
      content: "";
      position: absolute;
      display: inline-block;
      bottom: -14px;
      left: 50%;
      transform: translateX(-50%);
      border: 7px solid transparent;
      border-top-color: #434343;
    }
  }
  &.below {
    top: v-bind(height);
    &::before {
      content: "";
      position: absolute;
      display: inline-block;
      top: -14px;
      left: 50%;
      transform: translateX(-50%);
      border: 7px solid transparent;
      border-bottom-color: #434343;
    }
    &::after {
      content: "";
      position: absolute;
      display: inline-block;
      top: -14px;
      left: 50%;
      transform: translateX(-50%);
      border: 8px solid transparent;
      border-bottom-color: #434343;
    }
  }
  &.auto_width {
    width: v-bind(width);
  }
  &.ws_normal {
    white-space: normal;
  }
}
</style>
