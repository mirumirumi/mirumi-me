/**
 * Load YouTube Video iframe
 */
const targets = document.querySelectorAll(".youtube")

for (const target of targets) {
  target.addEventListener("click", function () {
    const video = document.createElement("iframe")
    if (!target.dataset.video) return

    video.src = target.dataset.video
    video.style.width = "100%"
    video.style.aspectRatio = "16/9"
    video.style.border = "solid 2.7px #dfd1c6"
    video.style.borderRadius = "11px"
    target.replaceWith(video)
  })
}
