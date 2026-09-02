import { getBuildContentReader } from "../../utils/build-content"

export default defineEventHandler(async (event) => {
  const route = getQuery(event).route
  if (typeof route !== "string" || !route.startsWith("/") || route.includes("?")) {
    throw createError({ statusCode: 400, statusMessage: "Invalid public route" })
  }

  try {
    return await getBuildContentReader().readPageByRoute(route)
  } catch (err) {
    if (err instanceof Error && err.message.includes("build 対象")) {
      throw createError({ statusCode: 404, statusMessage: "Build page not found" })
    }
    throw err
  }
})
