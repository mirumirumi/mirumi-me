import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { finished } from "node:stream/promises"
import { fileURLToPath } from "node:url"

import type { WordPressAttachmentRecord, WordPressContentRecord } from "./types"

const outputPath = fileURLToPath(
  new URL("../blog-content-block-survey/contents.ndjson", import.meta.url),
)
const attachmentsPath = fileURLToPath(new URL("../media-attachments.ndjson", import.meta.url))
const rawTemporaryPath = `${outputPath}.raw.tmp`
const temporaryPath = `${outputPath}.tmp`
const attachmentsTemporaryPath = `${attachmentsPath}.tmp`

const php = String.raw`<?php
ini_set('display_errors', 'stderr');
$config = file_get_contents('/home/c2485919/public_html/mirumi.in/wp-config.php');
$config = preg_replace(
    '/require_once\s+ABSPATH\s*\.\s*[\'\"]wp-settings\.php[\'\"]\s*;/',
    '',
    $config
);
eval('?>' . $config);

$host = DB_HOST;
$port = 3306;
if (preg_match('/^(.+):(\d+)$/', $host, $matches)) {
    $host = $matches[1];
    $port = (int) $matches[2];
}

$database = mysqli_init();
$database->real_connect($host, DB_USER, DB_PASSWORD, DB_NAME, $port);
$database->set_charset('utf8mb4');
$postsTable = $table_prefix . 'posts';
$postmetaTable = $table_prefix . 'postmeta';
$relationshipsTable = $table_prefix . 'term_relationships';
$taxonomyTable = $table_prefix . 'term_taxonomy';
$termsTable = $table_prefix . 'terms';

function query(mysqli $database, string $sql): mysqli_result {
    $result = $database->query($sql);
    if (!$result) {
        throw new RuntimeException($database->error);
    }
    return $result;
}

$rows = query($database, "
SELECT
  ID,
  post_type,
  post_date,
  post_modified,
  post_name,
  post_title,
  post_excerpt,
  post_content
FROM {$postsTable}
WHERE post_type IN ('post', 'page')
  AND post_status = 'publish'
  AND post_password = ''
ORDER BY post_type, post_date, ID
");
$posts = $rows->fetch_all(MYSQLI_ASSOC);
$rows->free();
$postIds = array_map(fn(array $post): int => (int) $post['ID'], $posts);
$postIdsSql = implode(',', $postIds);

$metadata = [];
$rows = query($database, "
SELECT post_id, meta_key, meta_value
FROM {$postmetaTable}
WHERE post_id IN ({$postIdsSql})
  AND meta_key IN (
    '_thumbnail_id',
    'show_thumbnail_on_frontend',
    'the_page_toc_novisible'
  )
ORDER BY meta_id
");
foreach ($rows as $row) {
    $postId = (int) $row['post_id'];
    if (!isset($metadata[$postId])) {
        $metadata[$postId] = [];
    }
    if (!array_key_exists($row['meta_key'], $metadata[$postId])) {
        $metadata[$postId][$row['meta_key']] = $row['meta_value'];
    }
}
$rows->free();

$categories = [];
$rows = query($database, "
SELECT relationships.object_id, terms.name, terms.slug
FROM {$relationshipsTable} AS relationships
JOIN {$taxonomyTable} AS taxonomy USING (term_taxonomy_id)
JOIN {$termsTable} AS terms USING (term_id)
WHERE relationships.object_id IN ({$postIdsSql})
  AND taxonomy.taxonomy = 'category'
ORDER BY relationships.object_id, relationships.term_order, taxonomy.term_taxonomy_id
");
foreach ($rows as $row) {
    $categories[(int) $row['object_id']][] = [
        'name' => $row['name'],
        'slug' => $row['slug'],
    ];
}
$rows->free();

$thumbnailIds = [];
foreach ($metadata as $postMetadata) {
    if (!empty($postMetadata['_thumbnail_id'])) {
        $thumbnailIds[] = (int) $postMetadata['_thumbnail_id'];
    }
}
$thumbnailUrls = [];
if (0 < count($thumbnailIds)) {
    $thumbnailIdsSql = implode(',', array_unique($thumbnailIds));
    $rows = query($database, "SELECT ID, guid FROM {$postsTable} WHERE ID IN ({$thumbnailIdsSql})");
    foreach ($rows as $row) {
        $thumbnailUrls[(int) $row['ID']] = preg_replace(
            '/(mirumi\.me|milmemo\.net|mirumi\.in)\/wp-content\/uploads\//i',
            'mirumi.media/',
            $row['guid']
        );
    }
    $rows->free();
}

$tocClosedIds = [689, 861, 1458, 1497, 6471, 8961, 9648, 9875, 10056, 14338, 14464, 14554, 19993];
foreach ($posts as $post) {
    $id = (int) $post['ID'];
    $postMetadata = $metadata[$id] ?? [];
    $thumbnailId = (int) ($postMetadata['_thumbnail_id'] ?? 0);
    $record = [
        'id' => $id,
        'postType' => $post['post_type'],
        'postDate' => $post['post_date'],
        'postModified' => $post['post_modified'],
        'slug' => $post['post_name'],
        'title' => $post['post_title'],
        'excerpt' => $post['post_excerpt'],
        'content' => $post['post_content'],
        'categories' => $categories[$id] ?? [],
        'thumbnailUrl' => $thumbnailUrls[$thumbnailId] ?? null,
        'showThumbnailOnFrontend' => ($postMetadata['show_thumbnail_on_frontend'] ?? '') === '1',
        'tocHidden' => ($postMetadata['the_page_toc_novisible'] ?? '') === '1',
        'tocClosed' => in_array($id, $tocClosedIds, true),
    ];
    echo json_encode(
        ['recordType' => 'content', 'record' => $record],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    ) . PHP_EOL;
}

$rows = query($database, "
SELECT
  attachments.ID,
  attachments.guid,
  attachments.post_mime_type,
  attached_file.meta_value AS attached_file,
  attachment_metadata.meta_value AS attachment_metadata
FROM {$postsTable} AS attachments
LEFT JOIN {$postmetaTable} AS attached_file
  ON attached_file.post_id = attachments.ID
  AND attached_file.meta_key = '_wp_attached_file'
LEFT JOIN {$postmetaTable} AS attachment_metadata
  ON attachment_metadata.post_id = attachments.ID
  AND attachment_metadata.meta_key = '_wp_attachment_metadata'
WHERE attachments.post_type = 'attachment'
  AND attachments.post_mime_type LIKE 'image/%'
ORDER BY attachments.ID
");
foreach ($rows as $row) {
    $metadataValue = $row['attachment_metadata'];
    $attachmentMetadata = is_string($metadataValue)
        ? @unserialize($metadataValue, ['allowed_classes' => false])
        : false;
    $file = is_array($attachmentMetadata) && !empty($attachmentMetadata['file'])
        ? $attachmentMetadata['file']
        : $row['attached_file'];
    if (!is_string($file) || $file === '') {
        continue;
    }
    $directory = dirname($file);
    $directory = $directory === '.' ? '' : trim($directory, '/') . '/';
    $sourceUrls = ['https://mirumi.media/' . ltrim($file, '/') => true];
    $guid = preg_replace(
        '/(mirumi\.me|milmemo\.net|mirumi\.in)\/wp-content\/uploads\//i',
        'mirumi.media/',
        $row['guid']
    );
    if (is_string($guid) && $guid !== '') {
        $sourceUrls[$guid] = true;
    }
    if (is_array($attachmentMetadata) && isset($attachmentMetadata['sizes'])) {
        foreach ($attachmentMetadata['sizes'] as $size) {
            if (is_array($size) && !empty($size['file'])) {
                $sourceUrls['https://mirumi.media/' . $directory . $size['file']] = true;
            }
        }
    }
    $attachment = [
        'id' => (int) $row['ID'],
        'mimeType' => $row['post_mime_type'],
        'originalUrl' => 'https://mirumi.media/' . ltrim($file, '/'),
        'sourceUrls' => array_keys($sourceUrls),
    ];
    echo json_encode(
        ['recordType' => 'attachment', 'record' => $attachment],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    ) . PHP_EOL;
}
$rows->free();
$database->close();
`

