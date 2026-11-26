'use strict';

/**
 * 主题定义。
 *
 * 主题只影响背景 / 文字 / 边框 / 辅助线的配色；
 * RGB + K 四色测试块的颜色在任何主题下保持恒定（见 SQUARES），
 * 以保证跨主题具有一致的测试标准。
 *
 * 统一主题 schema（layout.js 按此渲染）：
 *   bg               { mode: 'solid', color } | { mode: 'gradient', from, to, dir }
 *   text             中央尺寸文字颜色
 *   textOutline      文字描边色（null = 不描边）
 *   border           padding 内侧边框颜色
 *   borderOuter      双层边框的外层反色（null = 单层边框）
 *   crosshair        中心十字辅助线颜色
 *   crosshairOpacity 辅助线不透明度
 *   squareStyle      测试方块样式：'outline'（细描边）| 'sticker'（白底黑描边贴纸）
 *   squareOutline    outline 模式的描边色
 *
 * colorful 主题为随机变体（见 generator/variants.js），不在此固定表中。
 */

// 恒定的四色测试块
const SQUARES = [
  { key: 'R', color: '#FF0000' },
  { key: 'G', color: '#00FF00' },
  { key: 'B', color: '#0000FF' },
  { key: 'K', color: '#000000' },
];

const THEMES = {
  default: {
    label: '浅色（适合常规网页）',
    bg: { mode: 'solid', color: '#F2F2F2' },
    text: '#1A1A1A',
    textOutline: null,
    border: '#333333',
    borderOuter: null,
    crosshair: '#333333',
    crosshairOpacity: 0.35,
    squareStyle: 'outline',
    // 测试方块描边：仅用于在深色背景上定位黑色方块，不影响方块本身的测试颜色
    squareOutline: '#5A5A5A',
  },
  dark: {
    label: '深色（适合暗色 UI）',
    bg: { mode: 'solid', color: '#1E1E1E' },
    text: '#F0F0F0',
    textOutline: null,
    border: '#CCCCCC',
    borderOuter: null,
    crosshair: '#CCCCCC',
    crosshairOpacity: 0.35,
    squareStyle: 'outline',
    squareOutline: '#B0B0B0',
  },
};

module.exports = { SQUARES, THEMES };
