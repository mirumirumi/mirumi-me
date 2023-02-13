// Load YouTube Video iframe
export function loadYouTube(): void {
  const youtubes = document.querySelectorAll(".youtube") as NodeListOf<HTMLDivElement>

  for (const target of youtubes) {
    target.addEventListener("click", function () {
      const iframe = document.createElement("iframe")
      if (!target.dataset.video) return

      iframe.src = target.dataset.video
      iframe.style.width = "100%"
      iframe.style.aspectRatio = "16/9"
      iframe.style.margin = "0"
      iframe.style.border = "solid 2.7px #dfd1c6"
      iframe.style.borderRadius = "11px"
      target.replaceWith(iframe)
    })
  }
}
