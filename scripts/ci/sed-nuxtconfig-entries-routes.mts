const PER_PAGE = 13

const main = async () => {
  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    type: "post",
    subtype: "post",
    status: "publish",
    _fields: "id",
  })

  const res = await fetch(`https://mirumi.in/wp-json/wp/v2/posts?${params.toString()}`)
  const pageCount = Number(res.headers.get("x-wp-totalpages"))

  let entriesPages = ', "/entries"'
  for (let x = 1; x <= pageCount; x++) {
    entriesPages += `, "/entries/page/${x}"`
  }

  const fs = await import("node:fs/promises")
  const path = "./nuxt.config.ts"
  const content = await fs.readFile(path, { encoding: "utf8" })

  const replaced = content.replace(
    /(crawlLinks: false, routes: )\[(.*?)\]/s,
    (_m, p1: string, p2: string): string => {
      return `${p1}[${p2}${entriesPages}]`
    },
  )

  await fs.writeFile(path, replaced, { encoding: "utf8" })
}

main()
