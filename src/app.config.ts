const siteFullPath = "https://mirumi.me"
const apiFullPath = "https://mirumi.in"

export default defineAppConfig({
  // Site meta
  siteFullPath,
  siteDomain: siteFullPath.replace("https://", ""),
  createdAt: "2016/6/1",

  // About APIs
  apiDomain: apiFullPath.replace("https://", ""),
  baseURL: siteFullPath + "/wp-json/wp/v2",
  // baseURL: apiFullPath + "/wp-json/wp/v2",

  // Profiles
  twitterName: "milmemo_net",
})
