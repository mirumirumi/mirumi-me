export const POST_SCRIPTS_MAP: Record<string, (content?: string) => void> = {
  "just-answer": justAnswer,
} as const

export function justAnswer() {
  const commentMoreButton = document.querySelector("div.load_more > button")

  commentMoreButton?.addEventListener("click", async () => {
    await delay(1_000)
    const { default: resolved } = await import("@/assets/svgs/hand-point-right.svg?url")

    const donation = `<style>
.amazon_link {
  position: relative;
  padding-left: 1.7em;
}
.amazon_link::after {
  position: absolute;
  top: 0.35em;
  left: 0.2em;
  content: "";
  mask-size: cover;
  mask-image: url("${resolved}");
  width: 1em;
  height: 1em;
  background-color: var(--color-text);
}
</style>
<div id="content"><div class="box-common box-rewrite" style="margin: 0;">
<p><span class="rewrite-date">追記 (2025/9/17) ：</span>信じられないほどのたくさんのコメントをご確認いただけたでしょうか。</p>
<p>これだけ多くの方がジャストアンサーというサイトで困っていて、かつ他の人の状況も気にされています。本記事は 6 年近くにわたりこのような情報を提供し、またみなさん同士が情報交換しあう場にもなってきました。</p>
<p>しかし、このようなサイト運営には大量の時間とお金がかかります。よろしければ、間接的な寄付にご協力いただけませんでしょうか。</p>
<p>寄付といっても、わざわざ自分に金銭を支払っていただく必要はありません。もし Amazon で何か買い物を控えていましたら、下記のリンクから普段通り買い物をしていただけないでしょうか。そうすると自分にもごく僅かな紹介手数料が入るという仕組みです。</p>
<p>
  <a 
    href="https://amzn.to/4n51Gqn"target="_blank" rel="nofollow" class="amazon_link"
    onclick="gtag('event','click',{'event_category':'asp','event_label':'ジャストアンサー_post-scripts_テキスト(https://amzn.to/4n51Gqn)'})"
  >https://amzn.to/4n51Gqn</a><br />
  <span style="display: inline-block; font-size: 0.7em; line-height: 1.5;">（通常の Amazon のサイトに遷移するだけです、もちろんフィッシングではありませんしみなさんの情報が何か参照されることもありません）</span>
</p>
<p>みなさんのお買い物は普段と何も変わりありません！リンクをクリック後、そのブラウザで普通に好きな商品をカートに追加いただければ OK です。必要ないのにむやみやたらに買っていただく必要もございません。何か購入予定のものがある方のみご協力いただけましたら幸いです。</p>
<p>今後も本記事はもちろん、ブログ全体にわたってメンテナンスや読みやすさの向上など図っていきます。どうぞよろしくお願いいたします。</p>
</div></div>`

    document.querySelector(".comment_list")!.insertAdjacentHTML("beforeend", donation)
  })
}
