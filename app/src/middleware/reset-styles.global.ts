export default defineNuxtRouteMiddleware((to, from) => {
  if (process.client) {
    document.body.style.transform = "none"
  }
})
