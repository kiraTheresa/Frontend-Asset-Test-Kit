#!/usr/bin/env node
'use strict';

/**
 * Frontend Asset Test Kit —— 素材生成器
 *
 * 用法:
 *   npm run generate
 *   node generator/index.js [--theme default|dark|colorful|all]
 *                           [--category avatar,icon,...] [--format png|svg|both]
 *                           [--out <dir>] [--seed <n>]
 *
 * 产物命名: {category}-{width}x{height}.{format}
 * 目录结构: <out>/<theme>/<category>/
 * colorful 主题会额外写入 <out>/colorful/manifest.json（每个文件的配色方案）
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const presets = require('../config/presets');
const palette = require('../config/palette');
const { THEMES } = require('./themes');
const { createVariant } = require('./variants');
const { buildSvg } = require('./layout');

const KIT_ROOT = path.join(__dirname, '..');
const THEME_ORDER = ['default', 'dark', 'colorful'];

function printUsage() {
  console.log(`用法: node generator/index.js [选项]

选项:
  --theme <name>     主题: default | dark | colorful | all（默认 all，支持逗号分隔多个）
  --category <list>  类别: 逗号分隔，如 avatar,icon（默认全部）
  --format <fmt>     输出格式: png | svg | both（默认 png）
  --out <dir>        输出根目录（默认 <kit>/output）
  --seed <n>         colorful 主题随机种子（默认 ${palette.defaultSeed}）
  -h, --help         显示本帮助`);
}

function parseArgs(argv) {
  const opts = {
    theme: 'all',
    categories: null,
    format: 'png',
    out: path.join(KIT_ROOT, 'output'),
    seed: palette.defaultSeed,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
    else if (a === '--theme') opts.theme = argv[++i];
    else if (a === '--category') opts.categories = argv[++i];
    else if (a === '--format') opts.format = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--seed') {
      const s = Number(argv[++i]);
      if (!Number.isFinite(s)) { console.error(`无效的 seed: ${argv[i]}`); process.exit(1); }
      opts.seed = s;
    }
    else { console.error(`未知参数: ${a}`); printUsage(); process.exit(1); }
  }
  return opts;
}

/** 固定主题（default / dark）生成 */
async function generateFixed(themeName, opts, categories) {
  const theme = THEMES[themeName];
  console.log(`\n主题: ${themeName}（${theme.label}）`);
  let total = 0;
  for (const category of categories) {
    const outDir = path.join(opts.out, themeName, category);
    fs.mkdirSync(outDir, { recursive: true });
    let count = 0;
    for (const [w, h] of presets[category]) {
      const svg = buildSvg(w, h, theme);
      const base = `${category}-${w}x${h}`;
      if (opts.format === 'svg' || opts.format === 'both') {
        fs.writeFileSync(path.join(outDir, `${base}.svg`), svg, 'utf8');
        count++;
      }
      if (opts.format === 'png' || opts.format === 'both') {
        await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(outDir, `${base}.png`));
        count++;
      }
    }
    total += count;
    console.log(`  ${category.padEnd(12)} ${String(count).padStart(3)} 个文件（${presets[category].length} 个尺寸）`);
  }
  return total;
}

/** colorful 主题生成：每个文件一个随机（可复现）配色变体，并写入 manifest */
async function generateColorful(opts, categories) {
  console.log(`\n主题: colorful（随机纯色 / 渐变背景，seed=${opts.seed}，短边<=${palette.smallLimit} 使用纯色）`);
  const manifest = {
    seed: opts.seed,
    gradientRatio: palette.gradientRatio,
    smallLimit: palette.smallLimit,
    files: {},
  };
  let total = 0;
  const colorfulRoot = path.join(opts.out, 'colorful');
  fs.mkdirSync(colorfulRoot, { recursive: true });
  for (const category of categories) {
    const outDir = path.join(colorfulRoot, category);
    fs.mkdirSync(outDir, { recursive: true });
    let count = 0;
    for (const [w, h] of presets[category]) {
      const base = `${category}-${w}x${h}`;
      const { theme, meta } = createVariant(base, w, h, palette, opts.seed);
      const svg = buildSvg(w, h, theme);
      if (opts.format === 'svg' || opts.format === 'both') {
        fs.writeFileSync(path.join(outDir, `${base}.svg`), svg, 'utf8');
        manifest.files[`${category}/${base}.svg`] = meta;
        count++;
      }
      if (opts.format === 'png' || opts.format === 'both') {
        await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(outDir, `${base}.png`));
        manifest.files[`${category}/${base}.png`] = meta;
        count++;
      }
    }
    total += count;
    console.log(`  ${category.padEnd(12)} ${String(count).padStart(3)} 个文件（${presets[category].length} 个尺寸）`);
  }
  fs.writeFileSync(path.join(colorfulRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return total;
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));

  const themeNames = opts.theme === 'all'
    ? THEME_ORDER
    : opts.theme.split(',').map((s) => s.trim()).filter(Boolean);
  for (const t of themeNames) {
    if (t !== 'colorful' && !THEMES[t]) {
      console.error(`未知主题: ${t}（可选: ${THEME_ORDER.join(' | ')}）`);
      process.exit(1);
    }
  }

  const categories = opts.categories
    ? opts.categories.split(',').map((s) => s.trim()).filter(Boolean)
    : Object.keys(presets);
  for (const c of categories) {
    if (!presets[c]) { console.error(`未知类别: ${c}（可选: ${Object.keys(presets).join(', ')}）`); process.exit(1); }
  }

  if (!['png', 'svg', 'both'].includes(opts.format)) {
    console.error(`未知格式: ${opts.format}（可选: png | svg | both）`); process.exit(1);
  }

  const t0 = Date.now();
  let total = 0;

  for (const themeName of themeNames) {
    total += themeName === 'colorful'
      ? await generateColorful(opts, categories)
      : await generateFixed(themeName, opts, categories);
  }

  console.log(`\n完成: 共生成 ${total} 个文件，输出目录: ${opts.out}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})().catch((err) => {
  console.error('生成失败:', err);
  process.exit(1);
});
