export interface PageMeta {
  title: string
  description: string
  keywords: string
  thumbnail?: string
  url: string
  createdAt?: string
  updatedAt?: string
}

export interface PageSummary {
  slug: string
  title: string
  thumbnailUrl: string
  createdAt?: string
  updatedAt?: string
}

export interface PostIdsRes {
  post_ids: Array<string>
  total_pages: number
}
