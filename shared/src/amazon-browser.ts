import type { AmazonCardItem, AmazonItemsResponse } from "./amazon"

interface AmazonCardReference {
  asin: string
  signature: string
}

export const createAmazonItemBatches = (
  cards: Array<AmazonCardReference>,
): Array<Array<string>> => {
  const itemsPerRequest = 10
  const signaturesByAsin = new Map<string, string>()
  for (const card of cards) {
    if (!signaturesByAsin.has(card.asin)) {
      signaturesByAsin.set(card.asin, card.signature)
    }
  }

  const items = [...signaturesByAsin].map(([asin, signature]) => `${asin}.${signature}`)
  const batches: Array<Array<string>> = []
  for (let index = 0; index < items.length; index += itemsPerRequest) {
    batches.push(items.slice(index, index + itemsPerRequest))
  }

  return batches
}

export const hydrateAmazonCards = async (
  workersApiOrigin: string,
  createBatches: typeof createAmazonItemBatches,
) => {
  const helpers = {
    safeHttpUrl(value: unknown): string | null {
      if (typeof value !== "string") {
        return null
      }
      try {
        const url = new URL(value)
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return null
        }

        return url.href
      } catch {
        return null
      }
    },
    isAmazonCardItem(value: unknown): value is AmazonCardItem {
      if (!value || typeof value !== "object") {
        return false
      }

      const item = value as Partial<AmazonCardItem>

      return (
        typeof item.asin === "string" &&
        /^[A-Z0-9]{10}$/.test(item.asin) &&
        typeof item.title === "string" &&
        helpers.safeHttpUrl(item.detailPageUrl) !== null &&
        (item.byLine === null || typeof item.byLine === "string") &&
        (item.image === null ||
          (typeof item.image === "object" &&
            helpers.safeHttpUrl(item.image.url) !== null &&
            typeof item.image.width === "number" &&
            0 < item.image.width &&
            typeof item.image.height === "number" &&
            0 < item.image.height))
      )
    },
    parseAmazonItemsResponse(value: unknown): AmazonItemsResponse | null {
      if (!value || typeof value !== "object") {
        return null
      }

      const response = value as Partial<AmazonItemsResponse>
      if (!Array.isArray(response.items) || !response.items.every(helpers.isAmazonCardItem)) {
        return null
      }

      return { items: response.items, errors: [] }
    },
    hydrateAmazonCard(card: HTMLElement, item: AmazonCardItem) {
      const detailPageUrl = helpers.safeHttpUrl(item.detailPageUrl)
      if (!detailPageUrl) {
        return
      }

      const title = card.querySelector<HTMLAnchorElement>("[data-amazon-title]")
      const amazonLink = card.querySelector<HTMLAnchorElement>("[data-amazon-link]")
      if (title) {
        title.textContent = item.title
        title.href = detailPageUrl
      }
      if (amazonLink) {
        amazonLink.href = detailPageUrl
      }

      const byLine = card.querySelector<HTMLElement>("[data-amazon-byline]")
      if (byLine) {
        byLine.textContent = item.byLine ?? ""
      }

      const imageUrl = item.image ? helpers.safeHttpUrl(item.image.url) : null
      if (!item.image || !imageUrl || card.querySelector("[data-amazon-image]")) {
        return
      }

      const figure = document.createElement("figure")
      figure.className = "amazon-item-thumb product-item-thumb"
      figure.dataset.amazonImage = ""
      const link = document.createElement("a")
      link.className = "amazon-item-thumb-link product-item-thumb-link image-thumb"
      link.href = detailPageUrl
      link.target = "_blank"
      link.rel = "nofollow noopener"
      const image = document.createElement("img")
      image.className = "amazon-item-thumb-image product-item-thumb-image"
      image.src = imageUrl
      image.alt = item.title
      image.width = item.image.width
      image.height = item.image.height
      image.loading = "lazy"
      image.decoding = "async"
      link.appendChild(image)
      figure.appendChild(link)
      card.insertBefore(figure, card.firstChild)
      card
        .querySelector<HTMLElement>(".amazon-card-content-fallback")
        ?.classList.remove("amazon-card-content-fallback")
    },
  }

  let endpoint: URL
  try {
    endpoint = new URL("/api/amazon/items", workersApiOrigin)
  } catch {
    return
  }

  const cards = Array.from(
    document.querySelectorAll<HTMLElement>("[data-amazon-asin][data-amazon-signature]"),
  )
  const references = cards.flatMap((card) => {
    const asin = card.dataset.amazonAsin
    const signature = card.dataset.amazonSignature

    return asin && signature ? [{ asin, signature }] : []
  })
  for (const batch of createBatches(references)) {
    const url = new URL(endpoint)
    for (const item of batch) {
      url.searchParams.append("item", item)
    }

    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } })
      if (!response.ok) {
        await response.body?.cancel()
        continue
      }
      const parsed = helpers.parseAmazonItemsResponse(await response.json())
      if (!parsed) {
        continue
      }
      for (const item of parsed.items) {
        for (const card of cards) {
          if (card.dataset.amazonAsin === item.asin) {
            helpers.hydrateAmazonCard(card, item)
          }
        }
      }
    } catch {
      // 静的 fallback card をそのまま維持する
    }
  }
}

export const createAmazonHydrationScript = (): string => {
  // preview でも Nuxt と同じ実装を動かしつつ、他の Nuxt script は読み込ませない
  const hydrate = hydrateAmazonCards.toString().replaceAll("</script", "<\\/script")
  const batches = createAmazonItemBatches.toString().replaceAll("</script", "<\\/script")

  return `<script data-preview-amazon>
(() => {
  const run = () => { void (${hydrate})(window.location.origin, ${batches}) }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true })
  } else {
    run()
  }
})()
</script>`
}
