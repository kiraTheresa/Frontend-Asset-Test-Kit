#!/usr/bin/env node
'use strict';

/**
 * Frontend Asset Test Kit —— 素材 Gallery 构建器
 *
 * 用法:
 *   npm run gallery
 *   node tools/build-gallery.mjs [--preset full|curated] [--out <dir>]
 *
 * 扫描 output/ 下三个主题的全部素材，生成自包含的 gallery/index.html
 * （内联 CSS/JS；图片走相对路径 ../output/ 直引原图，不复制文件）。
 *
 * - preset full:    全部素材
 * - preset curated: 每类别取代表尺寸（首尾各一张），控制预览体积
 * - colorful 主题的 manifest.json 在构建时内联进页面，预览无需网络请求
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = path.join(KIT_ROOT, 'output');
const GALLERY_DIR = path.join(KIT_ROOT, 'gallery');
const THEMES = [
  { key: 'default', label: 'Default（浅色）' },
  { key: 'dark', label: 'Dark（深色）' },
  { key: 'colorful', label: 'Colorful（随机配色）' },
];
const CATEGORY_ORDER = ['avatar', 'background', 'banner', 'thumbnail', 'card', 'cover', 'poster', 'icon', 'test'];

function parseArgs(argv) {
  const opts = { preset: 'full', out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--preset') opts.preset = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else { console.error(`未知参数: ${a}`); process.exit(1); }
  }
  if (!['full', 'curated'].includes(opts.preset)) {
    console.error(`无效 preset: ${opts.preset}（full | curated）`);
    process.exit(1);
  }
  return opts;
}

/** 扫描 output/<theme>/<category>/*.png，返回 { themeKey: { category: [file, ...] } } */
function scanAssets(outDir) {
  const assets = {};
  for (const theme of THEMES) {
    const themeDir = path.join(outDir, theme.key);
    if (!fs.existsSync(themeDir)) continue;
    assets[theme.key] = {};
    for (const entry of fs.readdirSync(themeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const files = fs.readdirSync(path.join(themeDir, entry.name))
        .filter((f) => f.endsWith('.png'))
        .sort();
      if (files.length) assets[theme.key][entry.name] = files;
    }
  }
  return assets;
}

/** curated 模式：每类别取代表（第一张 + 最后一张，去重） */
function curate(files) {
  if (files.length <= 2) return files;
  return [files[0], files[files.length - 1]];
}

/** 目录字节总量（递归） */
function dirSizeBytes(dir) {
  let bytes = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    bytes += entry.isDirectory() ? dirSizeBytes(p) : fs.statSync(p).size;
  }
  return bytes;
}

/** 文件大小统计（MB），用于部署体积评估 */
function dirSizeMb(dir) {
  return dirSizeBytes(dir) / (1024 * 1024);
}

function renderCards(themeKey, category, files) {
  return files.map((f) => {
    const src = `../output/${themeKey}/${category}/${f}`;
    const stem = f.replace(/\.png$/, '');
    const dash = stem.lastIndexOf('-');
    const size = stem.slice(dash + 1);
    const [w, h] = size.split('x');
    return `      <figure class="card">
        <img src="${src}" alt="${f}" loading="lazy">
        <figcaption><span class="dim">${w} × ${h}</span><span class="fn">${f}</span></figcaption>
      </figure>`;
  }).join('\n');
}

function renderThemeSection(theme, assets, colorfulMeta) {
  const categories = Object.keys(assets[theme.key] || {})
    .sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  const sections = categories.map((cat) => {
    const files = assets[theme.key][cat];
    return `    <section class="cat" data-theme="${theme.key}">
      <h3>${cat} <small>${files.length} 张</small></h3>
      <div class="grid">
${renderCards(theme.key, cat, files)}
      </div>
    </section>`;
  }).join('\n');

  const metaNote = theme.key === 'colorful' && colorfulMeta
    ? `    <p class="meta" data-theme="colorful">colorful 配色由 seed=<code>${colorfulMeta.seed}</code> 复现，渐变比例 ${colorfulMeta.gradientRatio}，manifest 已内联本页。</p>`
    : '';

  return `${sections}\n${metaNote}`;
}

