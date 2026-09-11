import { createGtag } from "vue-gtag"

export default defineNuxtPlugin((nuxtApp) => {
  // dev サイトの閲覧が本番プロパティの数字に混ざらないようにする
  if (!useRuntimeConfig().public.isProductionSite) {
    return
  }

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