const validateRecord = (value: unknown, index: number): WordPressContentRecord => {
  if (!value || typeof value !== "object") {
    throw Error(`${index + 1} 行目がオブジェクトではありません`)
  }

  const record = value as Partial<WordPressContentRecord>
  if (
    typeof record.id !== "number" ||
    (record.postType !== "page" && record.postType !== "post") ||
    typeof record.slug !== "string" ||
    typeof record.title !== "string" ||
    typeof record.content !== "string" ||
    !Array.isArray(record.categories)
  ) {
    throw Error(`${index + 1} 行目の形式が不正です`)
  }

  return record as WordPressContentRecord
}

const validateAttachment = (value: unknown, index: number): WordPressAttachmentRecord => {
  if (!value || typeof value !== "object") {
    throw Error(`${index + 1} 行目の attachment がオブジェクトではありません`)
  }
  const record = value as Partial<WordPressAttachmentRecord>
  if (
    typeof record.id !== "number" ||
    typeof record.mimeType !== "string" ||
    typeof record.originalUrl !== "string" ||
    !Array.isArray(record.sourceUrls) ||
    record.sourceUrls.some((url) => typeof url !== "string")
  ) {
    throw Error(`${index + 1} 行目の attachment 形式が不正です`)
  }

  return record as WordPressAttachmentRecord
}