function buildHtml(assets, colorfulMeta, preset, outDir) {
  const tabs = THEMES.map((t, i) =>
    `      <button class="tab${i === 0 ? ' active' : ''}" data-tab="${t.key}">${t.label}</button>`).join('\n');
  const bodies = THEMES.map((t) => {
    const shown = {};
    for (const [cat, files] of Object.entries(assets[t.key] || {})) {
      shown[cat] = preset === 'curated' ? curate(files) : files;
    }
    return renderThemeSection(t, { [t.key]: shown }, colorfulMeta);
  }).join('\n');

  const total = Object.values(assets).flatMap((th) => Object.values(th)).flat().length;
  const shownCount = preset === 'curated'
    ? Object.values(assets).flatMap((th) => Object.values(th)).flatMap((f) => curate(f)).length
    : total;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Frontend Asset Test Kit — Gallery</title>
<style>
  :root { --bg:#0f1115; --fg:#e8e8ea; --muted:#9aa0a6; --card:#181b21; --border:#2a2f3a; --accent:#4f8cff; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.6 system-ui,"Segoe UI",sans-serif; background:var(--bg); color:var(--fg); }
  header { padding:28px 24px 12px; max-width:1280px; margin:0 auto; }
  h1 { margin:0 0 4px; font-size:22px; }
  header p { margin:0; color:var(--muted); font-size:13px; }
  nav { position:sticky; top:0; z-index:5; background:rgba(15,17,21,.94); border-bottom:1px solid var(--border);
        backdrop-filter:blur(6px); padding:10px 24px; max-width:1280px; margin:0 auto; display:flex; gap:8px; flex-wrap:wrap; }
  .tab { background:transparent; color:var(--muted); border:1px solid var(--border); border-radius:999px;
         padding:5px 14px; cursor:pointer; font-size:13px; }
  .tab:hover { color:var(--fg); }
  .tab.active { background:var(--accent); border-color:var(--accent); color:#fff; }
  main { max-width:1280px; margin:0 auto; padding:8px 24px 64px; }
  .cat h3 { margin:28px 0 12px; font-size:15px; text-transform:capitalize; }
  .cat h3 small { color:var(--muted); font-weight:400; margin-left:6px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; }
  .card { margin:0; background:var(--card); border:1px solid var(--border); border-radius:10px; overflow:hidden;
          display:flex; flex-direction:column; }
  .card img { display:block; width:100%; height:140px; object-fit:contain; background:
              repeating-conic-gradient(#1a1e26 0 25%, #14171e 0 50%) 0 0/16px 16px; }
  figcaption { display:flex; justify-content:space-between; gap:8px; padding:8px 10px; font-size:11px; color:var(--muted); }
  figcaption .fn { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; direction:rtl; }
  .meta { color:var(--muted); font-size:12px; margin:20px 0; }
  .meta code { color:var(--accent); }
  footer { max-width:1280px; margin:0 auto; padding:16px 24px 40px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<header>
  <h1>Frontend Asset Test Kit — Gallery</h1>
  <p>素材预览 · ${preset} 模式，展示 ${shownCount} / 共 ${total} 张 · 图片直引 output/ 原图（${dirSizeMb(outDir).toFixed(1)} MB）</p>
</header>
<nav>
${tabs}
</nav>
<main>
${bodies}
</main>
<footer>由 tools/build-gallery.mjs 生成，素材由 npm run generate 参数化生成。重新生成本页：<code>npm run gallery</code></footer>
<script>
  (function () {
    var tabs = document.querySelectorAll('.tab');
    function activate(key) {
      tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.tab === key); });
      document.querySelectorAll('[data-theme]').forEach(function (el) {
        el.style.display = el.dataset.theme === key ? '' : 'none';
      });
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { activate(t.dataset.tab); }); });
    activate('default');
  })();
</script>
</body>
</html>
`;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.out)) {
    console.error(`输出目录不存在: ${opts.out}（先运行 npm run generate）`);
    process.exit(1);
  }
  const assets = scanAssets(opts.out);
  const themesFound = Object.keys(assets);
  if (!themesFound.length) {
    console.error(`未在 ${opts.out} 找到任何主题素材（先运行 npm run generate）`);
    process.exit(1);
  }

  let colorfulMeta = null;
  const manifestPath = path.join(opts.out, 'colorful', 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    colorfulMeta = { seed: m.seed, gradientRatio: m.gradientRatio };
  }

  const html = buildHtml(assets, colorfulMeta, opts.preset, opts.out);
  fs.mkdirSync(GALLERY_DIR, { recursive: true });
  const outFile = path.join(GALLERY_DIR, 'index.html');
  fs.writeFileSync(outFile, html, 'utf8');

  const shownCount = Object.values(assets).flatMap((th) => Object.values(th))
    .flatMap((f) => (opts.preset === 'curated' ? curate(f) : f)).length;
  console.log(`gallery 已生成: ${outFile}`);
  console.log(`  模式: ${opts.preset}（展示 ${shownCount} 张，直引原图不复制）`);
  console.log(`  output 体积: ${dirSizeMb(opts.out).toFixed(1)} MB（部署体积参考）`);
}

main();
