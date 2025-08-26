<template>
  <div class="toggle_switch">
    <input type="checkbox" :id="uuid" v-model="isOn" @click="$emit(switchName, !isOn)" />
    <label :for="uuid">
      <PartsSvgIcon
        :icon="icon"
        :color="'#ebb79f'"
        :dark="'#c9c97f'"
        class="light"
        :class="{ dark: isOn }"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { v4 as uuidv4 } from "uuid"

const p = defineProps<{
  value: boolean
  switchName: string
}>()

const isOn = ref(p.value)
const { value } = toRefs(p)
const uuid = uuidv4()

watch(value, () => {
  isOn.value = p.value
})

const icon = computed(() => {
  return isOn.value ? "moon" : "sun"
})
</script>

<style lang="scss" scoped>
.toggle_switch {
  display: inline-block;
  font-size: 20px;
  input {
    display: none;
  }
  label {
    display: block;
    position: relative;
    width: 2.1em;
    height: 1em;
    border-radius: 1em;
    background-color: #f6f5f4;
    cursor: pointer;
    transition: 0.31s cubic-bezier(0.08, 0.56, 0.61, 0.91) 0.07s;
    border: solid 1.5px #e0dbd8;
    box-sizing: content-box;
    &::before {
      position: absolute;
      content: "";
      top: 0.15px;
      left: 0px;
      width: 1em;
      height: 1em;
      border-radius: 0.9em;
      background-color: #ffffff;
      transition: 0.31s cubic-bezier(0.08, 0.56, 0.61, 0.91) 0.07s;
      box-shadow: 0px 0px 1.7px 0px rgb(0 0 0 / 19%);
    }
    > svg {
      width: 0.7em;
      transition: 0.31s cubic-bezier(0.08, 0.56, 0.61, 0.91) 0.07s;
      &.light {
        left: 2px;
      }
      &.dark {
        left: calc(2px + 100% - 1em + 0.05em);
        transform: rotate(-19deg);
      }
    }
  }
  input:checked + label {
    border-color: #b8b7ba;
    background-color: #99989b;
    &::before {
      left: calc(100% - 1em + 0.05em);
      background-color: #3a394b;
      border-color: #474459;
    }
  }
}
</style>
