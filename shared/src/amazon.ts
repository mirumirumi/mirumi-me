import type { ContentBlock } from "./content"

const AMAZON_SHORTCODE = /^\[amazon\b([^\]]*)]$/i
const AMAZON_ASIN = /^[A-Z0-9]{10}$/
const AMAZON_ASSOCIATE_TAG = "milmemo-22"
const MOSHIMO_RAKUTEN_ID = {
  a_id: "616599",
  p_id: "54",
  pc_id: "54",
  pl_id: "616",
} as const
const YAHOO_VALUECOMMERCE_ID = {
  sid: "3417144",
  pid: "885599548",
} as const

export interface AmazonShortcode {
  asin: string
  keyword: string
  fallbackTitle: string
}

export interface AmazonFallbackLinks {
  amazon: string
  rakuten: string
  yahoo: string
}

export interface AmazonCardImage {
  url: string
  width: number
  height: number
}

export interface AmazonCardItem {
  asin: string
  title: string
  detailPageUrl: string
  image: AmazonCardImage | null
  byLine: string | null
}

export interface AmazonCardError {
  asin: string
  code: string
}

export interface AmazonItemsResponse {
  items: Array<AmazonCardItem>
  errors: Array<AmazonCardError>
}

const parseAttributes = (value: string): Readonly<Record<string, string>> => {
  const attributes: Record<string, string> = {}
  for (const match of value.matchAll(/([a-zA-Z][\w-]*)\s*=\s*(["'])(.*?)\2/g)) {
    if (match[1] && match[3] !== undefined) {
      attributes[match[1].toLowerCase()] = match[3].replaceAll('\\"', '"')
    }
  }

  return attributes
}

const attributeValue = (name: string, value: string): string => {
  return `${name}="${value.replaceAll('"', '\\"')}"`
}

export const parseAmazonShortcode = (value: string): AmazonShortcode | null => {
  const match = value.trim().match(AMAZON_SHORTCODE)
  if (!match) {
    return null
  }

  const attributes = parseAttributes(match[1] ?? "")
  const asin = attributes.asin?.toUpperCase() ?? ""
  const keyword = attributes.kw?.trim() ?? ""
  const fallbackTitle = attributes.title?.trim() ?? ""
  if (!AMAZON_ASIN.test(asin) || !keyword || !fallbackTitle) {
    return null
  }

  return {
    asin,
    keyword,
    fallbackTitle,
  }
}

export const canonicalizeAmazonShortcode = (value: string): string | null => {
  const shortcode = parseAmazonShortcode(value)
  if (!shortcode) {
    return null
  }

  const canonical = [
    attributeValue("asin", shortcode.asin),
    attributeValue("kw", shortcode.keyword),
    attributeValue("title", shortcode.fallbackTitle),
  ]

  return `[amazon ${canonical.join(" ")}]`
}

export const createAmazonFallbackLinks = (shortcode: AmazonShortcode): AmazonFallbackLinks => {
  const query = shortcode.keyword
  const amazon = new URL(`https://www.amazon.co.jp/dp/${shortcode.asin}`)
  amazon.searchParams.set("tag", AMAZON_ASSOCIATE_TAG)

  const rakutenSearch = `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(query)}/`
  const rakuten = new URL("https://af.moshimo.com/af/c/click")
  for (const [name, value] of Object.entries(MOSHIMO_RAKUTEN_ID)) {
    rakuten.searchParams.set(name, value)
  }
  rakuten.searchParams.set("url", rakutenSearch)

  const yahooSearch = new URL("https://search.shopping.yahoo.co.jp/search")
  yahooSearch.searchParams.set("p", query)
  const yahoo = new URL("https://ck.jp.ap.valuecommerce.com/servlet/referral")
  for (const [name, value] of Object.entries(YAHOO_VALUECOMMERCE_ID)) {
    yahoo.searchParams.set(name, value)
  }
  yahoo.searchParams.set("vc_url", yahooSearch.href)

  return { amazon: amazon.href, rakuten: rakuten.href, yahoo: yahoo.href }
}

const encodeBase64Url = (value: ArrayBuffer): string => {
  const bytes = new Uint8Array(value)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")
}

export const createAmazonCardSignature = async (asin: string, secret: string): Promise<string> => {
  if (!AMAZON_ASIN.test(asin)) {
    throw Error("ASIN の形式が不正です")
  }

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`v1:${asin}`))

  return encodeBase64Url(signature)
}

export const verifyAmazonCardSignature = async (
  asin: string,
  signature: string,
  secret: string,
): Promise<boolean> => {
  if (!AMAZON_ASIN.test(asin)) {
    return false
  }

  const expected = await createAmazonCardSignature(asin, secret)
  if (expected.length !== signature.length) {
    return false
  }

  let difference = 0
  for (let index = 0; index < expected.length; index++) {
    difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index)
  }

  return difference === 0
}

export const collectAmazonAsins = (blocks: Array<ContentBlock>): Array<string> => {
  const asins = new Set<string>()

  const collect = (items: Array<ContentBlock>) => {
    for (const block of items) {
      if (block.type === "paragraph") {
        const shortcode = parseAmazonShortcode(block.richText.map((item) => item.content).join(""))
        if (shortcode) {
          asins.add(shortcode.asin)
        }
      }
      collect(block.children)
    }
  }
  collect(blocks)

  return [...asins]
}
