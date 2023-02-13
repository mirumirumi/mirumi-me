export function insertAdSense(contentHtml: string): string {
  const PROBABILITY = 0.7
  const AD_TAG = '<ins class="adsbygoogle" style="display:block" data-ad-client="ca-pub-2873410957106428" data-ad-slot="2068327194" data-ad-format="auto" data-full-width-responsive="true"></ins>'

  const h2s = contentHtml.match(/<h2.*?<\/h2>/gmi)
  if (!h2s) return contentHtml

  for (const [i, h2] of h2s.entries()) {
    // The first h2 is below the TOC
    if (i === 0) continue

    if (Math.random() <= PROBABILITY) {
      contentHtml = contentHtml.replace(h2, AD_TAG + h2)
    }
  }

  return contentHtml
}
