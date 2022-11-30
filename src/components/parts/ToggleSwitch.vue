<template>
  <div class="toggle_switch">
    <input type="checkbox" :id="uuid" v-model="isOn" @click="$emit(switchName, isOn)">
    <label :for="uuid"></label>
  </div>
</template>

<script setup lang="ts">
import { v4 as uuidv4 } from "uuid"

const p = defineProps<{
  value: boolean,
  switchName: string,
}>()

const isOn = ref(p.value)
const uuid = uuidv4()
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
    width: 1.8em;
    height: 1em;
    border-radius: 1em;
    background-color: #eaeaea;
    cursor: pointer;
    transition: 0.1s ease-out;
    border: solid 1.7px #c9c9c9;
    box-sizing: content-box;
    &::before {
      position: absolute;
      content: "";
      top: 0.1em;
      left: 0.1em;
      width: calc(1em - 0.2em);
      height: calc(1em - 0.2em);
      border-radius: calc(1em - 0.1em);
      background-color: #c0c0c0;
      transition: 0.1s ease-out;
    }
  }
  input:checked + label {
    background-color: #e9f5e7;
    &::before {
      left: calc(100% - 1em + 0.05em);
      background-color: #8acc72;
    }
  }
}
</style>
