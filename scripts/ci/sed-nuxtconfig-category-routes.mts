const PER_PAGE = 13

const parseArgs = (): { category: string } => {
  const argv: Array<string> = process.argv.slice(2)

  let category = ""
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--category") {
      category = argv[i + 1] ?? ""
      break
    }

    if (arg.startsWith("--category=")) {
      category = arg.split("=", 2)[1] ?? ""
      break
    }
  }

  if (!category) {
    throw Error("`--category` is required")
  }

  return { category }
}

const main = async () => {
  const { category } = parseArgs()

  const res1 = await fetch(
    `https://mirumi.in/wp-json/mirumi/category_id_with_category_slug/${category}`,
  )
  const categoryInfo = await res1.json()

  const params = new URLSearchParams({
    per_page: String(PER_PAGE),
    type: "post",
    subtype: "post",
    status: "publish",
    categories: String(Number(categoryInfo.categoryId)),
    _fields: "id",
  })

  const res2 = await fetch(`https://mirumi.in/wp-json/wp/v2/posts?${params.toString()}`)
  const pageCount = Number(res2.headers.get("x-wp-totalpages"))

  let categoryPages = `, "/category/${category}"`
  for (let x = 1; x <= pageCount; x++) {
    categoryPages += `, "/category/${category}/page/${x}"`
  }

  const fs = await import("node:fs/promises")
  const path = "./nuxt.config.ts"
  const content = await fs.readFile(path, { encoding: "utf8" })

  const replaced = content.replace(
    /(crawlLinks: false, routes: )\[(.*?)\]/s,
    (_m, p1: string, p2: string): string => {
      return `${p1}[${p2}${categoryPages}]`
    },
  )

  await fs.writeFile(path, replaced, { encoding: "utf8" })
}

main()
