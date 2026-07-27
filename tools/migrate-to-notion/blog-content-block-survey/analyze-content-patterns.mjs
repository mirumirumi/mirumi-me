import fs from "node:fs";
import path from "node:path";

const baseDir = ".contexts/blog-content-block-survey";
const inputPath = path.join(baseDir, "contents.ndjson");
const rawPatternsPath = path.join(baseDir, "raw-patterns.json");
const contentPatternsPath = path.join(baseDir, "content-patterns.tsv");
const rawSummaryPath = path.join(baseDir, "raw-pattern-summary.md");

const increment = (map, key, amount = 1) => {
  map.set(key, (map.get(key) ?? 0) + amount);
};

const addExample = (map, key, item, snippet = "") => {
  const examples = map.get(key) ?? [];
  if (3 <= examples.length) {
    return;
  }
  if (examples.some((example) => example.id === item.id)) {
    return;
  }
  examples.push({
    id: item.id,
    postType: item.postType,
    slug: item.slug,
    title: item.title,
    snippet: snippet.replace(/\s+/g, " ").trim().slice(0, 180),
  });
  map.set(key, examples);
};

const toSortedEntries = (counts, examples) => {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({
      name,
      count,
      examples: examples.get(name) ?? [],
    }));
};

const escapeTsv = (value) => {
  return String(value).replace(/\t/g, " ").replace(/\r?\n/g, " ");
};

const getDomain = (url) => {
  try {
    const parsed = new URL(url.startsWith("//") ? `https:${url}` : url);
    return parsed.hostname.replace(/^www\./, "");
  } catch (err) {
    return "";
  }
};

