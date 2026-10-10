// prd 以外では module と同じテスト用 client ID を使う。枠そのものは本番と同じだけ出して
// レイアウトを揃えたうえで、本番アカウントへインプレッションだけ記録させない
const AD_CLIENT_ID = "ca-pub-2873410957106428"
const TEST_AD_CLIENT_ID = "ca-google"

export const insertAdSense = (contentHtml: string, isProductionSite: boolean): string => {
  const PROBABILITY = 0.7
  const AD_TAG = `<ins class="adsbygoogle" style="display:block" data-ad-client="${isProductionSite ? AD_CLIENT_ID : TEST_AD_CLIENT_ID}" data-ad-slot="2068327194" data-ad-format="auto" data-full-width-responsive="true"></ins>`

  let result = contentHtml

  const h2s = contentHtml.match(/<h2.*?<\/h2>/gim)
  if (!h2s) {
    return result
  }

  for (const [i, h2] of h2s.entries()) {
    // The first h2 is below the TOC
    if (i === 0) {
      continue
    }

    // The before last h2 is also hidden
    if (i === h2s.length - 1) {
      continue
    }

    if (Math.random() <= PROBABILITY) {
      result = contentHtml.replace(h2, AD_TAG + h2)
    }
  }

  return result
}
