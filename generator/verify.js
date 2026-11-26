#!/usr/bin/env node
'use strict';

/**
 * 素材验收脚本：逐张检查生成的 PNG。
 *
 * default / dark（固定主题）:
 *   1. 文件存在、格式为 PNG、尺寸与文件名一致
 *   2. 四角背景色正确
 *   3. 边框存在（顶边、避开十字线与文字的取样点）
 *   4. 中心十字辅助线存在
 *   5. 尺寸文字确实渲染（防止字体缺失导致静默失败）
 *   6. RGB + K 四个方块的位置与颜色精确
 *
 * colorful（随机变体主题，依据 manifest.json 的配色条目）:
 *   1. 文件存在、格式为 PNG、尺寸与文件名一致、manifest 有条目
 *   2. 背景：纯色（四角命中）或渐变（padding 区四角存在足够色彩多样性）
 *   3. 双层对比边框存在（与边框外侧背景像素对比）
 *   4. 中心十字辅助线存在
 *   5. 尺寸文字确实渲染（统计接近 elem / anti 双色的像素）
 *   6. RGB + K 四个方块的位置与颜色精确
 *
 * 布局坐标复用 layout.js 的 computeMetrics，
 * 保证“画出来的”与“验收的”是同一套坐标。
 *
 * 用法: node generator/verify.js [--out <dir>] [--theme default|dark|colorful|all] [--category avatar,...]
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const presets = require('../config/presets');
const { THEMES, SQUARES } = require('./themes');
const { computeMetrics } = require('./layout');

const KIT_ROOT = path.join(__dirname, '..');
const THEME_ORDER = ['default', 'dark', 'colorful'];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function parseArgs(argv) {
  const opts = { out: path.join(KIT_ROOT, 'output'), theme: 'all', category: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i];
    else if (a === '--theme') opts.theme = argv[++i];
    else if (a === '--category') opts.category = argv[++i];
    else { console.error(`未知参数: ${a}`); process.exit(1); }
  }
  return opts;
}

function px(data, info, x, y) {
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

function dist(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

const r = Math.round;

/** 通用：纯色背景检查（边框内侧内容区两个采样点，避开中央元素与边框吸附区） */
function checkSolidBackground(data, info, m, bgColor, errors) {
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < info.width && y < info.height;
  const pts = [
    [m.padX + 6, m.padY + 6],
    [m.width - m.padX - 7, m.height - m.padY - 7],
  ];
  for (const [x, y] of pts) {
    if (!inBounds(x, y)) continue;
    if (dist(px(data, info, x, y), bgColor) > 8) errors.push(`背景色异常于 (${x},${y})，应为 ${bgColor.join(',')}`);
  }
}

/** 通用：中心十字辅助线存在（在左侧 / 顶部内容区取样，避开边框吸附、中央文字与方块） */
function checkCrosshair(data, info, m, errors) {
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < info.width && y < info.height;
  const cxLine = r(m.cx);
  const cyLine = r(m.cy);
  const probeX = m.padX + 5;
  const probeY = m.padY + 5;

  // 水平线：固定 x，对比线位置与上下背景像素
  let hFound = false;
  for (let e = -1; e <= 1 && !hFound; e++) {
    const onY = cyLine + e;
    if (!inBounds(probeX, onY)) continue;
    const on = px(data, info, probeX, onY);
    for (const d of [-5, -4, -3, 3, 4, 5]) {
      const offY = cyLine + d;
      if (inBounds(probeX, offY) && dist(on, px(data, info, probeX, offY)) >= 25) { hFound = true; break; }
    }
  }
  if (!hFound) errors.push('水平辅助线缺失');

  // 垂直线：固定 y，对比线位置与左右背景像素
  let vFound = false;
  for (let e = -1; e <= 1 && !vFound; e++) {
    const onX = cxLine + e;
    if (!inBounds(onX, probeY)) continue;
    const on = px(data, info, onX, probeY);
    for (const d of [-5, -4, -3, 3, 4, 5]) {
      const offX = cxLine + d;
      if (inBounds(offX, probeY) && dist(on, px(data, info, offX, probeY)) >= 25) { vFound = true; break; }
    }
  }
  if (!vFound) errors.push('垂直辅助线缺失');
}

