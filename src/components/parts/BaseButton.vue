<template>
  <button
    :type="isSubmitButton ? 'submit' : 'button'"
    class="btn"
    :class="{
      'btn_primary': type === 'fill',
      'btn_outline_primary': type === 'outline',
      'btn_text_only': type === 'text',
      'auto_width': isAutoWidth,
      'auto_height': isAutoHeight,
    }"
    :disabled="isSubmitting || disabled"
    ref="button"
    @click.prevent=";"
  >
    <PartsLoadSpinner
      v-if="isSubmitting"
      :kind="'short'"
      :color="spinnerColor || '#fff'"
    />
    <slot v-else />
  </button>
</template>

<script setup lang="ts">
const p = defineProps<{
  type: "fill" | "outline" | "text"
  isSubmitButton?: boolean
  mainColor?: string
  isSubmitting?: boolean
  disabled?: boolean
  spinnerColor?: string
}>()

const width = ref("")
const height = ref("")
const _mainColor = ref(p.mainColor || "var(--color-primary)")
const button = templateRef("button")

onMounted(async () => {
  await nextTick()

  width.value = (((button.value as HTMLElement).offsetWidth ?? 0) + 1)?.toString() + "px"  // roundup
  height.value = (((button.value as HTMLElement).offsetHeight ?? 0) + 1)?.toString() + "px"  // roundup
})

const isAutoWidth = computed(() => {
  return !width.value.includes("undefined")
})

const isAutoHeight = computed(() => {
  return !height.value.includes("undefined")
})
</script>

<style lang="scss" scoped>
.btn {
  display: inline-block;
  width: auto;
  height: auto;
  margin: auto;
  padding: 0.7em 1.3em 0.79em;
  color: var(--color-text);
  font-size: 0.85em;
  font-weight: bold;
  font-family: var(--font-family);
  line-height: 1.5;
  text-align: center;
  text-decoration: none;
  border: 1px solid transparent;
  border-radius: 5px;
  box-shadow: 1.3px 1.7px 5px -2px #50494e59;
  cursor: pointer;
  user-select: none;
  transition: all 0.13s ease-out;
  &.auto_width {
    width: v-bind(width);
  }
  &.auto_height {
    height: v-bind(height);
  }
  &:disabled {
    pointer-events: none;
    opacity: 0.666;
    filter: contrast(0.5);
  }
}
.btn_primary {
  color: #ffffff;
  border-color: v-bind(_mainColor);
  background-color: v-bind(_mainColor);
  &:hover {
    filter: saturate(0.85);
  }
}
.btn_outline_primary {
  color: v-bind(_mainColor);
  border-color: v-bind(_mainColor);
  background-color: #ffffff;
  &:hover {
    color: v-bind(_mainColor);
    background-color: #f6f2f3;
  }
}
.btn_text_only {
  background-color: transparent;
  box-shadow: none;
}
.btn-check:focus + .btn_primary[data-v-4ba94436], .btn_primary[data-v-4ba94436]:focus {
  box-shadow: 0 0 0 0.25rem rgba(196, 55, 93, 0.5);
}
</style>
