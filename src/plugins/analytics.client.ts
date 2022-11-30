import { defineNuxtPlugin } from "#app"
import VueGtag from "vue-gtag"

export default defineNuxtPlugin(nuxtApp => {
  const router = useRouter()

  nuxtApp.vueApp.use(VueGtag, {
    appName: "みるめも",
    pageTrackerScreenviewEnabled: true,
    config: { id: "G-Y7HSDMHBW5" },
  }, router)
})
