export default async (durationScale: number | null) => {
  // For 1st element can be run
  await delay(1)

  const nodes = document.querySelectorAll(".page_transition_target")
  let duration = 131.3
  for (const n of nodes) {
    n.classList.add("run")
    
    if (durationScale) {
      await delay(duration)
      duration *= durationScale
    }
  }
}
