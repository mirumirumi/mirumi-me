<template>
  <div class="select_input">
    <button type="button" class="select_button" :class="{ 'invalid': _isInvalid }" @click="toggleIsSelecting(); disableInvalid()">
      {{ selectName || currentItem }}
      <span class="dropdown_caret"></span>
    </button>
    <ul v-show="isSelecting">
      <li v-for="item, index in items" @click="decideSelect(item)" :id="'item_' + uuid + '_' + index" @keydown.prevent="selectWithKeys($event, item)" tabindex="-1" :key="item">
        {{ item }}
      </li>
    </ul>
    <Teleport to="body">
      <PartsTransparentBack v-if="isSelecting" @click="closeSelections" />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { v4 as uuidv4 } from "uuid"

const p = defineProps<{
  items: Array<string>,
  selectName?: string,
  current?: string,
  width?: string,
  isDisable?: boolean,
  isInvalid?: boolean,
}>()

const emit = defineEmits<{
  (e: "changeValue", value: string): void,
  (e: "disableInvalid"): void,
}>()

const uuid = uuidv4()
const isSelecting = ref(false)
const currentItem = ref(p.current)
const width = ref(p.width)
const _isInvalid = ref(p.isInvalid)

watch(p, () => {
  currentItem.value = p.current
  _isInvalid.value = p.isInvalid
})

const disableInvalid = () => {
  _isInvalid.value = false
  emit("disableInvalid")
}

const toggleIsSelecting = (): void => {
  isSelecting.value = !isSelecting.value

  let selectedPosition = 0
  for (let i = 0; i < p.items.length; i++) {
    if (p.items[i] === currentItem.value) {
      selectedPosition = i
      break
    }
  }
  setTimeout(() => document.getElementById("item_" + uuid + "_" + selectedPosition.toString())?.focus(), 1)
}

const selectWithKeys = (e: KeyboardEvent, item: string): void => {
  const now = parseInt((e.target as HTMLElement).id.replace(/item_.*?_/gmi, ""))

  if (e.key === "Enter") {
    decideSelect(item)
    return
  }

  let to = now
  if (e.key === "ArrowUp") {
    to = now - 1
  } else if (e.key === "ArrowDown") {
    to = now + 1
  }

  const result = tabindexToId(to, p.items.length)
  setTimeout(() => document.getElementById(result)?.focus(), 1)
}

const decideSelect = (item: string): void => {
  currentItem.value = item
  emit("changeValue", currentItem.value)
  closeSelections()
}

const closeSelections = () => {
  isSelecting.value = false
}

function tabindexToId(to: number, maxlength: number): string {
  let result = "item_" + uuid + "_"
  if (to <= 0) {
    result += "0"
  } else if (maxlength <= to) {
    result += maxlength.toString()
  } else {
    result += to.toString()
  }
  return result
}
</script>

<style lang="scss" scoped>
.select_input {
  position: relative;
  width: v-bind(width);
  button {
    width: v-bind(width);
    padding: 0.375rem calc(0.75rem + 7px) 0.375rem 0.75em;
    color: var(--color-text);
    font-size: 1em;
    line-height: 1.5;
    background-color: #ffffff;
    border: 1px solid #ced4da;
    border-radius: 0.25rem;
    appearance: none;
    transition: border-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out;
    cursor: pointer;
    .dropdown_caret {
      position: absolute;
      top: 2.1px;
      bottom: 0;
      right: 0.9em;
      width: 0;
      height: 0;
      margin: auto;
      content: "";
      border-style: solid;
      border-width: 4px 4px 0;
      border-right-color: transparent;
      border-bottom-color: transparent;
      border-left-color: transparent;
    }
  }
  ul {
    position: absolute;
    width: 100%;
    margin: 1px auto 0;
    padding: 0.34em 0 0.33em;
    max-height: 200px;
    border: solid 1.9px #c9c9c9;
    border-radius: 0.25rem;
    background-color: #ffffff;
    box-shadow: 2px 2px 4px 0px rgba(0, 0, 0, 0.19);
    overflow-y: auto;
    z-index: 14;
    li {
      position: relative;
      padding: 0.15em 1em 0.01em;
      font-size: 1em;
      color: #2d2d2d;
      white-space: nowrap;
      cursor: pointer;
      &:hover {
        background-color: #eeeeee;
      }
      &:focus {
        background-color: #eeeeee;
        outline: 0;
      }
    }
    @include mobile {
      margin: 0.6em 0 0 10px;
      // width: 50%;
      max-height: 180px;
    }
  }
}
.placeholder {
  color: #d2d2d2;
}
</style>
