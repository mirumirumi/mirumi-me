import { isValidSlug } from "./site-routes"

// PV はページを末尾スラッシュつきのパスで識別する（L1）。数えるのはトップと 1 階層のページだけで、
// 2 階層以上（カテゴリーの一覧など）は数えない。Analytics Engine の index1 にこの値をそのまま書く
export const normalizePageViewPath = (path: string): string | null => {
  if (path === "/") {
    return "/"
  }
  const slug = path.match(/^\/([^/]+)\/?$/)?.[1]

  return slug && isValidSlug(slug) ? `/${slug}/` : null
}
