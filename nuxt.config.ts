export default defineNuxtConfig({
  app: {
    baseURL: "/",  // can override by NUXT_APP_BASE_URL
    head: {
      charset: "utf-8",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "x-ua-compatible" },
        { name: "signature", content: "880f27e6d0c4daf6c6143beb568a73075f02b75d53e690e6bb79297435d7cf5a8404a4c84ba35416556b92628987d76b9067a4a4ef5d30f63b2b7d0f89b0a26b" },
        { name: "robots", content: "max-image-preview:large" },
        { name: "description", content: "呆れるほど話題に統一感のない雑記ブログ。" },
        { name: "keywords", content: "みるめも,みるみ,ブログ,雑記ブログ" },
        { name: "thumbnail", content: "https://mirumi.me/assets/main-visual.png" },
        { property: "og:type", content: "article" },
        { property: "og:description", content: "呆れるほど話題に統一感のない雑記ブログ。" },
        { property: "og:title", content: "みるめも | みるみのブログ" },
        { property: "og:url", content: "https://mirumi.me" },
        { property: "og:image", content: "https://mirumi.me/assets/main-visual.png" },
        { property: "og:site_name", content: "みるめも | みるみのブログ" },
        { property: "og:locale", content: "ja_JP" },
        { property: "og:app_id", content: "232754373778005" },
        { property: "twitter:title", content: "みるめも | みるみのブログ" },
        { property: "twitter:url", content: "https://mirumi.me" },
        { property: "twitter:description", content: "呆れるほど話題に統一感のない雑記ブログ。" },
        { name: "twitter:domain", content: "mirumi.me" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: "https://mirumi.me/assets/main-visual.png" },
        { name: "msapplication-TileImage", content: "https://mirumi.me/assets/cropped-favicon-270x270.png" },
      ],
      link: [
        { rel: "canonical", href: "https://mirumi.me" },
        { rel: "icon", href: "https://mirumi.me/assets/cropped-favicon-32x32.png", sizes: "32x32" },
        { rel: "icon", href: "https://mirumi.me/assets/cropped-favicon-180x180.png", sizes: "180x180" },
        { rel: "icon", href: "https://mirumi.me/assets/cropped-favicon-192x192.png", sizes: "192x192" },
        { rel: "apple-touch-icon", href: "https://mirumi.me/assets/cropped-favicon-180x180.png" },
        { rel: "preconnect dns-prefetch", href: "//www.google-analytics.com" },
        { rel: "preconnect dns-prefetch", href: "//pagead2.googlesyndication.com" },
        { rel: "preconnect dns-prefetch", href: "//googleads.g.doubleclick.net" },
        { rel: "preconnect dns-prefetch", href: "//tpc.googlesyndication.com" },
        { rel: "preconnect dns-prefetch", href: "//ad.doubleclick.net" },
        { rel: "preconnect dns-prefetch", href: "//www.gstatic.com" },
        { rel: "preconnect dns-prefetch", href: "//cse.google.com" },
      ],
      style: [],
      script: [],
    },
    // pageTransition: {
    //   name: "page",
    //   mode: "out-in",
    // },
  },
  modules: [
    "@vueuse/nuxt",
  ],
  nitro: {
    // prerender: {  // for SSR + SSG
    //   routes: []
    // },
  },
  pages: true,
  srcDir: "src/",
  ssr: true,
  telemetry: false,
  typescript: {
    strict: true,
  },
  vite: {
    css: {
      preprocessorOptions: {
        scss: {
          additionalData: `
            @import "@/assets/styles/main.scss";
            @import "@/assets/styles/content.scss";
          `,
        },
      },
    },
    server: {
      watch: {
        usePolling: true,  // maybe only in WSL2
      },
    },
  },
  vue: {
    compilerOptions: {
      isCustomElement: (tag) => {
        return tag.startsWith("Script")
      },
    },
  },
})
