// Load YouTube Video iframe
export const loadYouTube = () => {
  ;(document.querySelectorAll(".youtube") as NodeListOf<HTMLDivElement>).forEach((target) => {
    target.addEventListener("click", () => {
      const iframe = document.createElement("iframe")
      if (!target.dataset.video) return

      iframe.src = target.dataset.video
      iframe.style.width = "100%"
      iframe.style.aspectRatio = "16/9"
      iframe.style.margin = "0"
      iframe.style.border = "solid 2.7px var(--color-media-border)"
      iframe.style.borderRadius = "11px"
      target.replaceWith(iframe)
    })
  })
}

// Sync X (Twitter) widget theme
export const switchTwitterColorTheme = () => {
  const theme = useState<string>("theme", () => "")

  // X のウィジェットに置換される前に備える用
  const elementsBeforeReplace = Array.from(
    document.querySelectorAll<HTMLQuoteElement>("blockquote.twitter-tweet"),
  )
  for (const el of elementsBeforeReplace) {
    el.dataset.theme = theme.value
  }

  //X のウィジェットに置換された後に備える用
  const elementsAfterReplace = Array.from(
    document.querySelectorAll<HTMLIFrameElement>('[id^="twitter-widget-"]'),
  ).filter((el) => /^twitter-widget-\d+$/.test(el.id))

  for (const el of elementsAfterReplace) {
    el.src =
      theme.value === "dark"
        ? el.src.replace("theme=light", "theme=dark")
        : el.src.replace("theme=dark", "theme=light")
  }
}