const child = spawn("ssh", ["conoha-wing", "php"], {
  stdio: ["pipe", "pipe", "pipe"],
})
const output = createWriteStream(rawTemporaryPath, { mode: 0o600 })
let stderr = ""
const exitCodePromise = new Promise<number | null>((resolve, reject) => {
  child.on("error", reject)
  child.on("close", resolve)
})
const outputFinishedPromise = finished(output)

child.stdout.pipe(output)
child.stderr.setEncoding("utf8")
child.stderr.on("data", (chunk: string) => {
  stderr += chunk
})
child.stdin.end(php)

const exitCode = await exitCodePromise
await outputFinishedPromise
if (exitCode !== 0) {
  await rm(rawTemporaryPath, { force: true })
  throw Error(`取得に失敗しました (${exitCode})\n${stderr}`)
}

const lines = (await readFile(rawTemporaryPath, "utf8")).trimEnd().split("\n").filter(Boolean)
const contents: Array<string> = []
const attachments: Array<string> = []
for (const [index, line] of lines.entries()) {
  const value = JSON.parse(line) as {
    recordType?: unknown
    record?: unknown
  }
  if (value.recordType === "content") {
    contents.push(JSON.stringify(validateRecord(value.record, index)))
  } else if (value.recordType === "attachment") {
    attachments.push(JSON.stringify(validateAttachment(value.record, index)))
  } else {
    throw Error(`${index + 1} 行目の recordType が不正です`)
  }
}

await Promise.all([
  writeFile(temporaryPath, `${contents.join("\n")}\n`, { mode: 0o600 }),
  writeFile(attachmentsTemporaryPath, `${attachments.join("\n")}\n`, { mode: 0o600 }),
])
await rm(rawTemporaryPath, { force: true })
await rename(attachmentsTemporaryPath, attachmentsPath)
await rename(temporaryPath, outputPath)
process.stdout.write(
  `${contents.length} 件を ${outputPath}、${attachments.length} 件を ${attachmentsPath} に保存しました\n`,
)
