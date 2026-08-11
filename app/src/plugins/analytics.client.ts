import { createGtag } from "vue-gtag"

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()

  nuxtApp.vueApp.use(
    createGtag({
      tagId: "G-Y7HSDMHBW5",
      appName: "みるめも",
      pageTracker: {
        router,
        useScreenview: true,
      },
    }),
  )
})
