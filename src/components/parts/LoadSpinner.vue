<template>
  <div class="load_spinner">
    <svg v-if="kind === 'short'" height="100%" viewBox="-4 -4 45 45" xmlns="http://www.w3.org/2000/svg" :stroke="color">
      <g fill="none" fill-rule="evenodd">
        <g transform="translate(1 1)" stroke-width="4.5">
          <circle stroke-opacity=".5" cx="18" cy="18" r="18" />
          <path d="M36 18c0-9.94-8.06-18-18-18">
            <animateTransform attributeName="transform" type="rotate" from="0 18 18" to="360 18 18" repeatCount="indefinite" dur="1.1s" />
          </path>
        </g>
      </g>
    </svg>
    <svg v-if="kind === 'long'" class="ring" height="100%" viewBox="25 25 50 50" stroke-width="5">
      <circle cx="50" cy="50" r="20" />
    </svg>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  kind: "short" | "long",
  color?: string,
}>(), {
  color: "#8b8b8b",
})
</script>

<style lang="scss" scoped>
.load_spinner {
  display: flex;
  align-items: center;
  .ring {
    --uib-size: 40px;
    --uib-speed: 2s;
    --uib-color: v-bind(color);
    height: var(--uib-size);
    width: var(--uib-size);
    vertical-align: middle;
    transform-origin: center;
    animation: rotate var(--uib-speed) linear infinite;
    circle {
      fill: none;
      stroke: var(--uib-color);
      stroke-dasharray: 1, 200;
      stroke-dashoffset: 0;
      stroke-linecap: round;
      animation: stretch calc(var(--uib-speed) * 0.75) ease-in-out infinite;
    }
  }
}
@keyframes rotate {
  100% {
    transform: rotate(360deg);
  }
}
@keyframes stretch {
  0% {
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
  }
  50% {
    stroke-dasharray: 90, 200;
    stroke-dashoffset: -35px;
  }
  100% {
    stroke-dashoffset: -124px;
  }
}
</style>
