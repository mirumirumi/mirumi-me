import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import { finished } from "node:stream/promises"
import { fileURLToPath } from "node:url"

import type { WordPressCommentRecord } from "./comments-import-core"

// 承認済みコメントだけを SSH の標準出力で取り出す。公開 endpoint も server 上の一時 file も使わない。
// メールアドレスを含むため出力は 0600 で、git には含めない
const outputPath = fileURLToPath(new URL("../comments.ndjson", import.meta.url))
const rawTemporaryPath = `${outputPath}.raw.tmp`
const temporaryPath = `${outputPath}.tmp`

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
$commentsTable = $table_prefix . 'comments';
$postsTable = $table_prefix . 'posts';

$rows = $database->query("
SELECT
  comments.comment_ID,
  comments.comment_post_ID,
  posts.post_name,
  comments.comment_parent,
  comments.user_id,
  comments.comment_author,
  comments.comment_author_email,
  comments.comment_date_gmt,
  comments.comment_content
FROM {$commentsTable} AS comments
JOIN {$postsTable} AS posts ON posts.ID = comments.comment_post_ID
WHERE comments.comment_approved = '1'
  AND comments.comment_type = 'comment'
ORDER BY comments.comment_ID
");
if (!$rows) {
    throw new RuntimeException($database->error);
}
foreach ($rows as $row) {
    $record = [
        'id' => (int) $row['comment_ID'],
        'postId' => (int) $row['comment_post_ID'],
        'postSlug' => $row['post_name'],
        'parentId' => (int) $row['comment_parent'] === 0 ? null : (int) $row['comment_parent'],
        'isOwner' => (int) $row['user_id'] === 1,
        'author' => $row['comment_author'],
        'email' => $row['comment_author_email'],
        'createdAt' => str_replace(' ', 'T', $row['comment_date_gmt']) . '.000Z',
        'content' => $row['comment_content'],
    ];
    echo json_encode(
        $record,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    ) . PHP_EOL;
}
$rows->free();
$database->close();
`

const validateRecord = (value: unknown, index: number): WordPressCommentRecord => {
  if (!value || typeof value !== "object") {
    throw Error(`${index + 1} 行目がオブジェクトではありません`)
  }
  const record = value as Partial<WordPressCommentRecord>
  if (
    typeof record.id !== "number" ||
    typeof record.postId !== "number" ||
    typeof record.postSlug !== "string" ||
    record.postSlug === "" ||
    (record.parentId !== null && typeof record.parentId !== "number") ||
    typeof record.isOwner !== "boolean" ||
    typeof record.author !== "string" ||
    typeof record.email !== "string" ||
    typeof record.createdAt !== "string" ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    typeof record.content !== "string"
  ) {
    throw Error(`${index + 1} 行目の形式が不正です`)
  }

  return record as WordPressCommentRecord
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
const records = lines.map((line, index) => JSON.stringify(validateRecord(JSON.parse(line), index)))
await writeFile(temporaryPath, `${records.join("\n")}\n`, { mode: 0o600 })
await rm(rawTemporaryPath, { force: true })
await rename(temporaryPath, outputPath)
process.stdout.write(`承認済みコメント ${records.length} 件を ${outputPath} に保存しました\n`)
