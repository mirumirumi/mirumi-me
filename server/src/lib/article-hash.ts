import { createHash } from "node:crypto"

import type { ArticleContent, ContentBlock } from "shared/content"

// 記事本文の hash。Container の公開処理と、Workflow が Notion へ書き戻す直前の確認で同じものを使う

// Notion のアップロード先はワークスペースのデータ保管リージョンで変わる。mirumi.me のワークスペースは
// prod-files-secure-apne1.s3.ap-northeast-1 で、us-west-2 だけを見ていると同期されず署名付き URL のまま公開される
const NOTION_FILE_BUCKET_HOST = /^prod-files-secure(?:-[a-z0-9]+)?\.s3\.[a-z0-9-]+\.amazonaws\.com$/

export const isNotionHostedImage = (value: string): boolean => {
  try {
    const { hostname } = new URL(value)

    return (
      hostname === "file.notion.so" ||
      hostname.endsWith(".notionusercontent.com") ||
      NOTION_FILE_BUCKET_HOST.test(hostname)
    )
  } catch {
    return false
  }
}

// Notion ホストのファイル URL は取得のたびに署名が変わるため、比較には path だけを使う。
// 外部 URL のクエリ（YouTube の v= など）は内容そのものなので残す
const stableNotionFileUrl = (value: string): string => {
  if (!isNotionHostedImage(value)) {
    return value
  }
  const url = new URL(value)
  url.search = ""

  return url.href
}

const stableBlockUrls = (blocks: Array<ContentBlock>): Array<ContentBlock> => {
  return blocks.map((block) => {
    const children = stableBlockUrls(block.children)
    if ("url" in block) {
      return { ...block, url: stableNotionFileUrl(block.url), children }
    }

    return { ...block, children }
  })
}

// 「著者が内容を変えたか」だけを見たいので、公開日・更新日は含めない。
// レンダリング結果（BuildPage）を使うとコードの変更でも一致しなくなる
export const createArticleSourceHash = (article: ArticleContent): string => {
  const source = {
    ...article,
    publishedAt: null,
    updatedAt: null,
    blocks: stableBlockUrls(article.blocks),
  }

  return createHash("sha256").update(JSON.stringify(source)).digest("hex")
}

// 公開ボタンの build 中に本文が直されていないかを、取り直した本文と比べて確かめるための hash。
// last_edited_time は分単位で、ボタンを押した同じ分のうちの編集を見分けられないため。
// sourceHash と違い、公開日や更新日の property を直しても変わる
export const createFetchedArticleHash = (article: ArticleContent): string => {
  const source = {
    ...article,
    thumbnailUrl: article.thumbnailUrl && stableNotionFileUrl(article.thumbnailUrl),
    blocks: stableBlockUrls(article.blocks),
  }

  return createHash("sha256").update(JSON.stringify(source)).digest("hex")
}
