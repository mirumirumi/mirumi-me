import secret from "./src/secrets"

export default defineNuxtConfig({
  app: {
    baseURL: "/",
    head: {
      htmlAttrs: {
        lang: "ja",
      },
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
        { name: "twitter:title", content: "みるめも | みるみのブログ" },
        { name: "twitter:url", content: "https://mirumi.me" },
        { name: "twitter:description", content: "呆れるほど話題に統一感のない雑記ブログ。" },
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
        { rel: "alternate", type: "application/rss+xml", title: "RSS feed", href: "https://mirumi.me/feed.xml" },
        // No comment feed for each article
        { rel: "alternate", type: "application/rss+xml", title: "RSS feed (Comments)", href: "https://mirumi.me/feed-comments.xml" },
      ],
      style: [],
      script: [],
    },
  },
  modules: [
    "@vueuse/nuxt",
    ["@nuxtjs/google-adsense", {
      id: "ca-pub-2873410957106428",
      analyticsUacct: "UA-79701523-1",
      analyticsDomainName: "mirumi.me",
    }],
  ],
  pages: true,
  runtimeConfig: {
    public: {
      userName: secret.USER_NAME,
      applicationPassword: secret.APPLICATION_PASSWORD,
    },
  },
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
            @import "@/assets/styles/syntaxhighlight.scss";
          `,
        },
      },
    },
  },
  nitro: {
    prerender: {
      concurrency: 2,
      interval: 250,
      retry: 5,
      retryDelay: 1_000,

      // CAUTION!: The following comment are used by CI to re-generate specified post
      // ### crawlLinks: false, routes: [###],
    }
  },
})
