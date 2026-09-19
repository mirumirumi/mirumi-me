import { createPrerenderConfiguration } from "./build/prerender"

const { buildPlan, prerenderRoutes, isAllowedPrerenderRoute } = createPrerenderConfiguration()
const workersApiOrigin =
  process.env.WORKERS_API_ORIGIN ??
  (process.env.NODE_ENV === "development"
    ? "https://mirumi-me-dev.v2p04rubfuwnvttj.workers.dev"
    : "https://mirumi-me-prd.v2p04rubfuwnvttj.workers.dev")

// dev サイトも常時閲覧できるようにしたため、本番の計測プロパティと広告枠を汚さないように計測タグと AdSense は prd の build でだけ有効にする
const isProductionSite = process.env.APP_ENV === "prd"
const googleAdSenseModule: [string, Record<string, unknown>] = [
  "@nuxtjs/google-adsense",
  {
    id: "ca-pub-2873410957106428",
    analyticsUacct: "UA-79701523-1",
    analyticsDomainName: "mirumi.me",
    // prd 以外では module 公式のテスト用 client ID に差し替わるため、本番アカウントへ
    // インプレッションが記録されない
    test: !isProductionSite,
  },
]

export default defineNuxtConfig({
  compatibilityDate: "2024-04-03",
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
        {
          name: "signature",
          content:
            "880f27e6d0c4daf6c6143beb568a73075f02b75d53e690e6bb79297435d7cf5a8404a4c84ba35416556b92628987d76b9067a4a4ef5d30f63b2b7d0f89b0a26b",
        },
        { name: "robots", content: "max-image-preview:large" },
        { name: "thumbnail", content: "https://mirumi.me/assets/main-visual.png" },
        { property: "og:type", content: "article" },
        { property: "og:title", content: "みるめも | みるみのブログ" },
        { property: "og:url", content: "https://mirumi.me" },
        { property: "og:image", content: "https://mirumi.me/assets/main-visual.png" },
        { property: "og:site_name", content: "みるめも | みるみのブログ" },
        { property: "og:locale", content: "ja_JP" },
        { property: "og:app_id", content: "232754373778005" },
        { name: "twitter:title", content: "みるめも | みるみのブログ" },
        { name: "twitter:url", content: "https://mirumi.me" },
        { name: "twitter:domain", content: "mirumi.me" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: "https://mirumi.me/assets/main-visual.png" },
        {
          name: "msapplication-TileImage",
          content: "https://mirumi.me/assets/cropped-favicon-270x270.png",
        },
      ],
      link: [
        { rel: "canonical", href: "https://mirumi.me" },
        { rel: "icon", href: "https://mirumi.me/assets/cropped-favicon-32x32.png", sizes: "32x32" },
        {
          rel: "icon",
          href: "https://mirumi.me/assets/cropped-favicon-180x180.png",
          sizes: "180x180",
        },
        {
          rel: "icon",
          href: "https://mirumi.me/assets/cropped-favicon-192x192.png",
          sizes: "192x192",
        },
        { rel: "apple-touch-icon", href: "https://mirumi.me/assets/cropped-favicon-180x180.png" },
        { rel: "preconnect", href: "//www.google-analytics.com" },
        { rel: "preconnect", href: "//pagead2.googlesyndication.com" },
        { rel: "preconnect", href: "//googleads.g.doubleclick.net" },
        { rel: "preconnect", href: "//tpc.googlesyndication.com" },
        { rel: "preconnect", href: "//ad.doubleclick.net" },
        { rel: "preconnect", href: "//www.gstatic.com" },
        { rel: "preconnect", href: "//cse.google.com" },
        {
          rel: "alternate",
          type: "application/rss+xml",
          title: "RSS feed",
          href: "https://mirumi.me/feed.xml",
        },
      ],
      style: [],
      script: [],
    },
  },
  css: [
    "~/assets/styles/main.scss",
    "~/assets/styles/main-dark.scss",
    "~/assets/styles/content.scss",
    "~/assets/styles/content-dark.scss",
    "~/assets/styles/syntaxhighlight.scss",
  ],
  dir: {
    public: "src/public",
  },
  modules: ["@vueuse/nuxt", googleAdSenseModule],
  pages: true,
  runtimeConfig: {
    public: {
      turnstileSiteKey: "0x4AAAAAAEO8PjpC2BzSTS2T",
      workersApiOrigin,
      isProductionSite,
    },
  },
  serverDir: "src/server",
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
            @use "@/assets/styles/mixins" as *;
          `,
        },
      },
    },
  },
  // このサイトは全 route が prerender 済み。partial publish が書く app manifest にはその回に生成した
  // route しか載らないため、manifest を根拠にすると他の記事へのサイト内遷移で payload を読まず
  // API を直叩きして落ちる。ワイルドカードの rule は Nitro の生成対象には影響しない
  routeRules: {
    "/**": { prerender: true },
    "/api/**": { prerender: false },
  },
  nitro: {
    prerender: {
      // 1 route でも生成に失敗したらビルドごと落とす。exit 0 のまま欠けた HTML を deploy させない
      failOnError: true,
      crawlLinks: buildPlan ? false : undefined,
      concurrency: 2,
      retry: 5,
      retryDelay: 1_000,
      routes: prerenderRoutes,
    },
    hooks: {
      "prerender:generate": (route) => {
        if (buildPlan && route.route && !isAllowedPrerenderRoute(route.route)) {
          route.skip = true
        }
      },
    },
  },
  hooks: {
    "prerender:routes": (context) => {
      if (!buildPlan) {
        return
      }
      context.routes.clear()
      for (const route of prerenderRoutes) {
        context.routes.add(route)
      }
    },
  },
})
