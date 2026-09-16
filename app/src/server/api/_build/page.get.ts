import { getBuildContentReader } from "../../utils/build-content"

// status message は 1 行しか運べないため改行を潰し、長い zod のエラーも頭だけ残す
const summarizeError = (err: unknown): string => {
  const message = err instanceof Error ? err.message : String(err)

  return message.replaceAll(/\s+/g, " ").trim().slice(0, 300)
}

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
    // prerender が失敗しても Nitro は `[500] Server Error` としか出さず、Container の標準出力も
    // 読めないため、原因をここで status message に載せて generate の出力まで運ぶ
    throw createError({
      statusCode: 500,
      statusMessage: `Build page read failed (${route}): ${summarizeError(err)}`,
    })
  }
})