const stripRecognizedSyntax = (content) => {
  return content
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/\[[A-Za-z][A-Za-z0-9_-]*(?:\s+[^\]]*)?\]/g, "\n")
    .replace(/\[\/[A-Za-z][A-Za-z0-9_-]*\]/g, "\n")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/https?:\/\/\S+/g, "\n")
    .replace(/&[a-zA-Z0-9#]+;/g, " ")
    .trim();
};

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

const items = readItems();

const tagCounts = new Map();
const tagContentCounts = new Map();
const tagExamples = new Map();
const classCounts = new Map();
const classContentCounts = new Map();
const classExamples = new Map();
const idCounts = new Map();
const idContentCounts = new Map();
const idExamples = new Map();
const shortcodeCounts = new Map();
const shortcodeContentCounts = new Map();
const shortcodeExamples = new Map();
const commentCounts = new Map();
const commentContentCounts = new Map();
const commentExamples = new Map();
const domainCounts = new Map();
const domainContentCounts = new Map();
const domainExamples = new Map();
const linePatternCounts = new Map();
const linePatternContentCounts = new Map();
const linePatternExamples = new Map();
const candidateTypeCounts = new Map();
const candidateTypeContentCounts = new Map();
const candidateTypeExamples = new Map();

const contentRows = [];

for (const item of items) {
  const content = item.content ?? "";
  const localTags = new Set();
  const localClasses = new Set();
  const localIds = new Set();
  const localShortcodes = new Set();
  const localComments = new Set();
  const localDomains = new Set();
  const localLinePatterns = new Set();
  const candidateTypes = new Set();

  for (const match of content.matchAll(/<\s*\/?\s*([a-zA-Z][a-zA-Z0-9:-]*)\b[^>]*>/g)) {
    const tag = match[1].toLowerCase();
    increment(tagCounts, tag);
    localTags.add(tag);
    addExample(tagExamples, tag, item, match[0]);
  }

  for (const match of content.matchAll(/\sclass\s*=\s*(["'])(.*?)\1/gis)) {
    for (const className of match[2].split(/\s+/).filter(Boolean)) {
      increment(classCounts, className);
      localClasses.add(className);
      addExample(classExamples, className, item, match[0]);
    }
  }

  for (const match of content.matchAll(/\sid\s*=\s*(["'])(.*?)\1/gis)) {
    const id = match[2].trim();
    if (id === "") {
      continue;
    }
    increment(idCounts, id);
    localIds.add(id);
    addExample(idExamples, id, item, match[0]);
  }

  for (const match of content.matchAll(/\[(\/?)([A-Za-z][A-Za-z0-9_-]*)(?:\s+[^\]]*)?\]/g)) {
    const shortcode = `${match[1] === "/" ? "/" : ""}${match[2]}`;
    increment(shortcodeCounts, shortcode);
    localShortcodes.add(shortcode);
    addExample(shortcodeExamples, shortcode, item, match[0]);
  }

  for (const match of content.matchAll(/<!--([\s\S]*?)-->/g)) {
    const comment = match[1].trim().replace(/\s+/g, " ").slice(0, 80);
    const key = comment === "" ? "(empty)" : comment;
    increment(commentCounts, key);
    localComments.add(key);
    addExample(commentExamples, key, item, match[0]);
  }

  for (const match of content.matchAll(/(?:https?:)?\/\/[^\s"'<>]+/g)) {
    const domain = getDomain(match[0]);
    if (domain === "") {
      continue;
    }
    increment(domainCounts, domain);
    localDomains.add(domain);
    addExample(domainExamples, domain, item, match[0]);
  }

  const nonEmptyLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  for (const line of nonEmptyLines) {
    const key =
      line.startsWith("<")
        ? "html-start-line"
        : line.startsWith("[")
          ? "shortcode-start-line"
          : /^https?:\/\/\S+$/.test(line)
            ? "bare-url-line"
            : "text-line";
    increment(linePatternCounts, key);
    localLinePatterns.add(key);
    addExample(linePatternExamples, key, item, line);
  }

  if (stripRecognizedSyntax(content) !== "") {
    candidateTypes.add("plain_text");
  }
  if (/<h[1-6]\b/i.test(content)) {
    candidateTypes.add("heading");
  }
  if (/<img\b/i.test(content)) {
    candidateTypes.add("image");
  }
  if (/\[caption\b/i.test(content) || /<figcaption\b/i.test(content) || /\bwp-caption\b/i.test(content)) {
    candidateTypes.add("captioned_image");
  }
  if (/<table\b/i.test(content)) {
    candidateTypes.add("table");
  }
  if (/<(?:ul|ol)\b/i.test(content)) {
    candidateTypes.add("list");
  }
  if (/<blockquote\b/i.test(content)) {
    candidateTypes.add("blockquote");
  }
  if (/<(?:pre|code)\b/i.test(content)) {
    candidateTypes.add("code");
  }
  if (/<iframe\b/i.test(content) || /\b(?:youtube\.com|youtu\.be|vimeo\.com|twitter\.com|x\.com)\b/i.test(content)) {
    candidateTypes.add("embed");
  }
  if (/<a\b/i.test(content)) {
    candidateTypes.add("inline_or_html_link");
  }
  if (/\[(?:blogcard|kanren|card|linkcard|amazonjs|wpdm_package)\b/i.test(content)) {
    candidateTypes.add("shortcode_card_or_embed");
  }
  if (/\b(?:box|memo|point|alert|notice|attention|tips|blank-box|information|supplement|profile|speech|balloon)\b/i.test(content)) {
    candidateTypes.add("custom_box_or_decorated_block");
  }
  if (content.trim() === "") {
    candidateTypes.add("empty_content");
  }

  for (const tag of localTags) {
    increment(tagContentCounts, tag);
  }
  for (const className of localClasses) {
    increment(classContentCounts, className);
  }
  for (const id of localIds) {
    increment(idContentCounts, id);
  }
  for (const shortcode of localShortcodes) {
    increment(shortcodeContentCounts, shortcode);
  }
  for (const comment of localComments) {
    increment(commentContentCounts, comment);
  }
  for (const domain of localDomains) {
    increment(domainContentCounts, domain);
  }
  for (const linePattern of localLinePatterns) {
    increment(linePatternContentCounts, linePattern);
  }
  for (const candidateType of candidateTypes) {
    increment(candidateTypeCounts, candidateType);
    increment(candidateTypeContentCounts, candidateType);
    addExample(candidateTypeExamples, candidateType, item);
  }

  contentRows.push({
    id: item.id,
    postType: item.postType,
    slug: item.slug,
    title: item.title,
    contentChars: content.length,
    tags: [...localTags].sort(),
    classes: [...localClasses].sort(),
    shortcodes: [...localShortcodes].sort(),
    comments: [...localComments].sort(),
    domains: [...localDomains].sort(),
    candidateTypes: [...candidateTypes].sort(),
  });
}

const rawPatterns = {
  generatedAt: new Date().toISOString(),
  inputPath,
  contentCount: items.length,
  postTypeCounts: Object.fromEntries(
    [...items.reduce((map, item) => {
      increment(map, item.postType);
      return map;
    }, new Map()).entries()].sort(),
  ),
  tags: toSortedEntries(tagCounts, tagExamples).map((entry) => ({
    ...entry,
    contentCount: tagContentCounts.get(entry.name) ?? 0,
  })),
  classes: toSortedEntries(classCounts, classExamples).map((entry) => ({
    ...entry,
    contentCount: classContentCounts.get(entry.name) ?? 0,
  })),
  ids: toSortedEntries(idCounts, idExamples).map((entry) => ({
    ...entry,
    contentCount: idContentCounts.get(entry.name) ?? 0,
  })),
  shortcodes: toSortedEntries(shortcodeCounts, shortcodeExamples).map((entry) => ({
    ...entry,
    contentCount: shortcodeContentCounts.get(entry.name) ?? 0,
  })),
  htmlComments: toSortedEntries(commentCounts, commentExamples).map((entry) => ({
    ...entry,
    contentCount: commentContentCounts.get(entry.name) ?? 0,
  })),
  domains: toSortedEntries(domainCounts, domainExamples).map((entry) => ({
    ...entry,
    contentCount: domainContentCounts.get(entry.name) ?? 0,
  })),
  linePatterns: toSortedEntries(linePatternCounts, linePatternExamples).map((entry) => ({
    ...entry,
    contentCount: linePatternContentCounts.get(entry.name) ?? 0,
  })),
  candidateTypes: toSortedEntries(candidateTypeCounts, candidateTypeExamples).map((entry) => ({
    ...entry,
    contentCount: candidateTypeContentCounts.get(entry.name) ?? 0,
  })),
};

fs.writeFileSync(rawPatternsPath, `${JSON.stringify(rawPatterns, null, 2)}\n`);

const tsvHeader = [
  "id",
  "post_type",
  "slug",
  "title",
  "content_chars",
  "candidate_types",
  "tags",
  "classes",
  "shortcodes",
  "comments",
  "domains",
];
const tsvRows = contentRows.map((row) => [
  row.id,
  row.postType,
  row.slug,
  row.title,
  row.contentChars,
  row.candidateTypes.join(","),
  row.tags.join(","),
  row.classes.join(","),
  row.shortcodes.join(","),
  row.comments.join(" | "),
  row.domains.join(","),
].map(escapeTsv).join("\t"));
fs.writeFileSync(contentPatternsPath, `${tsvHeader.join("\t")}\n${tsvRows.join("\n")}\n`);

const topTable = (title, entries, limit = 40) => {
  const lines = [`## ${title}`, "", "| name | occurrences | contents | examples |", "|---|---:|---:|---|"];
  for (const entry of entries.slice(0, limit)) {
    const examples = entry.examples
      .map((example) => `${example.id}:${example.slug}`)
      .join("<br>");
    lines.push(`| ${entry.name.replaceAll("|", "\\|")} | ${entry.count} | ${entry.contentCount} | ${examples} |`);
  }
  lines.push("");
  return lines.join("\n");
};

const summary = [
  "# 本文構造の機械集計",
  "",
  `- 対象: ${items.length} 件`,
  `- 投稿: ${items.filter((item) => item.postType === "post").length} 件`,
  `- 固定ページ: ${items.filter((item) => item.postType === "page").length} 件`,
  `- 元データ: \`${inputPath}\``,
  `- 詳細 JSON: \`${rawPatternsPath}\``,
  `- 記事別 TSV: \`${contentPatternsPath}\``,
  "",
  topTable("候補タイプ", rawPatterns.candidateTypes, 80),
  topTable("HTML タグ", rawPatterns.tags, 80),
  topTable("ショートコード", rawPatterns.shortcodes, 80),
  topTable("class", rawPatterns.classes, 120),
  topTable("URL ドメイン", rawPatterns.domains, 80),
  topTable("HTML コメント", rawPatterns.htmlComments, 80),
].join("\n");

fs.writeFileSync(rawSummaryPath, summary);

console.log(`Wrote ${rawPatternsPath}`);
console.log(`Wrote ${contentPatternsPath}`);
console.log(`Wrote ${rawSummaryPath}`);
