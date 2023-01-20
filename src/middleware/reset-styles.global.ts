export default defineNuxtRouteMiddleware((to, from) => {
  if (process.client) {
    document.getElementsByTagName("body")[0].style.transform = "none"
  }
})
