// 公開済み BuildPage の content-addressed snapshot の置き場所。書くのは Container の publish job だけだが、
// 定期バックアップが Worker から読むため key の規則はここに置く
export const PUBLISHED_PAGES_PREFIX = "_internal/published-pages-v1"

export const publishedPageSnapshotKey = (pageId: string, contentHash: string): string => {
  if (!/^[0-9a-f-]+$/i.test(pageId) || !/^[0-9a-f]+$/i.test(contentHash)) {
    throw Error(`snapshot key に使えない値です: ${pageId} / ${contentHash}`)
  }

  return `${PUBLISHED_PAGES_PREFIX}/${pageId}/${contentHash}.json`
}