/** 通用：格式与尺寸检查 */
async function checkFormatAndSize(file, w, h) {
  const errors = [];
  const meta = await sharp(file).metadata();
  if (meta.format !== 'png') errors.push(`格式不是 PNG: ${meta.format}`);
  if (meta.width !== w || meta.height !== h) errors.push(`尺寸不符: ${meta.width}x${meta.height}`);
  return errors;
}

/** 通用：方块位置与颜色（取样方块中心，避开描边） */
function checkSquares(data, info, m, w, h, errors) {
  if (!m.showSquares) return;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < info.width && y < info.height;
  SQUARES.forEach((s, i) => {
    const scx = m.squaresX + i * (m.squareSize + m.squareGap) + Math.floor(m.squareSize / 2);
    const scy = m.squaresY + Math.floor(m.squareSize / 2);
    if (!inBounds(scx, scy) || dist(px(data, info, scx, scy), hexToRgb(s.color)) > 16) {
      errors.push(`方块 ${s.key} 颜色/位置异常`);
    }
  });
}

/** default / dark：固定主题验收 */
async function verifyFixed(file, themeName, w, h) {
  const errors = [];
  if (!fs.existsSync(file)) return ['文件不存在'];
  errors.push(...await checkFormatAndSize(file, w, h));

  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const m = computeMetrics(w, h);
  const bg = hexToRgb(THEMES[themeName].bg.color);
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < info.width && y < info.height;

  // 1. 背景色（左上 / 右下角 3x3 邻域内应存在纯背景像素；
  //    极小尺寸下边框描边可能贴角，因此取“邻域任一命中”而非固定单点）
  for (const [ox, oy] of [[0, 0], [w - 3, h - 3]]) {
    let bgFound = false;
    for (let dy = 0; dy <= 2 && !bgFound; dy++) {
      for (let dx = 0; dx <= 2 && !bgFound; dx++) {
        const x = ox + dx;
        const y = oy + dy;
        if (inBounds(x, y) && dist(px(data, info, x, y), bg) <= 8) bgFound = true;
      }
    }
    if (!bgFound) errors.push(`角落 (${ox},${oy}) 背景色异常`);
  }

  // 2. 边框存在（顶边 1/4 处纵向扫描，避开十字线与文字）
  const bx = m.padX + r((w - 2 * m.padX) * 0.25);
  let borderFound = false;
  for (let dy = -3; dy <= 3 && !borderFound; dy++) {
    const y = m.padY + dy;
    if (inBounds(bx, y) && dist(px(data, info, bx, y), bg) >= 40) borderFound = true;
  }
  if (!borderFound) errors.push('顶边边框缺失');

  // 3. 十字辅助线存在（左边缘中部，位于边框之外）
  let crossFound = false;
  const cyLine = r(m.cy);
  for (let dy = -2; dy <= 2 && !crossFound; dy++) {
    const y = cyLine + dy;
    if (inBounds(1, y) && dist(px(data, info, 1, y), bg) >= 25) crossFound = true;
  }
  if (!crossFound) errors.push('水平辅助线缺失');

  // 4. 尺寸文字确实渲染（统计文字区域内与背景反差大的像素数）
  if (m.showText) {
    let count = 0;
    const x0 = Math.max(0, r(m.cx - m.fontSize * 5));
    const x1 = Math.min(w - 1, r(m.cx + m.fontSize * 5));
    const y0 = Math.max(0, m.textCy - m.fontSize);
    const y1 = Math.min(h - 1, m.textCy + m.fontSize);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (dist(px(data, info, x, y), bg) >= 60) count++;
      }
    }
    if (count < 30) errors.push(`尺寸文字可能未渲染（反差像素 ${count}）`);
  }

  // 5. RGB + K 方块
  checkSquares(data, info, m, w, h, errors);

  return errors;
}

