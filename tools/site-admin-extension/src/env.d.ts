/// <reference types="vite/client" />

// .env.local に置く値。build すると dist/ の JS に埋め込まれる
interface ImportMetaEnv {
  readonly VITE_CLOUDFLARE_ACCOUNT_ID?: string
  readonly VITE_CLOUDFLARE_API_TOKEN?: string
  readonly VITE_NOTION_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
