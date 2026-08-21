import type { BlockObjectRequest } from "@notionhq/client"

// Notion API はひとつの children 配列につき 100 件までしか受け付けない。
// あふれた table_row を作成済みの table へ後から足せることは実 API で確認済み（2026-08-18）
const MAX_CHILDREN = 100
// 1 リクエストに含められる children のネストは 2 段まで。
// つまり children の children までは同じリクエストで送れて、その先は別リクエストになる
const MAX_NESTING = 2

export interface DeferredChildren {
  // バッチの children を起点に、ぶら下げ先の親ブロックまで辿るインデックスの並び
  path: Array<number>
  children: Array<BlockObjectRequest>
}

export interface BlockBatch {
  children: Array<BlockObjectRequest>
  deferred: Array<DeferredChildren>
}

const bodyOf = (block: BlockObjectRequest): Record<string, unknown> | null => {
  const key = typeof block.type === "string" ? block.type : null
  if (!key) {
    return null
  }
  const body = (block as unknown as Record<string, unknown>)[key]

  return body && typeof body === "object" ? (body as Record<string, unknown>) : null
}

export const childrenOf = (block: BlockObjectRequest): Array<BlockObjectRequest> => {
  const children = bodyOf(block)?.children

  return Array.isArray(children) ? (children as Array<BlockObjectRequest>) : []
}

const withChildren = (
  block: BlockObjectRequest,
  children: Array<BlockObjectRequest>,
): BlockObjectRequest => {
  const key = typeof block.type === "string" ? block.type : null
  const body = bodyOf(block)
  if (!key || !body) {
    return block
  }

  const nextBody = { ...body }
  if (children.length === 0) {
    delete nextBody.children
  } else {
    nextBody.children = children
  }

  return { ...block, [key]: nextBody } as BlockObjectRequest
}

const inlineChildren = (
  blocks: Array<BlockObjectRequest>,
  nesting: number,
  path: Array<number>,
  deferred: Array<DeferredChildren>,
): Array<BlockObjectRequest> => {
  return blocks.map((block, index) => {
    const children = childrenOf(block)
    if (children.length === 0) {
      return block
    }

    const childPath = [...path, index]
    if (nesting === MAX_NESTING) {
      deferred.push({ path: childPath, children })
      return withChildren(block, [])
    }
    if (MAX_CHILDREN < children.length) {
      deferred.push({ path: childPath, children: children.slice(MAX_CHILDREN) })
    }

    return withChildren(
      block,
      inlineChildren(children.slice(0, MAX_CHILDREN), nesting + 1, childPath, deferred),
    )
  })
}

// 1 回の append リクエストに収まる単位へ分割する。
// あふれた分は deferred に回り、親ブロックの ID が判明してから追加リクエストで送られる
export const planBlockBatches = (blocks: Array<BlockObjectRequest>): Array<BlockBatch> => {
  const batches: Array<BlockBatch> = []

  for (let index = 0; index < blocks.length; index += MAX_CHILDREN) {
    const deferred: Array<DeferredChildren> = []
    const children = inlineChildren(blocks.slice(index, index + MAX_CHILDREN), 0, [], deferred)
    batches.push({ children, deferred })
  }

  return batches
}

// バッチと、そこから派生する追加リクエストをすべて数えたリクエスト数
export const countBlockRequests = (blocks: Array<BlockObjectRequest>): number => {
  return planBlockBatches(blocks).reduce((total, batch) => {
    return (
      total +
      1 +
      batch.deferred.reduce((count, { children }) => count + countBlockRequests(children), 0)
    )
  }, 0)
}
