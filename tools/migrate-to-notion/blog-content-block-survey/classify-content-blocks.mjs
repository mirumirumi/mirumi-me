import fs from "node:fs";
import path from "node:path";

const baseDir = ".contexts/blog-content-block-survey";
const inputPath = path.join(baseDir, "contents.ndjson");
const inventoryPath = path.join(baseDir, "block-type-inventory.md");
const countsPath = path.join(baseDir, "block-type-counts.json");
const byContentPath = path.join(baseDir, "block-types-by-content.tsv");
const snippetsPath = path.join(baseDir, "representative-snippets.md");
const relatedCardsPath = path.join(baseDir, "related-card-slugs.tsv");
const unknownTokensPath = path.join(baseDir, "unknown-shortcode-like-tokens.md");

const readItems = () => {
  return fs
    .readFileSync(inputPath, "utf8")
    .trimEnd()
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw Error(`Invalid JSON at line ${index + 1}: ${err.message}`);
      }
    });
};

const countMatches = (content, regex) => {
  return [...content.matchAll(regex)].length;
};

const firstMatch = (content, regex) => {
  regex.lastIndex = 0;
  return regex.exec(content);
};

const getClassAttributes = (content) => {
  return [...content.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/gis)].map((match) => {
    return match[2].split(/\s+/).filter(Boolean);
  });
};

const hasClass = (content, className) => {
  return getClassAttributes(content).some((classNames) => classNames.includes(className));
};

const countClass = (content, className) => {
  return getClassAttributes(content).reduce((total, classNames) => {
    return total + (classNames.includes(className) ? 1 : 0);
  }, 0);
};

const countClassAny = (content, classNames) => {
  return getClassAttributes(content).reduce((total, actualClassNames) => {
    return total + (classNames.some((className) => actualClassNames.includes(className)) ? 1 : 0);
  }, 0);
};

const hasClassAny = (content, classNames) => {
  return classNames.some((className) => hasClass(content, className));
};

const makeSnippet = (content, match) => {
  if (match == null) {
    return "";
  }
  const start = Math.max(0, match.index - 120);
  const end = Math.min(content.length, match.index + match[0].length + 220);
  return content
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
};

const stripSyntax = (content) => {
  return content
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/\[[^\]]+\]/g, "\n")
    .replace(/https?:\/\/\S+/g, "\n")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .trim();
};

const escapeTsv = (value) => {
  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
};

const recognizedShortcodeNames = new Set([
  "caption",
  "/caption",
  "amazon",
  "rakuten",
  "audio",
  "/audio",
  "video",
  "/video",
  "new_list",
  "age",
  "today_date",
  "today_year",
  "contact-form-7",
]);

const isRelatedCardToken = (tokenName) => {
  return /^\/[a-z0-9][a-z0-9_-]+$/.test(tokenName) && !["/caption", "/audio", "/video"].includes(tokenName);
};

