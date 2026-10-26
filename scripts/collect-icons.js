'use strict';
/** 从 lucide-static 生成 renderer/icons.js（离线图标表） */
const fs = require('fs');
const path = require('path');

const NAMES = [
  'search', 'minus', 'square', 'x', 'sparkles', 'calendar-heart', 'users', 'video',
  'heart', 'star', 'trash', 'settings', 'chevron-left', 'chevron-right', 'shuffle',
  'camera', 'map-pin', 'pencil', 'rotate-ccw', 'rotate-cw', 'folder', 'folder-open',
  'refresh-cw', 'play', 'image', 'images', 'check', 'clock', 'film', 'calendar-days',
  'hard-drive', 'info', 'maximize-2', 'undo-2', 'download', 'external-link', 'inbox',
  'crop', 'sliders-horizontal', 'plus', 'disc-album', 'trash', 'check', 'x', 'pencil',
  'rotate-ccw', 'rotate-cw', 'folder-open', 'refresh-cw', 'calendar-heart',
];

const root = path.join(__dirname, '..');
const nodesPath = path.join(root, 'node_modules', 'lucide-static', 'icon-nodes.json');
const nodes = JSON.parse(fs.readFileSync(nodesPath, 'utf8'));

const out = {};
const missing = [];
for (const name of NAMES) {
  const node = nodes[name];
  if (!node) { missing.push(name); continue; }
  const childList = Array.isArray(node) ? node : (node.children || []);
  const children = childList
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
      return `<${tag} ${a}/>`;
    }).join('');
  out[name] = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}
if (missing.length) {
  console.error('缺少图标: ' + missing.join(', '));
  process.exit(1);
}
const js = '/* 由 scripts/collect-icons.js 生成（lucide 图标，ISC License） */\nwindow.ICONS = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(path.join(root, 'renderer', 'icons.js'), js);
console.log('已生成 ' + Object.keys(out).length + ' 个图标 → renderer/icons.js');
