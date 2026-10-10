// https://nuxt.com/docs/getting-started/views#advanced-extending-the-html-template

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("render:html", (html) => {
    html.bodyAttrs.push("itemscope")
    html.bodyAttrs.push(`itemtype="https://schema.org/WebPage"`)
  })
})
