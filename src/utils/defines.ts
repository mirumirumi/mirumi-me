// constants and typings

export interface PageMeta {
  title: string,
  description: string,
  keywords: string,
  thumbnail?: string,
  url: string,
  createdAt?: string,
  updatedAt?: string,
}

export interface PageSummary {
  slug: string
  title: string
  thumbnailUrl: string
  createdAt: string
  updatedAt: string
}
