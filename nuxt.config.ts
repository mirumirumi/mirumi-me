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
        { name: "description", content: "" },
        { name: "keywords", content: "" },
        { name: "thumbnail", content: "https://xxxxx.xxx/assets/main-visual.png" },
        { property: "og:type", content: "" },
        { property: "og:description", content: "" },
        { property: "og:title", content: "" },
        { property: "og:url", content: "https://xxxxx.xxx" },
        { property: "og:image", content: "https://xxxxx.xxx/assets/main-visual.png" },
        { property: "og:site_name", content: "" },
        { property: "og:locale", content: "ja_JP" },
        { property: "og:app_id", content: "" },
        { property: "twitter:title", content: "" },
        { property: "twitter:url", content: "https://xxxxx.xxx" },
        { property: "twitter:description", content: "" },
        { name: "twitter:domain", content: "xxxxx.xxx" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: "https://xxxxx.xxx/assets/main-visual.png" },
      ],
      link: [
        { rel: "canonical", href: "https://xxxxx.xxx" },
        { rel: "icon", href: "https://xxxxx.xxx/assets/maru.png" },
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
  components: {
    dirs: [
      "@/components",
    ],
  },
  imports: {
    dirs: [
      "@/composables",
    ],
  },
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
            @import "@/assets/styles/scss.scss";
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
    }
  },
})
