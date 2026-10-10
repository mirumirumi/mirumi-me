const appConfig = useAppConfig()

export default (e: any) => {
  const link = e.target.closest("a")
  if (!link) return

  const to = link.getAttribute("href")
  if (to.startsWith(appConfig.siteFullPath + "/")) {
    // In case of `https://mirumi.me/slug`

    e.preventDefault()
    return navigateTo(to.replace(appConfig.siteFullPath, ""))
  } else if (!to.startsWith("/")) {
    // In case of normal external links

    return
  }

  if (e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) {
    // For open new tab etc

    return
  }

  // In case of start with `/slug`
  e.preventDefault()
  return navigateTo(to)
}
