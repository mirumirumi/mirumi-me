// Load YouTube Video iframe
export function loadYouTube() {
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
