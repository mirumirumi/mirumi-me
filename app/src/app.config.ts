const siteFullPath = "https://mirumi.me"

export default defineAppConfig({
  // Site meta
  siteFullPath,
  siteDomain: siteFullPath.replace("https://", ""),
  createdAt: "2016-06-01T00:00:00+09:00",

  // About APIs
  perPage: 13,

  // Profiles
  twitterName: "__mirumi__",
})
