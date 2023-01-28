import Toast from "vue-toastification"
import type { PluginOptions } from "vue-toastification"
import "vue-toastification/dist/index.css"
import "@/assets/styles/toast.scss"

const toastOptions: PluginOptions = {
  closeButton: "button",
  closeOnClick: false,
  draggable: false,
  draggablePercent: 0.6,
  hideProgressBar: true,
  icon: false,
  maxToasts: 7,
  newestOnTop: true,
  pauseOnFocusLoss: false,
  pauseOnHover: true,
  // @ts-ignore
  position: "bottom-center",
  rtl: false,
  showCloseButtonOnHover: true,
  timeout: 4444,
  // timeout: false,
  transition: "original_fade",
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(Toast, toastOptions)
})
