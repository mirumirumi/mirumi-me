interface SimpleCategory {
  name: string
  slug: string
}

export const categories: Array<SimpleCategory> = [
  { name: "PC", slug: "pc" },
  { name: "くらし", slug: "life" },
  { name: "ゲーム", slug: "game" },
  { name: "CS", slug: "computer-science" },
  { name: "ブログ", slug: "blog" },
  { name: "雑記", slug: "notes" },
  { name: "その他", slug: "others" },
]

export const others: Array<SimpleCategory> = [
  { name: "Software Design", slug: "software-design" },
  { name: "Up&Coming", slug: "up-and-coming" },
  { name: "スマートフォン", slug: "mobile" },
  { name: "音楽", slug: "music" },
  { name: "枕", slug: "pillow" },
  { name: "カーナビ", slug: "car-navigation-system" },
  { name: "明晰夢/体外離脱", slug: "dreaming" },
]
