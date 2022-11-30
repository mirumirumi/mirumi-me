<template>
  <button type="button" :id="_id" class="btn" :class="{ 'btn-primary': type === 'fill', 'btn-outline-primary': type === 'outline', 'btn-text-only': type === 'text', 'auto_width': isAutoWidth }" @click.prevent=";" :disabled="isSubmitting || disabled">
    <PartsLoadSpinner v-if="isSubmitting" :kind="'short'" :color="spinnerColor ? spinnerColor : '#fff'" />
    <slot v-else></slot>
  </button>
</template>

<script setup lang="ts">
import { v4 as uuidv4 } from "uuid"

const p = defineProps<{
  type: "fill" | "outline" | "text",
  id?: string,
  isSubmitting?: boolean,
  disabled?: boolean,
  spinnerColor?: string,
}>()

const uuid = uuidv4()
const _id = ref(p.id)
const width = ref("")

onMounted(async () => {
  if (!_id.value) {
    _id.value = uuid
  }

  await nextTick()

  width.value = ((document.getElementById(_id.value)?.offsetWidth ?? 0) + 1)?.toString() + "px"  // roundup
})

const isAutoWidth = computed(() => {
  return !width.value.includes("undefined")
})
</script>

<style lang="scss" scoped>
.btn {
  display: inline-block;
  width: auto;
  margin: auto;
  line-height: 1.5;
  color: var(--color-text);
  font-size: 0.85em;
  font-weight: bold;
  text-align: center;
  text-decoration: none;
  border: 1px solid transparent;
  padding: 0.7em 1.3em 0.65em;
  border-radius: 5px;
  background-color: transparent;
  box-shadow: 1.3px 1.7px 5px -2px #50494e59;
  cursor: pointer;
  user-select: none;
  transition: all 0.13s ease-out;
  &.auto_width {
    width: v-bind(width);
  }
  &:disabled {
    pointer-events: none;
    opacity: 0.666;
    filter: contrast(0.5);
  }
}
.btn-primary {
  color: #ffffff;
  border-color: var(--color-primary);
  background-color: var(--color-primary);
  &:hover {
    filter: saturate(0.85);
  }
}
.btn-outline-primary {
  color: var(--color-primary);
  border-color: var(--color-primary);
  background-color: #ffffff;
  &:hover {
    color: var(--color-primary);
    background-color: #f6f2f3;
  }
}
.btn-text-only {
  box-shadow: none;
}
.btn-check:focus + .btn-primary[data-v-4ba94436], .btn-primary[data-v-4ba94436]:focus {
  box-shadow: 0 0 0 0.25rem rgba(196, 55, 93, 0.5);
}
</style>
