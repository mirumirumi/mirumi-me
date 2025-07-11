<template>
  <Transition name="fade_topbtn">
    <div v-show="isShown" class="top_button" @click="scrollToTop">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512">
        <path
          d="M214.6 41.4c-12.5-12.5-32.8-12.5-45.3 0l-160 160c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L160 141.2V448c0 17.7 14.3 32 32 32s32-14.3 32-32V141.2L329.4 246.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3l-160-160z"
        />
      </svg>
    </div>
  </Transition>
</template>

<script setup lang="ts">
const isShown = ref(false)

window.addEventListener("scroll", () => {
  const position = window.scrollY
  if (311 < position) {
    isShown.value = true
  } else {
    isShown.value = false
  }
})

const scrollToTop = () => {
  window.scrollTo({
    top: 0,
    left: 0,
  })
}
</script>

<style lang="scss" scoped>
.top_button {
  position: fixed;
  width: 2.7em;
  height: 2.7em;
  right: 2em;
  bottom: 0.9em;
  opacity: 0.57;
  cursor: pointer;
  transition: 0.1s all ease;
  z-index: 3;
  &:hover {
    box-shadow: none;
  }
  svg {
    position: absolute;
    inset: 0;
    margin: auto;
    width: 1.1em;
    path {
      fill: #c7bfba;
      transition: 0.29s all ease;
    }
  }
  @include mobile {
    width: 2.6em;
    height: 2.6em;
    right: 0.8em;
    bottom: 0.8em;
    -webkit-tap-highlight-color: transparent;
  }
}
</style>
