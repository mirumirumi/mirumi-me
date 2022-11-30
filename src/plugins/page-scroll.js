// // https://github.com/nuxt/framework/discussions/1661

import { defineNuxtPlugin } from "#app"

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("page:start", async () => {  // `page:finish` does not return savedPosition
    window.scrollTo({
      top: 0,
      left: 0,
    })
  })
})
