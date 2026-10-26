'use strict';
/** 生成应用图标：build/icon.png + build/拾光.ico（PNG-in-ICO） */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const buildDir = path.join(root, 'build');
fs.mkdirSync(buildDir, { recursive: true });

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#141827"/><stop offset="1" stop-color="#05070c"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.44" r="0.6">
      <stop offset="0" stop-color="#e0b26a" stop-opacity="0.45"/><stop offset="1" stop-color="#e0b26a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f5e2b8"/><stop offset="1" stop-color="#c9974f"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <rect width="512" height="512" rx="112" fill="url(#glow)"/>
  <circle cx="120" cy="120" r="4" fill="#dfe6ff" opacity="0.8"/>
  <circle cx="404" cy="348" r="3" fill="#fff4e0" opacity="0.6"/>
  <circle cx="96" cy="300" r="2.5" fill="#fff" opacity="0.5"/>
  <circle cx="360" cy="96" r="2.5" fill="#fff" opacity="0.7"/>
  <path d="M256 86 C268 196 316 244 426 256 C316 268 268 316 256 426 C244 316 196 268 86 256 C196 244 244 196 256 86 Z" fill="url(#gold)"/>
  <path d="M392 96 C398 130 416 148 450 154 C416 160 398 178 392 212 C386 178 368 160 334 154 C368 148 386 130 392 96 Z" fill="#f5e2b8" opacity="0.9"/>
</svg>`;

async function main() {
  const png512 = await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);

  // 多尺寸 ICO（PNG-in-ICO，16–256px，小尺寸下不再发糊）
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    pngs.push(await sharp(png512).resize(s, s).png().toBuffer());
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);              // reserved
  header.writeUInt16LE(1, 2);              // type: icon
  header.writeUInt16LE(sizes.length, 4);   // count
  const entries = [];
  const datas = [];
  let offset = 6 + 16 * sizes.length;
  pngs.forEach((buf, i) => {
    const s = sizes[i];
    const entry = Buffer.alloc(16);
    entry[0] = s >= 256 ? 0 : s;
    entry[1] = s >= 256 ? 0 : s;
    entry[2] = 0; entry[3] = 0;
    entry.writeUInt16LE(1, 4);             // planes
    entry.writeUInt16LE(32, 6);            // bpp
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(entry);
    datas.push(buf);
  });
  const ico = Buffer.concat([header, ...entries, ...datas]);
  fs.writeFileSync(path.join(buildDir, '拾光.ico'), ico);
  console.log(`图标已生成: build/icon.png + build/拾光.ico（${sizes.join('/')}px）`);
}
main().catch(e => { console.error(e); process.exit(1); });
