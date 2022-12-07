const siteFullPath = "https://mirumi.me"

export default defineAppConfig({
  // Site meta
  siteFullPath,
  createdAt: "2016/6/1",

  // About APIs
  baseURL: siteFullPath + "/wp-json/wp/v2",
})