const rules = [
  {
    id: "plain_text_paragraph",
    group: "基本本文",
    label: "通常本文・段落",
    detector: "`<p>` とタグ外テキスト",
    note: "クラシックエディタ本文として、ほぼ全コンテンツが `<p>` を持つ。固定ページ `new-entries` だけ本文空。",
    count: (content) => countMatches(content, /<p\b/gi) + (stripSyntax(content) === "" ? 0 : 1),
    match: (content) => firstMatch(content, /<p\b[^>]*>|[^\s<\[]+/i),
  },
  {
    id: "heading",
    group: "基本本文",
    label: "見出し",
    detector: "`<h1>`〜`<h6>`",
    note: "実データでは主に h2/h3/h4。最近の記事には `toc_item` class 付き見出しもある。",
    count: (content) => countMatches(content, /<h[1-6]\b/gi),
    match: (content) => firstMatch(content, /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/i),
  },
  {
    id: "list",
    group: "基本本文",
    label: "箇条書き・番号付きリスト",
    detector: "`<ul>` / `<ol>`",
    note: "`num-ol` class の装飾付き番号リストも含む。",
    count: (content) => countMatches(content, /<(?:ul|ol)\b/gi),
    match: (content) => firstMatch(content, /<(?:ul|ol)\b[\s\S]*?<\/(?:ul|ol)>/i),
  },
  {
    id: "table",
    group: "基本本文",
    label: "テーブル",
    detector: "`<table>`",
    note: "プロフィール、スペック表、計測結果などで使用。style 属性付きが多い。",
    count: (content) => countMatches(content, /<table\b/gi),
    match: (content) => firstMatch(content, /<table\b[\s\S]*?<\/table>/i),
  },
  {
    id: "blockquote",
    group: "基本本文",
    label: "引用ブロック",
    detector: "`<blockquote>`",
    note: "引用文・レビュー引用など。",
    count: (content) => countMatches(content, /<blockquote\b/gi),
    match: (content) => firstMatch(content, /<blockquote\b[\s\S]*?<\/blockquote>/i),
  },
  {
    id: "horizontal_separator",
    group: "基本本文",
    label: "装飾区切り線",
    detector: "`dot-line-brown` class",
    note: "本文の場面転換として使われる点線系の区切り。",
    count: (content) => countClass(content, "dot-line-brown"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bdot-line-brown\b[^"']*\1[^>]*>/i),
  },
  {
    id: "inline_emphasis",
    group: "インライン装飾",
    label: "強調・色付き文字・マーカー",
    detector: "`<strong>`, `color-*`, `bb-*`, `marker-*` など",
    note: "ブロックというより inline styling。移行時にはテキスト装飾として扱う候補。",
    count: (content) => countMatches(content, /<strong\b/gi) + countClassAny(content, ["color-red", "color-blue", "color-purple", "bb-red", "bb-blue", "bb-yellow", "bb-tab", "bb-check", "bb-point", "marker-yellow", "sc_marker", "strong-red-marker-yellow", "ugoku-marker-yellow"]),
    match: (content) => firstMatch(content, /<strong\b[\s\S]*?<\/strong>|<[^>]+\bclass=(["'])[^"']*\b(?:color-red|color-blue|color-purple|bb-red|bb-blue|bb-yellow|marker-yellow|sc_marker|strong-red-marker-yellow|ugoku-marker-yellow)\b[^"']*\1[^>]*>/i),
  },
  {
    id: "ruby",
    group: "インライン装飾",
    label: "ルビ",
    detector: "`<ruby>` / `<rt>`",
    note: "ふりがな表現。",
    count: (content) => countMatches(content, /<ruby\b/gi),
    match: (content) => firstMatch(content, /<ruby\b[\s\S]*?<\/ruby>/i),
  },
  {
    id: "inline_code",
    group: "コード・技術表現",
    label: "インラインコード",
    detector: "`<code>` / `inline-pre`",
    note: "本文中のコマンド名・コード断片。`inline-pre` は独自装飾。",
    count: (content) => countMatches(content, /<code\b/gi),
    match: (content) => firstMatch(content, /<code\b[\s\S]*?<\/code>/i),
  },
  {
    id: "pre_code_block",
    group: "コード・技術表現",
    label: "コードブロック・整形済みテキスト",
    detector: "`<pre>`",
    note: "最近の技術記事では `language-*` class のシンタックス指定もある。",
    count: (content) => countMatches(content, /<pre\b/gi),
    match: (content) => firstMatch(content, /<pre\b[\s\S]*?<\/pre>/i),
  },
  {
    id: "keyboard_key",
    group: "コード・技術表現",
    label: "キーボードキー表記",
    detector: "`keyboard-key` class",
    note: "ショートカットキーの UI 風表示。",
    count: (content) => countClass(content, "keyboard-key"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bkeyboard-key\b[^"']*\1[^>]*>[\s\S]*?<\/[^>]+>/i),
  },
  {
    id: "image",
    group: "画像・メディア",
    label: "画像",
    detector: "`<img>`",
    note: "通常画像だけでなく、商品カード・アプリカード・吹き出しアイコン内の画像も含む総数。",
    count: (content) => countMatches(content, /<img\b/gi),
    match: (content) => firstMatch(content, /<img\b[^>]*>/i),
  },
  {
    id: "captioned_image",
    group: "画像・メディア",
    label: "キャプション付き画像",
    detector: "`[caption ...]...[/caption]` / `wp-caption`",
    note: "クラシックエディタの caption shortcode が主。少数だけ `wp-caption` HTML もある。",
    count: (content) => countMatches(content, /\[caption\b/gi) + countClass(content, "wp-caption"),
    match: (content) => firstMatch(content, /\[caption\b[\s\S]*?\[\/caption\]|<[^>]+\bclass=(["'])[^"']*\bwp-caption\b[^"']*\1[^>]*>/i),
  },
  {
    id: "audio_shortcode",
    group: "画像・メディア",
    label: "音声埋め込み",
    detector: "`[audio ...]...[/audio]`",
    note: "WordPress audio shortcode。",
    count: (content) => countMatches(content, /\[audio\b/gi),
    match: (content) => firstMatch(content, /\[audio\b[\s\S]*?\[\/audio\]/i),
  },
  {
    id: "video_shortcode",
    group: "画像・メディア",
    label: "動画埋め込み",
    detector: "`[video ...]...[/video]`",
    note: "WordPress video shortcode。1 件だけ閉じタグ欠けの可能性あり。",
    count: (content) => countMatches(content, /\[video\b/gi),
    match: (content) => firstMatch(content, /\[video\b[\s\S]*?(?:\[\/video\])?/i),
  },
  {
    id: "iframe_embed",
    group: "画像・メディア",
    label: "iframe 埋め込み",
    detector: "`<iframe>`",
    note: "主に YouTube 埋め込み。",
    count: (content) => countMatches(content, /<iframe\b/gi),
    match: (content) => firstMatch(content, /<iframe\b[^>]*>[\s\S]*?<\/iframe>/i),
  },
  {
    id: "youtube_lazy_embed",
    group: "画像・メディア",
    label: "YouTube 遅延読み込み風ブロック",
    detector: "`youtube` class + `data-video`",
    note: "iframe ではなくサムネイル画像と `data-video` を持つ独自埋め込み。",
    count: (content) => countMatches(content, /<[^>]+\bclass=(["'])[^"']*\byoutube\b[^"']*\1[^>]*\bdata-video=/gi),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\byoutube\b[^"']*\1[^>]*\bdata-video=[\s\S]*?<\/div>/i),
  },
  {
    id: "script_embed",
    group: "画像・メディア",
    label: "script 埋め込み",
    detector: "`<script>`",
    note: "ニコニコ動画埋め込み、Font Awesome 読み込み、記事固有スクリプトなど。",
    count: (content) => countMatches(content, /<script\b/gi),
    match: (content) => firstMatch(content, /<script\b[\s\S]*?<\/script>/i),
  },
  {
    id: "internal_related_card",
    group: "カード・埋め込み",
    label: "関連記事カード（slug 独自記法）",
    detector: "`[/slug]`",
    note: "`[/best-pillows]` のような単独記法。閉じショートコードではなく関連記事カード用の独自記法として扱う。",
    count: (content) => [...content.matchAll(/\[\/([a-z0-9][a-z0-9_-]+)\]/gi)].filter((match) => !["caption", "audio", "video"].includes(match[1])).length,
    match: (content) => firstMatch(content, /\[\/(?!caption\]|audio\]|video\])[a-z0-9][a-z0-9_-]+\]/i),
  },
  {
    id: "url_blogcard",
    group: "カード・埋め込み",
    label: "URL ブログカード",
    detector: "`blogcard-type` class + `[URL]`",
    note: "外部 URL や内部 URL をカード化するための囲み。",
    count: (content) => countClass(content, "blogcard-type"),
    match: (content) => firstMatch(content, /<div\b[^>]*\bclass=(["'])[^"']*\bblogcard-type\b[^"']*\1[^>]*>[\s\S]*?<\/div>/i),
  },
  {
    id: "amazon_shortcode",
    group: "カード・埋め込み",
    label: "Amazon 商品カード shortcode",
    detector: "`[amazon ...]`",
    note: "ASIN 指定の旧商品カード。",
    count: (content) => countMatches(content, /\[amazon\b/gi),
    match: (content) => firstMatch(content, /\[amazon\b[^\]]*\]/i),
  },
  {
    id: "rakuten_shortcode",
    group: "カード・埋め込み",
    label: "楽天商品カード shortcode",
    detector: "`[rakuten ...]`",
    note: "少数の旧商品カード。",
    count: (content) => countMatches(content, /\[rakuten\b/gi),
    match: (content) => firstMatch(content, /\[rakuten\b[^\]]*\]/i),
  },
  {
    id: "product_card_html",
    group: "カード・埋め込み",
    label: "商品/アフィリエイトカード HTML",
    detector: "`amazon-item-box` / `product-item-box` / `rakuten-item-box`",
    note: "もしも・A8 などの HTML 商品カード。画像・ボタン・商品説明を内包する。",
    count: (content) => countClassAny(content, ["amazon-item-box", "product-item-box", "rakuten-item-box"]),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\b(?:amazon-item-box|product-item-box|rakuten-item-box)\b[^"']*\1[^>]*>/i),
  },
  {
    id: "appreach_card",
    group: "カード・埋め込み",
    label: "アプリ紹介カード",
    detector: "`appreach` class",
    note: "Google Play / App Store リンク付きのアプリーチ HTML。",
    count: (content) => countClass(content, "appreach"),
    match: (content) => firstMatch(content, /<div\b[^>]*\bclass=(["'])[^"']*\bappreach\b[^"']*\1[^>]*>[\s\S]*?<\/div>/i),
  },
  {
    id: "new_list_shortcode",
    group: "カード・埋め込み",
    label: "記事一覧 shortcode",
    detector: "`[new_list ...]`",
    note: "home 固定ページでカテゴリ別の新着一覧に使用。",
    count: (content) => countMatches(content, /\[new_list\b/gi),
    match: (content) => firstMatch(content, /\[new_list\b[^\]]*\]/i),
  },
  {
    id: "manual_entry_card",
    group: "カード・埋め込み",
    label: "手書き記事カード",
    detector: "`navi-entry-card` / `widget-entry-card`",
    note: "home 固定ページの手書きカード。",
    count: (content) => countClassAny(content, ["navi-entry-card", "widget-entry-card"]),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\b(?:navi-entry-card|widget-entry-card)\b[^"']*\1[^>]*>/i),
  },
  {
    id: "link_button",
    group: "カード・埋め込み",
    label: "リンクボタン・CTA",
    detector: "`btn-wrap*` / `link-btn`",
    note: "色違いボタンを含むリンク装飾。",
    count: (content) => countClass(content, "btn-wrap"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bbtn-wrap\b[^"']*\1[^>]*>[\s\S]*?<\/[^>]+>/i),
  },
  {
    id: "box_common",
    group: "独自ボックス",
    label: "独自ボックス共通",
    detector: "`box-common`",
    note: "`box-info`, `box-alert`, `box-rewrite` などの土台。",
    count: (content) => countClass(content, "box-common"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bbox-common\b[^"']*\1[^>]*>/i),
  },
  {
    id: "box_info",
    group: "独自ボックス",
    label: "情報ボックス",
    detector: "`box-info`",
    note: "補足・注意前の説明など。",
    count: (content) => countClass(content, "box-info"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bbox-info\b[^"']*\1[^>]*>/i),
  },
  {
    id: "box_alert",
    group: "独自ボックス",
    label: "警告/注意ボックス",
    detector: "`box-alert`",
    note: "注意喚起・免責など。",
    count: (content) => countClass(content, "box-alert"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bbox-alert\b[^"']*\1[^>]*>/i),
  },
  {
    id: "box_rewrite",
    group: "独自ボックス",
    label: "追記/更新ボックス",
    detector: "`box-rewrite` / `rewrite-date`",
    note: "追記日時付きの更新情報。",
    count: (content) => countClass(content, "box-rewrite"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bbox-rewrite\b[^"']*\1[^>]*>[\s\S]*?<\/div>/i),
  },
  {
    id: "waku_common",
    group: "独自ボックス",
    label: "枠囲みボックス",
    detector: "`waku-common`",
    note: "本文を枠で囲む強調ブロック。",
    count: (content) => countClass(content, "waku-common"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bwaku-common\b[^"']*\1[^>]*>/i),
  },
  {
    id: "blank_box",
    group: "独自ボックス",
    label: "プレーンな引用/発言風ボックス",
    detector: "`blank-box`",
    note: "囲みだけの短文・発言風テキスト。",
    count: (content) => countClass(content, "blank-box"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bblank-box\b[^"']*\1[^>]*>[\s\S]*?<\/div>/i),
  },
  {
    id: "milmemo_box",
    group: "独自ボックス",
    label: "みるめもぼっくす生成ボックス",
    detector: "`mbo` / `mte` / `mti`",
    note: "専用 Web アプリで生成したタイトル付きボックス。",
    count: (content) => countClass(content, "mbo"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bmbo\b[^"']*\1[^>]*>/i),
  },
  {
    id: "speech_balloon",
    group: "独自ボックス",
    label: "吹き出し",
    detector: "`speech-wrap`",
    note: "アイコン・名前・発言本文を持つ会話風ブロック。",
    count: (content) => countClass(content, "speech-wrap"),
    match: (content) => firstMatch(content, /<div\b[^>]*\bclass=(["'])[^"']*\bspeech-wrap\b[^"']*\1[^>]*>[\s\S]*?<\/div>\s*<\/div>/i),
  },
  {
    id: "micro_caption",
    group: "独自ボックス",
    label: "小さめ補足キャプション",
    detector: "`micro-bottom` / `micro-center`",
    note: "画像やカード直下の小さな補足文。",
    count: (content) => countClass(content, "micro-bottom"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\bmicro-bottom\b[^"']*\1[^>]*>[\s\S]*?<\/div>/i),
  },
  {
    id: "review_voice",
    group: "独自ボックス",
    label: "レビュー引用カード",
    detector: "`voice_wrap`",
    note: "レビュー本文・星評価・引用元リンクを持つカード。",
    count: (content) => countClass(content, "voice_wrap"),
    match: (content) => firstMatch(content, /<div\b[^>]*\bclass=(["'])[^"']*\bvoice_wrap\b[^"']*\1[^>]*>[\s\S]*?<\/div>/i),
  },
  {
    id: "rating_star",
    group: "独自ボックス",
    label: "星評価",
    detector: "`rating-star`",
    note: "レビュー引用カードやランキング内の星表示。",
    count: (content) => countClass(content, "rating-star"),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\brating-star\b[^"']*\1[^>]*>[\s\S]*?<\/[^>]+>/i),
  },
  {
    id: "toggle_block",
    group: "インタラクティブ・フォーム",
    label: "開閉/トグルブロック",
    detector: "`toggle-wrap` / `toggle_switch`",
    note: "チェックボックス + label で本文内に開閉要素や実動スイッチ風 UI を置いている。",
    count: (content) => countClassAny(content, ["toggle-wrap", "toggle_switch"]),
    match: (content) => firstMatch(content, /<[^>]+\bclass=(["'])[^"']*\b(?:toggle-wrap|toggle_switch)\b[^"']*\1[^>]*>/i),
  },
  {
    id: "contact_form",
    group: "インタラクティブ・フォーム",
    label: "問い合わせフォーム shortcode",
    detector: "`[contact-form-7 ...]`",
    note: "Contact Form 7。",
    count: (content) => countMatches(content, /\[contact-form-7\b/gi),
    match: (content) => firstMatch(content, /\[contact-form-7\b[^\]]*\]/i),
  },
  {
    id: "search_form",
    group: "インタラクティブ・フォーム",
    label: "検索フォーム HTML",
    detector: "`<form class=\"search-box ...\">`",
    note: "全記事一覧固定ページ。",
    count: (content) => countMatches(content, /<form\b[^>]*\bsearch-box\b/gi),
    match: (content) => firstMatch(content, /<form\b[\s\S]*?<\/form>/i),
  },
  {
    id: "sitemap_placeholder",
    group: "インタラクティブ・フォーム",
    label: "サイトマップ差し込みコメント",
    detector: "`<!-- SITEMAP CONTENT REPLACE POINT -->`",
    note: "全記事一覧固定ページの置換ポイント。",
    count: (content) => countMatches(content, /<!--\s*SITEMAP CONTENT REPLACE POINT\s*-->/gi),
    match: (content) => firstMatch(content, /<!--\s*SITEMAP CONTENT REPLACE POINT\s*-->/i),
  },
  {
    id: "inline_style",
    group: "記事固有コード",
    label: "記事内 CSS",
    detector: "`<style>`",
    note: "記事固有の微調整 CSS。",
    count: (content) => countMatches(content, /<style\b/gi),
    match: (content) => firstMatch(content, /<style\b[\s\S]*?<\/style>/i),
  },
  {
    id: "dynamic_inline_shortcode",
    group: "記事固有コード",
    label: "動的インライン shortcode",
    detector: "`[age]`, `[today_date]`, `[today_year]`",
    note: "年数や現在日付などを本文内で差し込む。ブロックではなく inline 扱い。",
    count: (content) => countMatches(content, /\[(?:age|today_date|today_year)\b[^\]]*\]/gi),
    match: (content) => firstMatch(content, /\[(?:age|today_date|today_year)\b[^\]]*\]/i),
  },
  {
    id: "gutenberg_comment",
    group: "除外確認",
    label: "Gutenberg ブロックコメント",
    detector: "`<!-- wp:* -->`",
    note: "ユーザー申告通り、実データでも検出なし。",
    count: (content) => countMatches(content, /<!--\s*\/?wp:/gi),
    match: (content) => firstMatch(content, /<!--\s*\/?wp:[\s\S]*?-->/i),
  },
  {
    id: "empty_content",
    group: "除外確認",
    label: "本文空",
    detector: "trim 後空文字",
    note: "固定ページ `new-entries` が該当。",
    count: (content) => (content.trim() === "" ? 1 : 0),
    match: () => null,
  },
];

const items = readItems();
const summaries = rules.map((rule) => ({
  id: rule.id,
  group: rule.group,
  label: rule.label,
  detector: rule.detector,
  note: rule.note,
  occurrences: 0,
  contentCount: 0,
  examples: [],
}));
const summariesById = new Map(summaries.map((summary) => [summary.id, summary]));
const byContentRows = [];
const relatedCardRows = [];
const unknownTokenCounts = new Map();
const unknownTokenExamples = new Map();

for (const item of items) {
  const content = item.content ?? "";
  const detected = [];
  for (const rule of rules) {
    const count = rule.count(content);
    if (count === 0) {
      continue;
    }
    const summary = summariesById.get(rule.id);
    summary.occurrences += count;
    summary.contentCount += 1;
    detected.push(rule.id);
    if (summary.examples.length < 5) {
      const match = rule.match(content);
      summary.examples.push({
        id: item.id,
        postType: item.postType,
        slug: item.slug,
        title: item.title,
        snippet: makeSnippet(content, match),
      });
    }
  }

  for (const match of content.matchAll(/\[\/([a-z0-9][a-z0-9_-]+)\]/gi)) {
    if (["caption", "audio", "video"].includes(match[1])) {
      continue;
    }
    relatedCardRows.push({
      id: item.id,
      postType: item.postType,
      slug: item.slug,
      title: item.title,
      targetSlug: match[1],
    });
  }

  for (const match of content.matchAll(/\[(\/?)([A-Za-z][A-Za-z0-9_-]*)(?:\s+[^\]]*)?\]/g)) {
    const name = `${match[1] === "/" ? "/" : ""}${match[2]}`;
    if (recognizedShortcodeNames.has(name) || isRelatedCardToken(name)) {
      continue;
    }
    unknownTokenCounts.set(name, (unknownTokenCounts.get(name) ?? 0) + 1);
    const examples = unknownTokenExamples.get(name) ?? [];
    if (examples.length < 3) {
      examples.push({
        id: item.id,
        postType: item.postType,
        slug: item.slug,
        title: item.title,
        snippet: makeSnippet(content, match),
      });
      unknownTokenExamples.set(name, examples);
    }
  }

  byContentRows.push({
    id: item.id,
    postType: item.postType,
    slug: item.slug,
    title: item.title,
    contentChars: content.length,
    blockTypes: detected.sort(),
  });
}

const groupedSummaries = summaries.reduce((map, summary) => {
  const group = map.get(summary.group) ?? [];
  group.push(summary);
  map.set(summary.group, group);
  return map;
}, new Map());

for (const group of groupedSummaries.values()) {
  group.sort((a, b) => b.contentCount - a.contentCount || b.occurrences - a.occurrences || a.id.localeCompare(b.id));
}

const groupOrder = [
  "基本本文",
  "インライン装飾",
  "コード・技術表現",
  "画像・メディア",
  "カード・埋め込み",
  "独自ボックス",
  "インタラクティブ・フォーム",
  "記事固有コード",
  "除外確認",
];

const inventoryLines = [
  "# コンテンツブロックタイプ洗い出し",
  "",
  "## 前提",
  "",
  `- 対象: ${items.length} 件（投稿 ${items.filter((item) => item.postType === "post").length} 件、固定ページ ${items.filter((item) => item.postType === "page").length} 件）`,
  "- 対象条件: `post_type IN ('post', 'page') AND post_status = 'publish' AND post_password = ''`",
  "- Gutenberg は使っていない前提。DB 本文上でも `<!-- wp:* -->` は 0 件。",
  "- 実レンダリングは見ず、DB の `post_content` に存在する HTML / class / shortcode / 独自記法から分類した。",
  "- `occurrences` は検出ルール上の出現数、`contents` はその種別を含むコンテンツ件数。",
  "",
];

for (const groupName of groupOrder) {
  const group = groupedSummaries.get(groupName) ?? [];
  inventoryLines.push(`## ${groupName}`, "");
  inventoryLines.push("| type | contents | occurrences | detector | note | examples |");
  inventoryLines.push("|---|---:|---:|---|---|---|");
  for (const summary of group) {
    const examples = summary.examples.map((example) => `${example.id}:${example.slug}`).join("<br>");
    inventoryLines.push(`| ${summary.label} | ${summary.contentCount} | ${summary.occurrences} | ${summary.detector.replaceAll("|", "\\|")} | ${summary.note.replaceAll("|", "\\|")} | ${examples} |`);
  }
  inventoryLines.push("");
}

inventoryLines.push("## 補足", "");
inventoryLines.push("- `画像` の総数には、商品カード・アプリカード・吹き出しアイコンなど内包画像も含まれる。純粋な本文画像だけを分けたい場合は、次段階で親要素 class ベースの除外ルールを追加する。");
inventoryLines.push("- `関連記事カード（slug 独自記法）` は `[/slug]` 形式。閉じタグではなく独自カード記法として扱っている。");
inventoryLines.push("- `[bps]`, `[V]`, `[Ctrl]`, `[username]` などは shortcode 風に見えるが、本文・単位・コード例・UI 表記なのでブロックタイプから除外した。詳細は `unknown-shortcode-like-tokens.md`。");
inventoryLines.push("");

fs.writeFileSync(inventoryPath, `${inventoryLines.join("\n")}\n`);

fs.writeFileSync(
  countsPath,
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    inputPath,
    targetCount: items.length,
    postTypeCounts: {
      post: items.filter((item) => item.postType === "post").length,
      page: items.filter((item) => item.postType === "page").length,
    },
    blockTypes: summaries,
  }, null, 2)}\n`,
);

const byContentHeader = ["id", "post_type", "slug", "title", "content_chars", "block_types"];
const byContentLines = [
  byContentHeader.join("\t"),
  ...byContentRows.map((row) => [
    row.id,
    row.postType,
    row.slug,
    row.title,
    row.contentChars,
    row.blockTypes.join(","),
  ].map(escapeTsv).join("\t")),
];
fs.writeFileSync(byContentPath, `${byContentLines.join("\n")}\n`);

const snippetLines = ["# 代表スニペット", ""];
for (const groupName of groupOrder) {
  const group = groupedSummaries.get(groupName) ?? [];
  snippetLines.push(`## ${groupName}`, "");
  for (const summary of group.filter((entry) => 0 < entry.contentCount)) {
    snippetLines.push(`### ${summary.label}`, "");
    snippetLines.push(`- type: \`${summary.id}\``);
    snippetLines.push(`- contents: ${summary.contentCount}`);
    snippetLines.push(`- occurrences: ${summary.occurrences}`);
    snippetLines.push("");
    for (const example of summary.examples) {
      snippetLines.push(`#### ${example.id}:${example.slug}`);
      snippetLines.push("");
      snippetLines.push(`- ${example.title}`);
      if (example.snippet !== "") {
        snippetLines.push("");
        snippetLines.push("```html");
        snippetLines.push(example.snippet);
        snippetLines.push("```");
      }
      snippetLines.push("");
    }
  }
}
fs.writeFileSync(snippetsPath, `${snippetLines.join("\n")}\n`);

const relatedHeader = ["id", "post_type", "slug", "title", "target_slug"];
const relatedLines = [
  relatedHeader.join("\t"),
  ...relatedCardRows.map((row) => [
    row.id,
    row.postType,
    row.slug,
    row.title,
    row.targetSlug,
  ].map(escapeTsv).join("\t")),
];
fs.writeFileSync(relatedCardsPath, `${relatedLines.join("\n")}\n`);

const unknownEntries = [...unknownTokenCounts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([name, count]) => ({
    name,
    count,
    examples: unknownTokenExamples.get(name) ?? [],
  }));
const unknownLines = [
  "# shortcode 風だがブロック扱いしない候補",
  "",
  "ここには `[xxx]` 形式で検出されたが、既知 shortcode や `[/slug]` 関連記事カードではないものを載せる。",
  "単位、キー表記、コード例、UI 文言が多く、基本的にはブロックタイプではない。",
  "",
  "| token | occurrences | examples |",
  "|---|---:|---|",
];
for (const entry of unknownEntries) {
  const examples = entry.examples.map((example) => `${example.id}:${example.slug}`).join("<br>");
  unknownLines.push(`| ${entry.name.replaceAll("|", "\\|")} | ${entry.count} | ${examples} |`);
}
unknownLines.push("");
fs.writeFileSync(unknownTokensPath, unknownLines.join("\n"));

console.log(`Wrote ${inventoryPath}`);
console.log(`Wrote ${countsPath}`);
console.log(`Wrote ${byContentPath}`);
console.log(`Wrote ${snippetsPath}`);
console.log(`Wrote ${relatedCardsPath}`);
console.log(`Wrote ${unknownTokensPath}`);
