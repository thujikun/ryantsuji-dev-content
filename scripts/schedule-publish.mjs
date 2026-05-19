#!/usr/bin/env node
/**
 * 予約投稿 (scheduled publish) — `posts/` の draft post を publishedAt 到達時に
 * `draft: true` 行を物理的に削除する Node.js ESM スクリプト。
 *
 * Self-contained: 外部依存ゼロで `node scripts/schedule-publish.mjs` で動く。
 * frontmatter は YAML パーサーを使わず ASCII scalar 限定の軽量 regex 抽出
 * (publishedAt + draft 2 field のみ必要)。
 *
 * 仕様:
 * - `draft: true` && `publishedAt <= now` の post は frontmatter 内の `draft:` 行を strip
 * - `_` で始まる slug (test fixture) は常に skip
 * - 不正な publishedAt は false 側に倒す (= 公開しない、安全側)
 * - 公開した post は `PUBLISHED <filename>` を 1 行ずつ stdout に書く (workflow が拾う)
 * - --dry-run は file を書かず print のみ
 * - --dir で対象 dir を上書き (default `posts`)
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const POSTS_DIR_DEFAULT = "posts";

export function shouldPublish(publishedAt, now) {
  const target = new Date(publishedAt);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() <= now.getTime();
}

export function stripDraftLine(markdown) {
  const fmMatch = markdown.match(/^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/u);
  if (!fmMatch) return markdown;
  const [whole, openDelim, body, closeDelim] = fmMatch;
  const lines = body.split(/\r?\n/u);
  const filtered = lines.filter((line) => !/^draft:\s*true\s*$/u.test(line));
  if (filtered.length === lines.length) return markdown;
  const rebuilt = `${openDelim}${filtered.join("\n")}${closeDelim}`;
  return markdown.replace(whole, rebuilt);
}

export function extractMeta(markdown) {
  const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!fmMatch) return { publishedAt: null, draft: false };
  const fm = fmMatch[1];
  const pubMatch = fm.match(/^publishedAt:\s*["']?([^"'\n\r]+)["']?\s*$/mu);
  const draftMatch = fm.match(/^draft:\s*true\s*$/mu);
  return {
    publishedAt: pubMatch ? (pubMatch[1] ?? null) : null,
    draft: draftMatch !== null,
  };
}

export function slugOfFilename(filename) {
  const m = filename.match(/^(.+)\.(en|ja)\.md$/u);
  return m ? (m[1] ?? filename) : filename;
}

export function evaluatePost(filename, markdown, now) {
  const meta = extractMeta(markdown);
  const slug = slugOfFilename(filename);
  const base = { filename, slug, publishedAt: meta.publishedAt ?? "" };
  if (slug.startsWith("_")) return { ...base, changed: false };
  if (!meta.draft) return { ...base, changed: false };
  if (!meta.publishedAt) return { ...base, changed: false };
  if (!shouldPublish(meta.publishedAt, now)) return { ...base, changed: false };
  const newContent = stripDraftLine(markdown);
  if (newContent === markdown) return { ...base, changed: false };
  return { ...base, changed: true, newContent };
}

export async function evaluateDirectory(dir, now) {
  const entries = await readdir(dir);
  const mdFiles = entries.filter((f) => f.endsWith(".md"));
  const evaluations = [];
  for (const filename of mdFiles) {
    const fullPath = join(dir, filename);
    const content = await readFile(fullPath, "utf8");
    evaluations.push(evaluatePost(filename, content, now));
  }
  return evaluations;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dirIdx = args.indexOf("--dir");
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : POSTS_DIR_DEFAULT;
  if (!dir) {
    console.error("usage: schedule-publish.mjs [--dir <path>] [--dry-run]");
    process.exit(1);
  }
  const absDir = resolve(dir);
  const now = new Date();
  const evaluations = await evaluateDirectory(absDir, now);

  const toPublish = evaluations.filter((e) => e.changed && e.newContent);
  if (toPublish.length === 0) {
    console.log("# schedule-publish: no posts ready for publish");
    return;
  }

  for (const ev of toPublish) {
    const path = join(absDir, ev.filename);
    if (!dryRun) {
      await writeFile(path, ev.newContent ?? "", "utf8");
    }
    console.log(`PUBLISHED ${ev.filename}`);
  }
}

// `node scripts/schedule-publish.mjs` で直接実行された時のみ main を回す。
// `import { ... } from "./schedule-publish.mjs"` 経由 (test など) では main は走らない。
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
