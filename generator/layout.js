'use strict';

/**
 * 素材视觉模板：所有类别 / 尺寸 / 主题共用同一套参数化布局。
 *
 * 结构（自底向上绘制）：
 *   1. 背景（纯色，或 colorful 变体的双色线性渐变）
 *   2. 中心十字辅助线（细、低视觉权重，贯穿整图）
 *   3. padding 内侧边框（距边缘约 5%；colorful 为双层对比边框）
 *   4. 中央尺寸文字（实际像素值，如 "1920 × 1080"；colorful 带反色描边）
 *   5. RGB + Black 四个严格 1:1 测试方块（colorful 为白底黑描边"贴纸"样式）
 *
 * 短边过小的素材（如 32x32 图标）会自动省略放不下的元素，
 * 保证任意尺寸下模板仍然干净可用。
 */

const { SQUARES } = require('./themes');

// ---- 布局参数（均为相对比例）----
const PADDING_RATIO = 0.05;   // 边缘安全距离：宽 / 高各自 5%
const FONT_RATIO = 0.11;      // 尺寸文字字号：短边的 11%
const SQUARE_RATIO = 0.06;    // 测试方块边长：短边的 6%
const OFFSET_RATIO = 0.09;    // 文字 / 方块中心相对图片中心的偏移：短边的 9%
const MIN_FONT_SIZE = 8;      // 字号低于该值时省略文字（如 64x64）
const MIN_SQUARE_SIZE = 4;    // 方块边长低于该值时省略方块（如 32x32）

