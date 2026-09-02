// ヘッダーのカテゴリメニューは全ページに出るが、記事のカテゴリはページ側しか知らない。
// 全記事 manifest を取りに行かずに済むよう、表示中のページから受け取る
export default () => {
  return useState<string>("currentCategorySlug", () => "")
}
