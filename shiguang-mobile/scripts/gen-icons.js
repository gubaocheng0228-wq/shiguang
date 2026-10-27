// 浠庢闈㈢増 icons.js 鎶藉彇鎵嬫満鐗堥渶瑕佺殑涓€濂楀浘鏍囷紝琛ヤ笂缂虹殑鍑犱釜锛岃緭鍑?assets/www/icons.js
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'shiguang', 'renderer', 'icons.js');
const dst = path.join(__dirname, '..', 'app', 'src', 'main', 'assets', 'www', 'icons.js');

const txt = fs.readFileSync(src, 'utf8');
const jsonStart = txt.indexOf('{');
const jsonEnd = txt.lastIndexOf('}');
const all = JSON.parse(txt.slice(jsonStart, jsonEnd + 1));

const want = [
  'search', 'play', 'chevron-left', 'chevron-right', 'x', 'heart', 'info', 'trash',
  'refresh-cw', 'calendar-days', 'images', 'clock', 'sparkles', 'settings', 'shuffle',
  'check', 'image', 'video', 'download', 'folder-open', 'disc-album', 'star', 'plus',
  'hard-drive', 'crop', 'maximize-2', 'undo-2', 'external-link', 'users'
];

const S = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const extra = {
  home: S('<path d="M3.5 10.6 12 3.5l8.5 7.1"/><path d="M5.6 9.4V20a.9.9 0 0 0 .9.9h11a.9.9 0 0 0 .9-.9V9.4"/><path d="M9.6 20.9v-5.3h4.8v5.3"/>'),
  more: S('<circle cx="12" cy="5" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.35" fill="currentColor" stroke="none"/>'),
  share: S('<path d="M12 15.5V3.2"/><path d="m7.8 7.4 4.2-4.2 4.2 4.2"/><path d="M5.2 12.4v7a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2v-7"/>'),
  'eye-off': S('<path d="m2.2 2.2 19.6 19.6"/><path d="M6.6 6.6C4.5 8 2.9 10 2 12c2 4 6 7.2 10 7.2 1.7 0 3.4-.5 4.9-1.3"/><path d="M18 18c1.8-1.3 3.1-3.5 4-6-2-4-6-7.2-10-7.2-1 0-2 .1-2.9.4"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  'volume': S('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8"/><path d="M18.2 5.8a8.6 8.6 0 0 1 0 12.4"/>'),
  'volume-x': S('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="m16 9.5 4.5 5"/><path d="m20.5 9.5-4.5 5"/>'),
  'pause': S('<rect x="6.5" y="4" width="4" height="16" rx="1.2"/><rect x="13.5" y="4" width="4" height="16" rx="1.2"/>'),
  'arrow-down': S('<path d="M12 4v15"/><path d="m5.5 12.5 6.5 6.5 6.5-6.5"/>'),
  'smartphone': S('<rect x="6" y="2" width="12" height="20" rx="2.6"/><path d="M10.6 18.6h2.8"/>'),
  'shield': S('<path d="M12 3.2 20 6v6c0 5-3.4 8-8 8.8C7.4 20 4 17 4 12V6z"/><path d="m9.2 12.2 2 2 3.6-3.8"/>'),
  'music': S('<circle cx="7.5" cy="18" r="2.6"/><circle cx="18" cy="15.5" r="2.6"/><path d="M10.1 18V6.6l10.5-2.1v11"/>')
};

const out = {};
for (const k of want) if (all[k]) out[k] = all[k];
for (const k in extra) out[k] = extra[k];

// 缁熶竴鎻忚竟绮楃粏锛屽拰妗岄潰鐗堣瑙変竴鑷?for (const k in out) out[k] = out[k].replace(/stroke-width="2"/g, 'stroke-width="1.8"');

const alias = {
  cal: 'calendar-days', gear: 'settings', left: 'chevron-left', right: 'chevron-right',
  eyeoff: 'eye-off', refresh: 'refresh-cw', album: 'disc-album', mute: 'volume-x'
};

const body = `/* 鎷惧厜 鎵嬫満鐗堝浘鏍囷紙lucide锛孖SC License锛夛紝鐢辨闈㈢増鎶藉彇 + 琛ュ厖 */
window.ICONS = ${JSON.stringify(out, null, 0)};
window.ICON_ALIAS = ${JSON.stringify(alias)};
window.iconSvg = function (name) {
  if (!name) return '';
  const k = window.ICON_ALIAS[name] || name;
  return window.ICONS[k] || '';
};
window.hydrateIcons = function (root) {
  (root || document).querySelectorAll('.ic').forEach(function (el) {
    if (el.firstChild) return;
    const cls = Array.prototype.slice.call(el.classList);
    let name = null;
    for (let i = 0; i < cls.length; i++) {
      if (cls[i].indexOf('i-') === 0 && cls[i].length > 2) { name = cls[i].slice(2); break; }
    }
    if (!name) return;
    const svg = window.iconSvg(name);
    if (svg) el.innerHTML = svg;
  });
};
`;

fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, body, 'utf8');
console.log('icons:', Object.keys(out).length, 'written', dst, fs.statSync(dst).size, 'bytes');
console.log('missing from source:', want.filter(k => !all[k]).join(',') || 'none');
