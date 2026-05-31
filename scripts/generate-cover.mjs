#!/usr/bin/env node
/**
 * generate-cover.mjs
 *
 * content repo 配下の各 post に対し、cover PNG が `images/posts/<slug>.<lang>.cover.png` に
 * 存在しなければ satori + resvg で 1200x630 PNG を生成して書き出し、frontmatter の
 * `cover:` フィールドも `/images/posts/<slug>.<lang>.cover.png` で揃える。
 *
 * - 既存 cover はデフォルトで再生成しない（idempotent）。`--force` で再生成。
 * - フォントは jsdelivr から 1 回だけ取得して `.cache/og-fonts/` にキャッシュ。
 * - frontmatter は YAML 全体を再シリアライズせず、`cover:` 行だけ regex で surgical に注入。
 *
 * Usage:
 *   node scripts/generate-cover.mjs              # 全 post を走査、欠けてる分だけ生成
 *   node scripts/generate-cover.mjs --slug X     # 特定 slug のみ
 *   node scripts/generate-cover.mjs --force      # 既存も再生成（タイトル更新後など）
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');
const POSTS_DIR = resolve(REPO_ROOT, 'posts');
const COVERS_DIR = resolve(REPO_ROOT, 'images/posts');
const FONT_CACHE_DIR = resolve(REPO_ROOT, '.cache/og-fonts');

const FONT_SOURCES = {
  serif:
    'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-jp@5/files/noto-serif-jp-japanese-700-normal.woff',
  sans: 'https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-500-normal.woff',
};

// ====================== font loading ======================
async function fetchFont(url, cachePath) {
  try {
    await stat(cachePath);
    const buf = await readFile(cachePath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch {
    /* cache miss, fall through */
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`font fetch failed (${res.status}): ${url}`);
  const ab = await res.arrayBuffer();
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, Buffer.from(ab));
  return ab;
}

async function loadFonts() {
  const serif = await fetchFont(
    FONT_SOURCES.serif,
    resolve(FONT_CACHE_DIR, 'noto-serif-jp-japanese-700.woff'),
  );
  const sans = await fetchFont(
    FONT_SOURCES.sans,
    resolve(FONT_CACHE_DIR, 'inter-latin-500.woff'),
  );
  return { serif, sans };
}

// ====================== satori VNode factory ======================
function h(type, props, ...children) {
  const flat = children
    .flat(Infinity)
    .filter((c) => c !== null && c !== undefined && c !== false);
  return {
    type,
    props: {
      style: props?.style,
      children: flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat,
    },
  };
}

// ====================== OG template ======================
const BRAND_TEAL = '#0abab5';
const BRAND_TEAL_LIGHT = '#39c4bf';
const TEXT_PRIMARY = '#f7f8f9';
const TEXT_MUTED = '#a3a8af';
const BG_BASE = '#0c1417';

/**
 * Box Drawing block (U+2500–U+257F) を em-dash に置換。Noto Serif JP に含まれず
 * tofu になるため block 単位で range 置換。
 */
function sanitizeOgText(text) {
  return text.replace(/[─-╿]/gu, '—');
}

function OgTemplate({ title }) {
  const safeTitle = sanitizeOgText(title);
  return h(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: BG_BASE,
        padding: '48px 96px 48px 96px',
        position: 'relative',
      },
    },
    // ambient blob (左上): site 本体の accent-bg と同じ teal glow
    h('div', {
      style: {
        position: 'absolute',
        top: -360,
        left: -360,
        width: 1080,
        height: 1080,
        backgroundImage: `radial-gradient(closest-side, ${BRAND_TEAL} 0%, transparent 70%)`,
        opacity: 0.45,
      },
    }),
    // ambient blob (右下): accent-border light
    h('div', {
      style: {
        position: 'absolute',
        bottom: -300,
        right: -300,
        width: 900,
        height: 900,
        backgroundImage: `radial-gradient(closest-side, ${BRAND_TEAL_LIGHT} 0%, transparent 70%)`,
        opacity: 0.32,
      },
    }),
    // 上段: rt logo
    h(
      'div',
      {
        style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 18 },
      },
      h(
        'div',
        {
          style: {
            fontFamily: 'sans',
            fontSize: 56,
            fontWeight: 700,
            color: BRAND_TEAL,
            letterSpacing: '-0.04em',
          },
        },
        'rt',
      ),
      h(
        'div',
        {
          style: {
            fontFamily: 'sans',
            fontSize: 28,
            color: TEXT_MUTED,
            letterSpacing: '0.02em',
          },
        },
        'ryantsuji.dev',
      ),
    ),
    // 中央: title
    h(
      'div',
      {
        style: { flex: 1, display: 'flex', alignItems: 'flex-start', marginTop: 32 },
      },
      h(
        'div',
        {
          style: {
            fontFamily: 'serif',
            fontSize: 64,
            lineHeight: 1.25,
            color: TEXT_PRIMARY,
            letterSpacing: '-0.015em',
          },
        },
        safeTitle,
      ),
    ),
    // 下段: tagline
    h(
      'div',
      {
        style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16 },
      },
      h('div', {
        style: { width: 4, height: 40, backgroundColor: BRAND_TEAL, borderRadius: 2 },
      }),
      h(
        'div',
        {
          style: {
            fontFamily: 'sans',
            fontSize: 24,
            color: TEXT_MUTED,
            letterSpacing: '0.04em',
          },
        },
        'engineering / design / product',
      ),
    ),
  );
}

