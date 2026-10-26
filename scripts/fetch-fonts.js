'use strict';
/** 下载 Noto Serif SC（简体中文子集 600/700/900）到 renderer/fonts/，实现离线字体 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const fontsDir = path.join(root, 'renderer', 'fonts');
const BASE = 'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.2.5/files/noto-serif-sc-chinese-simplified';
const WEIGHTS = [600, 700, 900];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) { file.close(); fs.unlinkSync(dest); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (e) => { try { file.close(); fs.unlinkSync(dest); } catch (x) { /* 忽略 */ } reject(e); });
  });
}

async function main() {
  fs.mkdirSync(fontsDir, { recursive: true });
  const css = [];
  for (const w of WEIGHTS) {
    const file = `noto-serif-sc-${w}.woff2`;
    const dest = path.join(fontsDir, file);
    if (!fs.existsSync(dest)) {
      process.stdout.write(`下载 ${w}… `);
      await download(`${BASE}-${w}-normal.woff2`, dest);
      console.log(`${(fs.statSync(dest).size / 1048576).toFixed(1)}MB`);
    }
    css.push(`@font-face {
  font-family: "Noto Serif SC";
  font-style: normal;
  font-weight: ${w};
  font-display: swap;
  src: url("fonts/${file}") format("woff2");
}`);
  }
  fs.writeFileSync(path.join(root, 'renderer', 'fonts.css'), css.join('\n') + '\n');
  console.log('字体本地化完成 → renderer/fonts.css');
}

main().catch((e) => { console.error('字体下载失败:', e.message); process.exit(1); });