/** colorful：随机变体主题验收（依据 manifest 配色条目） */
async function verifyColorful(file, w, h, meta) {
  const errors = [];
  if (!fs.existsSync(file)) return ['文件不存在'];
  errors.push(...await checkFormatAndSize(file, w, h));
  if (!meta) { errors.push('manifest 中缺少配色条目'); return errors; }

  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const m = computeMetrics(w, h);
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < info.width && y < info.height;

  // 1. 背景
  if (meta.bg.mode === 'solid') {
    checkSolidBackground(data, info, m, hexToRgb(meta.bg.color), errors);
  } else {
    // 渐变：padding 区四角应存在足够色彩多样性（渐变确实存在且两端有区分）
    const pts = [
      [r(m.padX / 2), r(m.padY / 2)],
      [w - 1 - r(m.padX / 2), r(m.padY / 2)],
      [w - 1 - r(m.padX / 2), h - 1 - r(m.padY / 2)],
      [r(m.padX / 2), h - 1 - r(m.padY / 2)],
    ].filter(([x, y]) => inBounds(x, y)).map(([x, y]) => px(data, info, x, y));
    let maxD = 0;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) maxD = Math.max(maxD, dist(pts[i], pts[j]));
    }
    if (maxD < 30) errors.push(`渐变背景多样性不足（最大色差 ${maxD}）`);
  }

  // 2. 双层边框存在（与边框外侧背景像素对比）
  const bx = m.padX + r((w - 2 * m.padX) * 0.25);
  const outsideY = Math.max(0, m.padY - 4);
  if (inBounds(bx, outsideY)) {
    const outside = px(data, info, bx, outsideY);
    let borderFound = false;
    for (let dy = -3; dy <= 3 && !borderFound; dy++) {
      const y = m.padY + dy;
      if (inBounds(bx, y) && dist(px(data, info, bx, y), outside) >= 35) borderFound = true;
    }
    if (!borderFound) errors.push('顶边边框缺失');
  }

  // 3. 十字辅助线存在
  checkCrosshair(data, info, m, errors);

  // 4. 尺寸文字确实渲染（统计接近 elem 填充色或 anti 描边色的像素）
  if (m.showText) {
    const elem = hexToRgb(meta.elem);
    const anti = hexToRgb(meta.anti);
    let count = 0;
    const x0 = Math.max(0, r(m.cx - m.fontSize * 5));
    const x1 = Math.min(w - 1, r(m.cx + m.fontSize * 5));
    const y0 = Math.max(0, m.textCy - m.fontSize);
    const y1 = Math.min(h - 1, m.textCy + m.fontSize);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = px(data, info, x, y);
        if (dist(p, elem) <= 45 || dist(p, anti) <= 45) count++;
      }
    }
    if (count < 30) errors.push(`尺寸文字可能未渲染（命中像素 ${count}）`);
  }

  // 5. RGB + K 方块
  checkSquares(data, info, m, w, h, errors);

  return errors;
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

  const categories = opts.category
    ? opts.category.split(',').map((s) => s.trim()).filter(Boolean)
    : Object.keys(presets);
  for (const c of categories) {
    if (!presets[c]) { console.error(`未知类别: ${c}（可选: ${Object.keys(presets).join(', ')}）`); process.exit(1); }
  }

  // colorful 验收依赖生成时写入的配色清单
  let manifest = null;
  if (themeNames.includes('colorful')) {
    const mf = path.join(opts.out, 'colorful', 'manifest.json');
    if (!fs.existsSync(mf)) {
      console.error(`缺少 colorful 配色清单: ${mf}（请先运行生成器）`);
      process.exit(1);
    }
    manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  }

  let pass = 0;
  let fail = 0;
  for (const themeName of themeNames) {
    for (const category of categories) {
      for (const [w, h] of presets[category]) {
        const file = path.join(opts.out, themeName, category, `${category}-${w}x${h}.png`);
        let errors;
        try {
          errors = themeName === 'colorful'
            ? await verifyColorful(file, w, h, manifest.files[`${category}/${category}-${w}x${h}.png`])
            : await verifyFixed(file, themeName, w, h);
        } catch (e) {
          errors = [`读取失败: ${e.message}`];
        }
        if (errors.length === 0) {
          pass++;
        } else {
          fail++;
          console.error(`✗ ${path.relative(opts.out, file)}`);
          for (const e of errors) console.error(`    - ${e}`);
        }
      }
    }
  }

  console.log(`\n验收完成: ${pass} 通过, ${fail} 失败（输出目录: ${opts.out}）`);
  process.exit(fail > 0 ? 1 : 0);
})();
