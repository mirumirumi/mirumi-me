<template>
  <div class="modal_base" id="modal_base" @click="clickedToCloseModal($event)">
    <div class="modal_body" id="modal_body" :class="className">
      <slot></slot>
      <PartsSvgIcon icon="close" color="#b8b8b8" @click="closeModal" />
    </div>
    <Teleport to="body">
      <Transition name="fade" appear>
        <PartsModalBack v-if="isOpenModalBack" />
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { delay } from "@/lib/utils"

defineProps<{
  className: string,
}>()

const emit = defineEmits<{
  (e: "closeModal"): void,
}>()

const isOpenModalBack = ref(true)

onMounted(() => {
  if (isOverThanScreen()) {
    ; (document.getElementsByTagName("body")[0] as HTMLBodyElement).classList.add("modal")
  }
})

function isOverThanScreen(): boolean {
  return document.documentElement.clientHeight < (document.getElementsByTagName("body")[0] as HTMLBodyElement).offsetHeight
}

const clickedToCloseModal = (e: any = null) => {
  if (e.target.id === "modal_body")
    return

  let isModalChild = false
  let parent = e.target.parentElement
  while (parent) {
    if (parent.id === "modal_body") {
      isModalChild = true
      break
    }
    parent = parent.parentElement
  }

  if (isModalChild)
    return

  closeModal()
}

const closeModal = async () => {
  isOpenModalBack.value = false

  await delay(1)

  emit("closeModal")

  ; (document.getElementsByTagName("body")[0] as HTMLBodyElement).classList.remove("modal")
}

function keydownEscape(e: KeyboardEvent): void {
  if (e.key === "Escape") {
    e.preventDefault()
    closeModal()
  }
}

document.addEventListener("keydown", keydownEscape)

onUnmounted(() => {
  document.removeEventListener("keydown", keydownEscape)
})
</script>

<style lang="scss" scoped>
.modal_base {
  position: fixed;
  inset: 0;
  display: flex;
  z-index: 2;
  .modal_body {
    margin: auto;
    position: relative;
    width: 95%;
    max-width: 555px;
    padding: 1.5em 1.9em 1.9em;
    color: var(--color-text);
    background-color: var(--color-background);
    box-shadow: 1px 3px 5px rgba(#636363, 0.666);
    border-radius: 7px;
    svg {
      top: 10px;
      right: 19px;
      bottom: auto;
      cursor: pointer;
    }
  }
}
</style>
<style lang="scss">
body.modal {
  overflow-y: hidden;
  padding-right: 16px;
  @include tablet {
    overflow-y: auto;
    padding-right: 0;
  }
  @include mobile {
    overflow-y: auto;
    padding-right: 0;
  }
}
.modal_base {
  .modal_body {
    .title {
      font-size: 1.17em;
      font-weight: bold;
      text-align: center;
    }
    & > div {
      margin: 19px auto;
    }
  }
}
</style>