// ====================== render ======================
async function renderCoverPng(title, fonts) {
  const svg = await satori(OgTemplate({ title }), {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'serif', data: fonts.serif, weight: 700, style: 'normal' },
      { name: 'sans', data: fonts.sans, weight: 500, style: 'normal' },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  return Buffer.from(png);
}

// ====================== frontmatter parsing / writing ======================
function parseFrontmatterBlock(source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
  if (!m) return null;
  return { fullMatch: m[0], body: m[1], bodyStart: source.indexOf(m[0]) + m[0].length };
}

/**
 * top-level scalar field を抽出する簡易 YAML 読み (title / draft / excludeFromSyndication 用)。
 * ネストや配列は対象外。`title: "..."` / `title: ...` 両方に対応。
 */
function readTopLevelField(frontmatterBody, key) {
  const lines = frontmatterBody.split('\n');
  for (const line of lines) {
    if (/^\s/.test(line)) continue; // skip indented (= nested) lines
    const m = new RegExp(`^${key}\\s*:\\s*(.*)$`).exec(line);
    if (m) {
      let value = m[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }
  return null;
}

/**
 * frontmatter の `cover:` 行を surgical に置換または末尾に追加する。
 * top-level の cover line のみを対象（indented = ネスト中の cover は無視）。
 */
function injectCoverLine(source, coverPath) {
  const fm = parseFrontmatterBlock(source);
  if (!fm) return { next: source, updated: false };
  const newCoverLine = `cover: ${coverPath}`;
  const lines = fm.body.split('\n');

  // top-level cover が存在するか確認
  let topLevelCoverIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^cover\s*:/.test(lines[i])) {
      topLevelCoverIdx = i;
      break;
    }
  }

  let newBody;
  if (topLevelCoverIdx >= 0) {
    if (lines[topLevelCoverIdx] === newCoverLine) {
      return { next: source, updated: false };
    }
    lines[topLevelCoverIdx] = newCoverLine;
    newBody = lines.join('\n');
  } else {
    newBody = `${fm.body}\n${newCoverLine}`;
  }

  return {
    next: `---\n${newBody}\n---\n${source.slice(fm.bodyStart)}`,
    updated: true,
  };
}

function parseFileName(filename) {
  const m = /^(.+)\.(ja|en)\.md$/.exec(filename);
  if (!m) return null;
  return { slug: m[1], lang: m[2] };
}

// ====================== main ======================
async function main() {
  const args = process.argv.slice(2);
  const slugIdx = args.indexOf('--slug');
  const slugFilter = slugIdx >= 0 ? args[slugIdx + 1] : null;
  const force = args.includes('--force');

  console.log('[cover-gen] loading fonts...');
  const fonts = await loadFonts();

  console.log('[cover-gen] reading posts...');
  const files = await readdir(POSTS_DIR);
  const targets = files.filter(
    (f) => /\.(ja|en)\.md$/.test(f) && !f.startsWith('_'),
  );

  await mkdir(COVERS_DIR, { recursive: true });

  let generated = 0;
  let updated = 0;
  let skipped = 0;

  for (const f of targets) {
    const meta = parseFileName(f);
    if (!meta) continue;
    if (slugFilter && meta.slug !== slugFilter) continue;

    const filepath = resolve(POSTS_DIR, f);
    const source = await readFile(filepath, 'utf-8');
    const fm = parseFrontmatterBlock(source);
    if (!fm) {
      console.log(`  [skip] ${f}: no frontmatter`);
      continue;
    }
    if (readTopLevelField(fm.body, 'excludeFromSyndication') === 'true') {
      console.log(`  [skip] ${f}: excludeFromSyndication`);
      continue;
    }

    const coverFile = resolve(COVERS_DIR, `${meta.slug}.${meta.lang}.cover.png`);
    const coverUrl = `/images/posts/${meta.slug}.${meta.lang}.cover.png`;

    const hasExisting = existsSync(coverFile);
    if (!force && hasExisting) {
      // PNG OK、frontmatter の cover line も同期確認だけして次へ
      const { next, updated: changed } = injectCoverLine(source, coverUrl);
      if (changed) {
        await writeFile(filepath, next);
        updated++;
        console.log(`  [fm-update] ${f}: cover path written`);
      } else {
        skipped++;
      }
      continue;
    }

    const title = readTopLevelField(fm.body, 'title');
    if (!title) {
      console.log(`  [skip] ${f}: no title`);
      continue;
    }

    console.log(`  [gen] ${f}: ${title}`);
    const png = await renderCoverPng(title, fonts);
    await writeFile(coverFile, png);
    generated++;

    const { next, updated: changed } = injectCoverLine(source, coverUrl);
    if (changed) {
      await writeFile(filepath, next);
      updated++;
    }
  }

  console.log(
    `[cover-gen] done: ${generated} generated, ${updated} frontmatter updated, ${skipped} skipped`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
