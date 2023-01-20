const siteFullPath = "https://mirumi.me"
const apiFullPath = "https://mirumi.in"

export default defineAppConfig({
  // Site meta
  siteFullPath,
  siteDomain: siteFullPath.replace("https://", ""),
  createdAt: "2016/6/1",

  // About APIs
  apiFullPath,
  apiDomain: apiFullPath.replace("https://", ""),
  baseURL: siteFullPath + "/wp-json",
  perPage: 13,

  // Profiles
  twitterName: "milmemo_net",
})
