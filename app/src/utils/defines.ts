export interface PageMeta {
  title: string
  description?: string
  keywords?: string
  thumbnail?: string
  url: string
  createdAt?: string
  updatedAt?: string
}

export interface PostIndexSummary {
  slug: string
  title: string
  publishedAt: string
  updatedAt: string | null
}