// 渐变方向 -> linearGradient 端点（objectBoundingBox 坐标）
const GRADIENT_DIRS = {
  h:  { x1: '0%',   y1: '0%',  x2: '100%', y2: '0%' },
  v:  { x1: '0%',   y1: '0%',  x2: '0%',   y2: '100%' },
  d1: { x1: '0%',   y1: '0%',  x2: '100%', y2: '100%' },
  d2: { x1: '100%', y1: '0%',  x2: '0%',   y2: '100%' },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r = Math.round;

/**
 * 计算某尺寸下的全部布局度量（verify.js 复用同一函数做像素验收，
 * 保证“画出来的”与“验收的”始终是同一套坐标）。
 */
function computeMetrics(width, height) {
  const minDim = Math.min(width, height);
  const cx = width / 2;
  const cy = height / 2;

  const padX = Math.max(2, r(width * PADDING_RATIO));
  const padY = Math.max(2, r(height * PADDING_RATIO));
  const borderWidth = clamp(r(minDim * 0.005), 1, 6);
  const crosshairWidth = clamp(r(minDim * 0.002), 1, 3);

  // 中央文字：实际像素尺寸；字号同时受短边与内容区宽度约束
  const label = `${width} × ${height}`;
  const contentWidth = width - 2 * padX;
  const maxByWidth = (contentWidth * 0.7) / (0.6 * label.length);
  let fontSize = Math.floor(Math.min(minDim * FONT_RATIO, maxByWidth));
  const showText = fontSize >= MIN_FONT_SIZE;
  if (!showText) fontSize = 0;
  const textCy = r(cy - minDim * OFFSET_RATIO);

  // 测试方块：4 个严格 1:1 正方形，水平居中排布
  const squareSize = r(minDim * SQUARE_RATIO);
  const showSquares = squareSize >= MIN_SQUARE_SIZE;
  const squareGap = showSquares ? Math.max(2, r(squareSize * 0.5)) : 0;
  const squaresCy = r(cy + minDim * OFFSET_RATIO);
  const rowWidth = showSquares ? 4 * squareSize + 3 * squareGap : 0;
  const squaresX = r(cx - rowWidth / 2);
  const squaresY = squaresCy - Math.floor(squareSize / 2);

  return {
    width, height, cx, cy, minDim, label,
    padX, padY, borderWidth, crosshairWidth,
    fontSize, showText, textCy,
    squareSize, squareGap, showSquares, squaresCy, squaresX, squaresY, rowWidth,
  };
}

/** 生成素材的 SVG 源（SVG 为唯一生成源，PNG 由 sharp 栅格化导出） */
function buildSvg(width, height, theme) {
  const m = computeMetrics(width, height);
  const L = [];

  L.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);

  // 1. 背景（纯色 / 双色线性渐变）
  if (theme.bg.mode === 'gradient') {
    const d = GRADIENT_DIRS[theme.bg.dir] || GRADIENT_DIRS.d1;
    L.push(`  <defs>`);
    L.push(`    <linearGradient id="kit-bg" x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}">`);
    L.push(`      <stop offset="0%" stop-color="${theme.bg.from}"/>`);
    L.push(`      <stop offset="100%" stop-color="${theme.bg.to}"/>`);
    L.push(`    </linearGradient>`);
    L.push(`  </defs>`);
    L.push(`  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#kit-bg)" shape-rendering="crispEdges"/>`);
  } else {
    L.push(`  <rect x="0" y="0" width="${width}" height="${height}" fill="${theme.bg.color}" shape-rendering="crispEdges"/>`);
  }

  // 2. 中心十字辅助线
  const cxLine = r(m.cx);
  const cyLine = r(m.cy);
  L.push(`  <line x1="0" y1="${cyLine}" x2="${width}" y2="${cyLine}" stroke="${theme.crosshair}" stroke-opacity="${theme.crosshairOpacity}" stroke-width="${m.crosshairWidth}" shape-rendering="crispEdges"/>`);
  L.push(`  <line x1="${cxLine}" y1="0" x2="${cxLine}" y2="${height}" stroke="${theme.crosshair}" stroke-opacity="${theme.crosshairOpacity}" stroke-width="${m.crosshairWidth}" shape-rendering="crispEdges"/>`);

  // 3. padding 内侧边框（colorful 双层：反色粗线 + 主色细线，任何背景至少一条可见）
  if (theme.borderOuter) {
    L.push(`  <rect x="${m.padX}" y="${m.padY}" width="${width - 2 * m.padX}" height="${height - 2 * m.padY}" fill="none" stroke="${theme.borderOuter}" stroke-width="${m.borderWidth + 2}" shape-rendering="crispEdges"/>`);
  }
  L.push(`  <rect x="${m.padX}" y="${m.padY}" width="${width - 2 * m.padX}" height="${height - 2 * m.padY}" fill="none" stroke="${theme.border}" stroke-width="${m.borderWidth}" shape-rendering="crispEdges"/>`);

  // 4. 中央尺寸文字（colorful 先画反色描边层，再画填充层）
  if (m.showText) {
    const baselineY = m.textCy + r(m.fontSize * 0.35);
    const common = `x="${m.cx}" y="${baselineY}" font-family="Arial, sans-serif" font-size="${m.fontSize}" font-weight="700"`;
    if (theme.textOutline) {
      const outlineWidth = clamp(r(m.fontSize * 0.1), 1, 6);
      L.push(`  <text ${common} fill="none" stroke="${theme.textOutline}" stroke-width="${outlineWidth}" stroke-linejoin="round" text-anchor="middle">${m.label}</text>`);
    }
    L.push(`  <text ${common} fill="${theme.text}" text-anchor="middle">${m.label}</text>`);
  }

  // 5. RGB + Black 测试方块（颜色恒定不随主题变化）
  if (m.showSquares) {
    if (theme.squareStyle === 'sticker') {
      // 白底 + 黑描边"贴纸"：任何背景（含与方块同色系背景）上都清晰可辨
      const pad = clamp(r(m.squareSize * 0.15), 1, 4);
      SQUARES.forEach((s, i) => {
        const x = m.squaresX + i * (m.squareSize + m.squareGap);
        L.push(`  <rect x="${x - pad}" y="${m.squaresY - pad}" width="${m.squareSize + 2 * pad}" height="${m.squareSize + 2 * pad}" fill="#FFFFFF" stroke="#1A1A1A" stroke-width="1" shape-rendering="crispEdges"/>`);
        L.push(`  <rect x="${x}" y="${m.squaresY}" width="${m.squareSize}" height="${m.squareSize}" fill="${s.color}" shape-rendering="crispEdges"/>`);
      });
    } else {
      // outline：描边仅用于在深色背景上定位黑色方块，不影响方块本身的测试颜色
      const outlineWidth = m.squareSize >= 48 ? 2 : 1;
      SQUARES.forEach((s, i) => {
        const x = m.squaresX + i * (m.squareSize + m.squareGap);
        L.push(`  <rect x="${x}" y="${m.squaresY}" width="${m.squareSize}" height="${m.squareSize}" fill="${s.color}" stroke="${theme.squareOutline}" stroke-width="${outlineWidth}" shape-rendering="crispEdges"/>`);
      });
    }
  }

  L.push('</svg>');
  return L.join('\n');
}

module.exports = { computeMetrics, buildSvg };
