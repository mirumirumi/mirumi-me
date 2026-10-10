// prerender が失敗しても Nitro は `[500] Server Error` としか出さない。
// Container の標準出力も読めないため、原因の特定に必要な stack をここで残す
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("error", (error, { event }) => {
    console.error(
      `[server error] ${event?.path ?? "(no path)"}`,
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    )
  })
})
