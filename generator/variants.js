'use strict';

/**
 * colorful 变体工厂：为每个素材文件生成一个随机（但可复现）的配色方案。
 *
 * 随机源：seed = FNV-1a(baseSeed + 文件标识)，按文件独立派生，
 * 因此增删其他尺寸不会影响已有文件的配色（可复现、可增量）。
 *
 * 规则：
 *   - 短边 <= palette.smallLimit（默认 128）的素材使用纯色背景
 *   - 其余按 palette.gradientRatio 概率随机选择纯色 / 双色渐变（4 个方向随机）
 *   - 渐变两端颜色保证足够的色彩距离（否则重抽）
 *   - 文字 / 边框 / 十字线颜色按背景平均亮度（WCAG）自动选择深色或浅色
 *   - 文字带反色描边、边框为双层对比线、方块为白底黑描边"贴纸"，
 *     保证在任何背景（包括非对比色背景）上都清晰可见
 */

// ---- 可复现随机 ----
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// WCAG 相对亮度（0~1）
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function chebyshev(a, b) {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

const LUM_THRESHOLD = 0.45;    // 背景平均亮度高于该值用深色元素，否则用浅色元素
const MIN_GRADIENT_DIST = 120; // 渐变两端颜色最小切比雪夫距离
const GRADIENT_DIRS = ['h', 'v', 'd1', 'd2'];

/**
 * 生成一个 colorful 主题变体。
 * @param {string} key    文件标识（如 "background-1920x1080"），参与随机种子派生
 * @param {number} width
 * @param {number} height
 * @param {object} palette  config/palette.js 的配置
 * @param {number} [seedOverride] 覆盖默认种子（CLI --seed）
 * @returns {{ theme: object, meta: { bg: object, elem: string, anti: string } }}
 */
function createVariant(key, width, height, palette, seedOverride) {
  const seed = seedOverride === undefined ? palette.defaultSeed : seedOverride;
  const rng = mulberry32(fnv1a(`${seed}:${key}`));
  const pick = () => palette.colors[Math.floor(rng() * palette.colors.length)];

  const small = Math.min(width, height) <= (palette.smallLimit ?? 128);
  const useGradient = !small && rng() < (palette.gradientRatio ?? 0.6);

  const c1 = pick();
  let bg;
  let bgLum;
  if (useGradient) {
    let c2 = pick();
    for (let t = 0; t < 20 && chebyshev(hexToRgb(c1), hexToRgb(c2)) < MIN_GRADIENT_DIST; t++) c2 = pick();
    const dir = GRADIENT_DIRS[Math.floor(rng() * GRADIENT_DIRS.length)];
    bg = { mode: 'gradient', from: c1, to: c2, dir };
    bgLum = (luminance(c1) + luminance(c2)) / 2;
  } else {
    bg = { mode: 'solid', color: c1 };
    bgLum = luminance(c1);
  }

  const light = bgLum > LUM_THRESHOLD;
  const elem = light ? '#1A1A1A' : '#FFFFFF';
  const anti = light ? '#FFFFFF' : '#1A1A1A';

  const theme = {
    label: `colorful（${bg.mode === 'gradient' ? `${bg.from} → ${bg.to}` : bg.color}）`,
    bg,
    text: elem,
    textOutline: anti,       // 文字反色描边：非对比色背景上仍然清晰
    border: elem,
    borderOuter: anti,      // 双层对比边框
    crosshair: elem,
    crosshairOpacity: 1,
    squareStyle: 'sticker', // 测试方块白底黑描边"贴纸"
  };

  return { theme, meta: { bg, elem, anti } };
}

module.exports = { createVariant };
