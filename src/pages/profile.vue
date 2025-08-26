<template>
  <div class="profile_view">
    <ModulesPageBase />
  </div>
</template>

<script setup lang="ts">
import * as cs from "@/assets/scripts/content-scripts"

onMounted(() => {
  cs.switchTwitterColorTheme()
})

useHead({ script: [{ src: "https://platform.x.com/widgets.js", async: true }] })
</script>
