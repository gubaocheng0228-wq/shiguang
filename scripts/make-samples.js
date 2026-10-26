'use strict';
/** 生成示例照片到 D:\照片库\示例照片（可删除）\ —— 用于首次体验，文件时间代表拍摄日期
 *  用法：node scripts/make-samples.js [输出目录]（自测时指向临时库） */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const LIB = 'D:\\照片库';
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(LIB, '示例照片（可删除）');

const W = 1600, H = 1200;

// 几种示例“照片”风格（抽象渐变示意，正式使用时换成你自己的照片）
const styles = {
  duskSea: () => `<rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="1140" cy="680" r="90" fill="#ffe0a8" opacity="0.9"/>
    <circle cx="1140" cy="680" r="150" fill="#ffb464" opacity="0.35"/>
    <rect y="740" width="${W}" height="6" fill="#ffd9a8" opacity="0.5"/>
    <rect y="746" width="${W}" height="${H - 746}" fill="#1a2740" opacity="0.85"/>
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#101d33"/><stop offset="0.45" stop-color="#2c4d78"/>
      <stop offset="0.75" stop-color="#c97a52"/><stop offset="1" stop-color="#f2c187"/>
    </linearGradient></defs>`,
  stars: () => {
    let dots = '';
    const rnd = (i) => ((i * 2654435761) % 1000) / 1000;
    for (let i = 0; i < 90; i++) {
      dots += `<circle cx="${Math.round(rnd(i + 1) * W)}" cy="${Math.round(rnd(i + 99) * H * 0.8)}" r="${(rnd(i + 7) * 2 + 0.6).toFixed(1)}" fill="#fff" opacity="${(rnd(i + 3) * 0.7 + 0.2).toFixed(2)}"/>`;
    }
    return `<rect width="${W}" height="${H}" fill="#060a1c"/>${dots}
      <path d="M0 ${H * 0.82} L${W * 0.3} ${H * 0.55} L${W * 0.55} ${H * 0.78} L${W * 0.75} ${H * 0.6} L${W} ${H * 0.8} L${W} ${H} L0 ${H} Z" fill="#0d1526"/>`;
  },
  forest: () => `<rect width="${W}" height="${H}" fill="url(#g)"/>
    <path d="M0 ${H} L${W * 0.25} ${H * 0.3} L${W * 0.5} ${H} Z" fill="#1c3527" opacity="0.9"/>
    <path d="M${W * 0.35} ${H} L${W * 0.68} ${H * 0.2} L${W} ${H} Z" fill="#122718" opacity="0.95"/>
    <defs><linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#9dbf7a"/><stop offset="1" stop-color="#2f5d3a"/>
    </linearGradient></defs>`,
  food: () => `<rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="330" fill="#f2d4a0" opacity="0.85"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="240" fill="#e8b26a" opacity="0.9"/>
    <circle cx="${W / 2 - 80}" cy="${H / 2 - 60}" r="26" fill="#7a4b2e"/>
    <circle cx="${W / 2 + 90}" cy="${H / 2 + 40}" r="22" fill="#7a4b2e"/>
    <circle cx="${W / 2 - 20}" cy="${H / 2 + 110}" r="20" fill="#6b9e58"/>
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#42210f"/><stop offset="1" stop-color="#a05f28"/>
    </linearGradient></defs>`,
  sea: () => `<rect width="${W}" height="${H * 0.45}" fill="#bfe6e0"/>
    <rect y="${H * 0.45}" width="${W}" height="${H * 0.55}" fill="url(#g)"/>
    <circle cx="320" cy="${H * 0.42}" r="70" fill="#fff" opacity="0.85"/>
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2e7ea0"/><stop offset="1" stop-color="#0d2f4a"/>
    </linearGradient></defs>`,
  flower: () => `<rect width="${W}" height="${H}" fill="url(#g)"/>
    ${[0, 1, 2, 3, 4].map(i => `<circle cx="${800 + Math.cos(i * 1.256) * 180}" cy="${600 + Math.sin(i * 1.256) * 180}" r="95" fill="#f7e6f0" opacity="0.9"/>`).join('')}
    <circle cx="800" cy="600" r="70" fill="#e0b26a"/>
    <defs><linearGradient id="g" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#f2e0ea"/><stop offset="1" stop-color="#8a5470"/>
    </linearGradient></defs>`,
  nightCity: () => `<rect width="${W}" height="${H}" fill="url(#g)"/>
    ${[80, 260, 420, 640, 900, 1120, 1340].map((x, i) => `<rect x="${x}" y="${700 - i % 3 * 90 - 100}" width="${110}" height="${H}" fill="#0b1020" opacity="0.92"/>`).join('')}
    ${Array.from({ length: 60 }, (_, i) => `<rect x="${90 + (i * 137) % 1400}" y="${480 + (i * 83) % 500}" width="14" height="20" fill="#ffd98a" opacity="${0.4 + (i % 5) * 0.12}"/>`).join('')}
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#101d33"/><stop offset="1" stop-color="#3c2b52"/>
    </linearGradient></defs>`,
  moon: () => `<rect width="${W}" height="${H}" fill="#0a0f22"/>
    <circle cx="1150" cy="300" r="130" fill="#f5ecd4"/>
    <circle cx="1100" cy="270" r="18" fill="#e3d8bc"/><circle cx="1190" cy="350" r="12" fill="#e3d8bc"/>
    ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 173) % W}" cy="${(i * 97) % 700}" r="${(i % 3) * 0.8 + 0.8}" fill="#fff" opacity="0.6"/>`).join('')}
    <path d="M0 ${H} L${W * 0.4} ${H * 0.72} L${W * 0.7} ${H * 0.86} L${W} ${H * 0.66} L${W} ${H} Z" fill="#0d1526"/>`,
  sky: () => `<rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="1300" cy="240" r="90" fill="#fff8e0" opacity="0.95"/>
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7fb3d8"/><stop offset="1" stop-color="#dfeaf2"/>
    </linearGradient></defs>`,
  sweet: () => `<rect width="${W}" height="${H}" fill="url(#g)"/>
    <circle cx="800" cy="640" r="200" fill="#f7e6d3"/>
    <circle cx="740" cy="580" r="30" fill="#a86f4e"/><circle cx="880" cy="700" r="26" fill="#a86f4e"/>
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3c1f1a"/><stop offset="1" stop-color="#96503a"/>
    </linearGradient></defs>`,
};

const samples = [
  ['2023-10-25 厦门环岛路的晚霞', '2023-10-25T17:58', 'duskSea'],
  ['2024-10-25 生日面', '2024-10-25T19:20', 'food'],
  ['2025-10-25 妈妈的饺子', '2025-10-25T18:40', 'food'],
  ['2025-10-19 生日快乐', '2025-10-19T21:03', 'flower'],
  ['2025-10-07 夜骑江边', '2025-10-07T22:15', 'nightCity'],
  ['2025-10-02 外婆家的猫', '2025-10-02T15:12', 'forest'],
  ['2026-10-21 晚安，城市', '2026-10-21T23:47', 'nightCity'],
  ['2026-10-18 山里的星空', '2026-10-18T22:30', 'stars'],
  ['2026-10-15 雨后的叶子', '2026-10-15T08:22', 'forest'],
  ['2026-10-12 和妈妈包饺子', '2026-10-12T12:08', 'food'],
  ['2026-10-08 假期最后的海', '2026-10-08T17:05', 'sea'],
  ['2026-10-03 巷子口的花', '2026-10-03T16:40', 'flower'],
  ['2026-10-01 人山人海', '2026-10-01T14:20', 'sky'],
  ['2026-10-01 第一杯热奶茶', '2026-10-01T11:32', 'sweet'],
  ['2026-09-28 加班到凌晨', '2026-09-28T01:15', 'nightCity'],
  ['2026-09-20 中秋的月亮', '2026-09-20T20:50', 'moon'],
  ['2026-09-14 开学第一天', '2026-09-14T07:55', 'sky'],
  ['2026-09-02 最后一支雪糕', '2026-09-02T16:26', 'sweet'],
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, when, style] of samples) {
    const file = path.join(OUT, name + '.jpg');
    if (fs.existsSync(file)) continue;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${styles[style]()}</svg>`;
    await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(file);
    const d = new Date(when);
    fs.utimesSync(file, d, d);
  }
  console.log(`已生成 ${samples.length} 张示例照片 → ${OUT}`);
}
main().catch(e => { console.error(e); process.exit(1); });
