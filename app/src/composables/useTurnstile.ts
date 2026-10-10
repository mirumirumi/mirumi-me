// Cloudflare Turnstile の explicit render。widget script は 1 回だけ読み、複数の form（返信ごとの
// CommentForm）がそれぞれ widget を持てるようにする
const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

interface TurnstileRenderOptions {
  sitekey: string
  action: string
  callback: (token: string) => void
  "expired-callback"?: () => void
  "error-callback"?: () => void
  theme?: "light" | "dark" | "auto"
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptLoading: Promise<TurnstileApi> | null = null

const loadTurnstile = (): Promise<TurnstileApi> => {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile)
  }
  scriptLoading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.defer = true
    script.addEventListener("load", () => {
      if (window.turnstile) {
        resolve(window.turnstile)
      } else {
        reject(Error("Turnstile を読み込めませんでした"))
      }
    })
    script.addEventListener("error", () => {
      scriptLoading = null
      reject(Error("Turnstile を読み込めませんでした"))
    })
    document.head.appendChild(script)
  })

  return scriptLoading
}

export const useTurnstile = (action: string) => {
  const runtimeConfig = useRuntimeConfig()
  const theme = useState<string>("theme", () => "")
  const token = ref<string | null>(null)
  const isReady = ref(false)
  let api: TurnstileApi | null = null
  let widgetId: string | null = null
  let container: HTMLElement | null = null

  const draw = () => {
    if (!api || !container) {
      return
    }
    widgetId = api.render(container, {
      sitekey: runtimeConfig.public.turnstileSiteKey,
      action,
      // `auto` は OS の設定を見るため、サイトのテーマ切り替えには追従しない
      theme: theme.value === "dark" ? "dark" : "light",
      callback: (value) => {
        token.value = value
        isReady.value = true
      },
      "expired-callback": () => {
        token.value = null
      },
      "error-callback": () => {
        token.value = null
      },
    })
  }

  const render = async (element: HTMLElement) => {
    api = await loadTurnstile()
    container = element
    draw()
  }

  // widget は iframe なので、テーマを変えるには作り直すしかない。
  // 取得済み token は捨てられるが、widget 側がすぐ取り直す
  watch(theme, () => {
    if (!api || widgetId === null) {
      return
    }
    api.remove(widgetId)
    widgetId = null
    token.value = null
    isReady.value = false
    draw()
  })

  // token は 5 分・single-use なので、送信の成否にかかわらず毎回 widget を作り直す
  const reset = () => {
    token.value = null
    if (api && widgetId !== null) {
      api.reset(widgetId)
    }
  }

  const remove = () => {
    if (api && widgetId !== null) {
      api.remove(widgetId)
      widgetId = null
    }
  }

  return { token, isReady, render, reset, remove }
}
