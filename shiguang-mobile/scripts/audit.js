/* 拾光手机版 · 静态自检：id / 图标 / 文件引用是否对得上
   用法： node scripts/audit.js */
'use strict';

const fs = require('fs');
const path = require('path');

const WWW = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www');
const RES = path.join(__dirname, '..', 'app', 'src', 'main', 'res');

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const jsFiles = fs.readdirSync(WWW).filter(f => f.endsWith('.js'));
const cssFiles = fs.readdirSync(WWW).filter(f => f.endsWith('.css'));

let problems = 0;
function bad(msg) { problems++; console.log('  ✗ ' + msg); }

// 面板、搜索、幻灯片里动态插入的 id，不在 index.html 里
const DYNAMIC = new Set(['q-input', 'q-list', 'm-show', 'm-year', 'm-tour', 'm-about', 'm-top',
  'vm-show', 'vm-share', 'vm-hide', 's-dot', 'up-do', 'up-install', 'up-check']);

const ids = new Set();
for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
console.log('index.html: ' + ids.size + ' 个 id');

const used = new Map();
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(WWW, f), 'utf8');
  for (const m of src.matchAll(/\$\(\s*'#([A-Za-z0-9_-]+)'/g)) {
    if (!used.has(m[1])) used.set(m[1], []);
    used.get(m[1]).push(f);
  }
  for (const m of src.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'/g)) {
    if (!used.has(m[1])) used.set(m[1], []);
    used.get(m[1]).push(f);
  }
}
console.log('JS 引用: ' + used.size + ' 个 id');
for (const [id, files] of used) {
  if (DYNAMIC.has(id)) continue;
  if (!ids.has(id)) bad('缺少 id="' + id + '"（' + files.join(',') + '）');
}

// 图标
const iconSrc = fs.readFileSync(path.join(WWW, 'icons.js'), 'utf8');
const start = iconSrc.indexOf('window.ICONS = ') + 'window.ICONS = '.length;
const end = iconSrc.indexOf('window.ICON_ALIAS');
const iconMap = JSON.parse(iconSrc.slice(start, iconSrc.lastIndexOf(';', end)).trim());
const aliasSrc = iconSrc.slice(end);
const alias = JSON.parse(aliasSrc.slice(aliasSrc.indexOf('{'), aliasSrc.indexOf('}') + 1));

const iconClasses = new Set();
for (const m of html.matchAll(/class="ic ([^"]*)"/g)) {
  for (const c of m[1].split(/\s+/)) if (c.startsWith('i-')) iconClasses.add(c.slice(2));
}
for (const f of jsFiles) {
  const src = fs.readFileSync(path.join(WWW, f), 'utf8');
  for (const m of src.matchAll(/iconSvg\('([^']+)'\)/g)) iconClasses.add(m[1]);
}
console.log('图标引用: ' + iconClasses.size + ' 个 / 已定义 ' + Object.keys(iconMap).length + ' 个');
for (const name of iconClasses) {
  const key = alias[name] || name;
  if (!iconMap[key]) bad('图标缺失: ' + name + (alias[name] ? ' → ' + alias[name] : ''));
}

// 静态文件
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const f = m[1];
  if (/^https?:|^data:/.test(f)) continue;
  if (!fs.existsSync(path.join(WWW, f))) bad('文件缺失: ' + f);
}

// 关键样式
const css = cssFiles.map(f => fs.readFileSync(path.join(WWW, f), 'utf8')).join('\n');
const mustHave = ['.tile', '.grid', '.tl-block', '.tl-g', '.v-item', '.s-layer',
  '.s-cap', '.dock-play', '.sheet', '.tour-inner', '.ycard', '.li', '.chip', '.tl-rail'];
for (const c of mustHave) {
  if (!new RegExp('\\' + c.replace('.', '.') + '\\s*[,{]').test(css)) bad('CSS 缺少样式: ' + c);
}

// 原生桥
const java = fs.readFileSync(path.join(__dirname, '..', 'app', 'src', 'main', 'java', 'com', 'shiguang', 'app', 'MainActivity.java'), 'utf8');
const nativeJs = fs.readFileSync(path.join(WWW, 'native.js'), 'utf8');
const bridgeMethods = new Set([...java.matchAll(/@JavascriptInterface[\s\S]{0,90}?\s(\w+)\(/g)].map(m => m[1]));
const called = new Set([...nativeJs.matchAll(/call\('(\w+)'/g)].map(m => m[1]));
console.log('原生桥: ' + bridgeMethods.size + ' 个方法 / JS 调用 ' + called.size + ' 个');
for (const c of called) if (!bridgeMethods.has(c)) bad('native.js 调用了不存在的桥方法: ' + c);

// 资源
for (const f of ['mipmap-mdpi/ic_launcher.png', 'mipmap-xxxhdpi/ic_launcher_foreground.png',
  'mipmap-anydpi-v26/ic_launcher.xml', 'values/strings.xml', 'values/styles.xml', 'values/colors.xml']) {
  if (!fs.existsSync(path.join(RES, f))) bad('资源缺失: res/' + f);
}
const musicDir = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'music');
const music = fs.readdirSync(musicDir);
if (!music.some(f => f.endsWith('.m4a'))) bad('没有内置音乐文件');
if (!music.includes('tracks.txt')) bad('缺少 music/tracks.txt');
if (music.some(f => /[^\x00-\x7F]/.test(f))) bad('music 目录里有非 ASCII 文件名（打包后可能读不到）');

console.log('');
console.log(problems === 0 ? 'PASS · 没有发现缺失或错配' : 'FAIL · ' + problems + ' 个问题');
process.exit(problems === 0 ? 0 : 1);
