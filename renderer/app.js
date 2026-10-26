'use strict';
/* 拾光 · 渲染层逻辑 v3（Justified 等高行布局 / 编辑 / 相册 / 沉浸可调） */

const $ = (id) => document.getElementById(id);
const icon = (name) => (window.ICONS && window.ICONS[name]) || '';

const state = {
  libDir: '', smoke: false, version: '', libAvailable: true,
  ui: { immersive: true, idleMs: 2600 },
  items: [], total: 0, offset: 0, pageSize: 60,
  filter: 'all', q: '', day: null, albumId: null, albumName: '',
  loading: false, done: false, firstLoaded: false, gen: 0,
  lastCount: -1, lastStats: null,
  heroData: null,
};
const viewer = { idx: -1, scale: 1, tx: 0, ty: 0, rot: 0, dragging: false, sx: 0, sy: 0 };
const edit = { on: false, crop: false, cropRect: null, bri: 1, con: 1, sat: 1 };

/* ── 模态框 / 缩略图回填 ── */
const MODAL_IDS = ['settings', 'albums', 'albumpick', 'trash', 'inputdlg'];
function openModalId() {
  for (const id of MODAL_IDS) { const el = $(id); if (el && !el.hidden) return id; }
  return null;
}
function closeTopModal() {
  const id = openModalId();
  if (!id) return false;
  $(id).hidden = true;
  return true;
}
/** 缩略图就绪：就地补背景，不重建列表（视频缩略图是后台生成的，以前永远补不上） */
function patchThumb(id) {
  const item = state.items.find((x) => x.id === id);
  if (item) { item.hasThumb = true; item.broken = false; }
  const tile = tileById(id);
  if (!tile) return;
  const ph = tile.querySelector('.ph');
  if (ph) ph.style.backgroundImage = `url("sg://thumb/${id}?v=${Date.now()}")`;
  tile.classList.remove('nothumb', 'broken');
}

/** 预览不出来的格式（HEIC/TIFF 大图裁剪会算错坐标） */
const NO_CROP_EXTS = ['.heic', '.heif', '.tif', '.tiff'];

/* ── 工具 ── */
function fmtDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}
function fmtFull(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDur(sec) {
  if (!sec || sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtSize(n) {
  if (n > 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  if (n > 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return Math.round(n / 1024) + ' KB';
}
function toast(msg, gold) {
  const t = document.createElement('div');
  t.className = 'toast' + (gold ? ' gold' : '');
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; }, 2200);
  setTimeout(() => t.remove(), 2700);
}
function confirmDlg(title, text, yes) {
  return new Promise((resolve) => {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    $('confirm-yes').textContent = yes || '确定';
    $('confirm').hidden = false;
    setTimeout(() => { try { $('confirm-yes').focus(); } catch (e) { /* 忽略 */ } }, 30);
    const keyFn = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
    };
    const yesFn = () => done(true), noFn = () => done(false);
    function cleanup() {
      $('confirm-yes').removeEventListener('click', yesFn);
      $('confirm-no').removeEventListener('click', noFn);
      document.removeEventListener('keydown', keyFn, true);
    }
    function done(v) { $('confirm').hidden = true; cleanup(); resolve(v); }
    $('confirm-yes').addEventListener('click', yesFn);
    $('confirm-no').addEventListener('click', noFn);
    document.addEventListener('keydown', keyFn, true);
  });
}
/** Electron 不支持 window.prompt，自绘输入框 */
function inputDlg(title, def) {
  return new Promise((resolve) => {
    $('input-title').textContent = title;
    const field = $('input-field');
    field.value = def || '';
    $('inputdlg').hidden = false;
    setTimeout(() => { field.focus(); field.select(); }, 50);
    const okFn = () => done(field.value.trim()), noFn = () => done(null);
    const keyFn = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); okFn(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); noFn(); }
    };
    function cleanup() {
      $('input-ok').removeEventListener('click', okFn);
      $('input-cancel').removeEventListener('click', noFn);
      document.removeEventListener('keydown', keyFn, true);
    }
    function done(v) { $('inputdlg').hidden = true; cleanup(); resolve(v); }
    $('input-ok').addEventListener('click', okFn);
    $('input-cancel').addEventListener('click', noFn);
    document.addEventListener('keydown', keyFn, true);
  });
}

/* ── 图标注入 ── */
function injectIcons() {
  $('ic-search').innerHTML = icon('search');
  $('w-min').innerHTML = icon('minus');
  $('w-max').innerHTML = icon('square');
  $('w-close').innerHTML = icon('x');
  $('ic-hero-go').innerHTML = icon('chevron-right');
  $('ic-hero-shuffle').innerHTML = icon('shuffle');
  $('ic-clock').innerHTML = icon('clock');
  $('ic-empty-folder').innerHTML = icon('folder-open');
  $('ic-empty-refresh').innerHTML = icon('refresh-cw');
  $('ic-set-gear').innerHTML = icon('settings');
  $('ic-set-folder').innerHTML = icon('folder');
  $('ic-set-open').innerHTML = icon('external-link');
  $('ic-set-refresh').innerHTML = icon('refresh-cw');
  $('ic-set-hd').innerHTML = icon('hard-drive');
  $('ic-offline').innerHTML = icon('hard-drive');
  $('ic-alb-disc').innerHTML = icon('disc-album');
  $('ic-trash-bin').innerHTML = icon('trash');
  $('v-prev').innerHTML = icon('chevron-left');
  $('v-next').innerHTML = icon('chevron-right');
  $('v-close').innerHTML = icon('x');
  $('v-fav').innerHTML = icon('heart');
  $('v-star').innerHTML = icon('star');
  $('v-edit').innerHTML = icon('pencil');
  $('v-slideshow').innerHTML = icon('play');
  $('v-album').innerHTML = icon('plus');
  $('v-folder').innerHTML = icon('folder');
  $('v-trash').innerHTML = icon('trash');
  $('v-info').innerHTML = icon('info');
  $('v-zoomout').innerHTML = icon('minus');
  $('v-zoomin').innerHTML = icon('plus');
  $('v-zoomfit').innerHTML = icon('maximize-2');
  $('ip-close').innerHTML = icon('x');
  $('ic-tl-go').innerHTML = icon('chevron-right');
  $('set-close').innerHTML = icon('x');
  $('alb-close').innerHTML = icon('x');
  $('pick-close').innerHTML = icon('x');
  $('trash-close').innerHTML = icon('x');
  document.querySelector('#e-rotl .ic').innerHTML = icon('rotate-ccw');
  $('e-rotr').querySelector('.ic').innerHTML = icon('rotate-cw');
  $('e-crop').querySelector('.ic').innerHTML = icon('crop');
  $('e-reset').querySelector('.ic').innerHTML = icon('undo-2');
  $('vstar').querySelectorAll('button[data-n]').forEach((b) => {
    const n = +b.dataset.n;
    b.textContent = n > 0 ? '★'.repeat(n) : '清除';
    if (n > 0) b.style.fontSize = '11px';
  });
  const navIcons = { home: 'sparkles', onthisday: 'calendar-heart', timeline: 'calendar-days', albums: 'disc-album', fav: 'heart', video: 'video', trash: 'trash', settings: 'settings' };
  document.querySelectorAll('.rail button').forEach((b) => {
    b.innerHTML = icon(navIcons[b.dataset.nav] || 'image');
  });
}

/* ── 问候 ── */
function renderGreet(st) {
  const h = new Date().getHours();
  const hello = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
  $('greet-h').textContent = `${hello}，欢迎回到你的时光长廊`;
  const spanTxt = st.minDate && st.maxDate
    ? `${new Date(st.minDate).getFullYear()} – ${new Date(st.maxDate).getFullYear()}`
    : '';
  // 视频不该被算进"张照片"里，这里按类型分开说
  const bits = [`${st.count.toLocaleString()} 个回忆`];
  if (st.photoCount) bits.push(`照片 ${st.photoCount.toLocaleString()}`);
  if (st.videoCount) bits.push(`视频 ${st.videoCount.toLocaleString()}`);
  if (spanTxt) bits.push(spanTxt);
  bits.push(`收藏 ${st.favCount}`);
  bits.push(`相册 ${st.albumCount || 0}`);
  $('greet-p').textContent = bits.join(' · ');
  $('empty-lib').textContent = `把照片放进「${state.libDir || '照片库'}」，拾光会把它们整理成一条时光长廊。`;
  const isEmpty = st.count === 0;
  $('empty').hidden = !isEmpty;
  $('greet').style.display = isEmpty ? 'none' : '';
  $('chips').style.display = isEmpty ? 'none' : '';
  renderOffline(st);
}

/** 库目录离线（移动硬盘拔了/盘符变了）：只提示，不动索引 */
function renderOffline(st) {
  const off = !!st && st.libAvailable === false;
  state.libAvailable = !off;
  const box = $('offline');
  if (!box) return;
  box.hidden = !off;
  if (off) {
    $('offline-path').textContent =
      `找不到「${st.libDir || '照片库'}」——可能是移动硬盘没插、盘符变了或文件夹被改名。索引、缩略图和收藏都还在，不会丢。`;
  }
}

/* ── 那年今日 ── */
function applyHeroDay(day) {
  const hero = $('hero');
  const bg = day.items.find((i) => i.hasThumb);
  $('hero-img').style.backgroundImage = bg ? `url("${bg.thumbUrl}")` : '';
  const first = day.items[0];
  const yr = new Date(first.dateMs).getFullYear();
  // 以前这个胶囊从没被赋值，hero 左上角一直浮着一个空框
  $('hero-badge').textContent = `✦ ${yr} 年`;
  $('hero-kicker').textContent = `${fmtDate(first.dateMs).replace(/\./g, ' · ')} · ${day.count} 个回忆`;
  $('hero-title').textContent = day.yearsAgo === 1 ? '一年前的今天' : `${day.yearsAgo} 年前的今天`;
  $('hero-sub').textContent = '时间把这一天留了下来，点开看看那时的你们。';
  hero.dataset.day = state.heroData.mmdd;
}

async function renderHero() {
  try {
    const res = await window.sg.invoke('lib:onThisDay');
    state.heroData = res;
    if (!res || !res.days || !res.days.length) { $('hero').hidden = true; return; }
    applyHeroDay(res.days[0]);
    const yearsBox = $('hero-years');
    yearsBox.textContent = '';
    res.days.forEach((d, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${d.year}（${d.count}）`;
      b.classList.toggle('on', i === 0);
      b.addEventListener('click', () => {
        applyHeroDay(d);
        yearsBox.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      yearsBox.appendChild(b);
    });
    yearsBox.hidden = res.days.length < 2;
    $('hero').hidden = false;
  } catch (e) {
    $('hero').hidden = true;
  }
}

/* ── Justified 等高行布局（参考 Google Photos / Flickr） ── */
const ROW_GAP = 10;
function aspectOf(item) {
  if (item.kind === 'video') return 16 / 9;
  if (item.w && item.h) {
    const swap = (item.orientation || 1) >= 5; // EXIF 5-8 为竖向
    return swap ? item.h / item.w : item.w / item.h;
  }
  return 4 / 3;
}
function layoutRows(arr, W) {
  const base = Math.min(250, Math.max(165, W / 6.2)) * (state.ui.gridScale || 1);
  const H = Math.round(Math.min(420, Math.max(110, base)));
  const rows = [];
  let row = [], sum = 0;
  for (const it of arr) {
    const ar = Math.max(0.4, Math.min(3.2, aspectOf(it)));
    row.push({ it, ar });
    sum += ar;
    if (sum * H + ROW_GAP * (row.length - 1) >= W) {
      rows.push({ list: row, h: (W - ROW_GAP * (row.length - 1)) / sum });
      row = []; sum = 0;
    }
  }
  if (row.length) rows.push({ list: row, h: H });
  return rows;
}

function tileEl(item) {
  const fig = document.createElement('figure');
  fig.className = 'tile' + (item.hasThumb ? '' : ' nothumb') + (item.broken ? ' broken' : '');
  fig.dataset.id = item.id;
  const ph = document.createElement('div');
  ph.className = 'ph';
  if (item.hasThumb) ph.style.backgroundImage = `url("${item.thumbUrl}")`;
  fig.appendChild(ph);
  if (!item.hasThumb && !item.broken) {
    const sk = document.createElement('span');
    sk.className = 'skel';
    sk.setAttribute('aria-hidden', 'true');
    fig.appendChild(sk);
  }
  if (item.broken) {
    const b = document.createElement('span');
    b.className = 'brokenbadge';
    b.textContent = '无法预览';
    fig.appendChild(b);
  }
  if (item.kind === 'video') {
    const pb = document.createElement('span');
    pb.className = 'playbadge';
    pb.innerHTML = icon('play');
    fig.appendChild(pb);
    if (item.duration) {
      const dur = document.createElement('span');
      dur.className = 'durbadge';
      dur.textContent = fmtDur(item.duration);
      fig.appendChild(dur);
    }
  }
  const cap = document.createElement('figcaption');
  cap.className = 'cap';
  const d = new Date(item.dateMs);
  cap.innerHTML = `<span>${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}</span><span></span>`;
  cap.children[1].textContent = item.name.replace(/\.[^.]+$/, '');
  fig.appendChild(cap);
  const acts = document.createElement('span');
  acts.className = 'acts';
  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.className = 'act' + (item.fav ? ' on' : '');
  favBtn.setAttribute('aria-label', '收藏');
  favBtn.title = '收藏';
  favBtn.innerHTML = icon('heart');
  favBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      item.fav = await window.sg.invoke('photo:fav', { id: item.id, on: !item.fav });
      favBtn.classList.toggle('on', item.fav);
    } catch (err) { toast('操作失败：' + err.message); }
  });
  const starBtn = document.createElement('button');
  starBtn.type = 'button';
  starBtn.className = 'act' + (item.star ? ' star-on' : '');
  starBtn.setAttribute('aria-label', '评星');
  starBtn.title = item.star ? `${item.star} 星` : '评星（点一次加一星，第 6 下清除）';
  starBtn.innerHTML = icon('star');
  starBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const next = ((item.star || 0) + 1) % 6;
    try {
      item.star = await window.sg.invoke('photo:star', { id: item.id, n: next });
      starBtn.classList.toggle('star-on', !!item.star);
      starBtn.title = item.star ? `${item.star} 星` : '评星';
      toast(item.star ? `已评 ${item.star} 星` : '已清除评分');
    } catch (err) { toast('操作失败：' + err.message); }
  });
  acts.appendChild(favBtn);
  acts.appendChild(starBtn);
  fig.appendChild(acts);
  // 点击时再解析序号，删除/插入后不会错位
  fig.addEventListener('click', () => {
    const i = state.items.indexOf(item);
    if (i >= 0) openViewer(i);
  });
  return fig;
}

function appendJustified(container, arr, baseIndex) {
  const W = container.clientWidth || 800;
  for (const row of layoutRows(arr, W)) {
    const rowEl = document.createElement('div');
    rowEl.className = 'jrow';
    for (const { it, ar } of row.list) {
      const tile = tileEl(it);
      tile.style.width = Math.round(row.h * ar) + 'px';
      tile.style.height = Math.round(row.h) + 'px';
      rowEl.appendChild(tile);
    }
    container.appendChild(rowEl);
  }
}

const MONTHS = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];

/* 增量渲染：只追加新照片，绝不重建已渲染的 DOM（避免滚动位置丢失跳顶） */
let rr = null;
function resetRender() {
  rr = { count: 0, lastY: null, lastM: null, monthItems: null, monthBox: null, monthStart: 0, yearCounts: new Map() };
  tl._tiles = null;              // 整表重建后旧的节点缓存失效
  $('timeline').textContent = '';
}
function flushMonth() {
  if (rr.monthBox && rr.monthItems && rr.monthItems.length) {
    appendJustified(rr.monthBox, rr.monthItems, rr.monthStart);
  }
  rr.monthItems = null;
}
function renderNewItems() {
  if (!rr) resetRender();
  const tl = $('timeline');
  for (let i = rr.count; i < state.items.length; i++) {
    const item = state.items[i];
    const d = new Date(item.dateMs);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    if (y !== rr.lastY) {
      flushMonth();
      rr.lastY = y; rr.lastM = null;
      const yearSec = document.createElement('div');
      yearSec.className = 'year' + (y !== new Date().getFullYear() ? ' dim' : '');
      yearSec.dataset.y = y;
      yearSec.innerHTML = `<div class="yearhead"><h2>${y}</h2><p></p></div>`;
      tl.appendChild(yearSec);
      rr.yearCounts.set(y, { el: yearSec.querySelector('p'), n: 0 });
    }
    if (m !== rr.lastM) {
      flushMonth();
      rr.lastM = m;
      const mSec = document.createElement('div');
      mSec.className = 'month';
      mSec.dataset.y = y; mSec.dataset.m = m;
      mSec.innerHTML = `<h4><i></i>${MONTHS[m - 1]}</h4>`;
      rr.monthBox = document.createElement('div');
      rr.monthBox.className = 'mgrid';
      mSec.appendChild(rr.monthBox);
      tl.lastElementChild.appendChild(mSec);
      rr.monthItems = [];
      rr.monthStart = i;
    } else if (!rr.monthItems) {
      // 同一月份跨页续接：沿用现有月份容器，续开新的待排批次
      rr.monthItems = [];
      rr.monthStart = i;
    }
    rr.monthItems.push(item);
    const yc = rr.yearCounts.get(y);
    yc.n++; yc.el.textContent = `${yc.n} 张`;
  }
  flushMonth();
  rr.count = state.items.length;
}
function renderTimeline() { resetRender(); renderNewItems(); }
function tileById(id) { return document.querySelector(`.tile[data-id="${id}"]`); }
function updateTileFlags(item) {
  const t = tileById(item.id); if (!t) return;
  const acts = t.querySelectorAll('.act');
  if (acts[0]) acts[0].classList.toggle('on', item.fav);
  if (acts[1]) acts[1].classList.toggle('star-on', !!item.star);
}

/* ═════════ 时间轴：回忆密度地图（年 / 月 / 日 三级） ═════════
 * 旧实现是"每天一个 DOM 刻度 + 每帧给全部刻度写 blur"，既不携带信息又会卡。
 * 新实现：一整块 canvas 画密度柱（只画可见范围），拖动即时读数 + 缩略图预览，
 * 松手直接落地（可在设置里关掉），滚轮切换 年/月/日 三级。 */
const tl = {
  open: false, level: 'month', hist: null, slots: [], slotByKey: new Map(),
  dayCount: new Map(), monthCount: new Map(),
  centerData: 0, offset: 0, width: 0, height: 0, dpr: 1, totalW: 0, maxN: 1,
  cMin: 0, cMax: 0, drag: null, pickNow: null, raf: 0, syncGuard: 0, prevSeq: 0,
};
const TL_LEVELS = ['year', 'month', 'day'];
const TL_SLOT_W = { year: 12, month: 56, day: 186 };

async function tlLoadHist(force) {
  if (tl.hist && !force) return tl.hist;
  try { tl.hist = await window.sg.invoke('lib:histogram'); } catch (e) { tl.hist = null; }
  return tl.hist;
}

/** 用直方图生成 月份槽位（x 轴自左向右 = 从早到晚） */
function tlBuild() {
  const h = tl.hist;
  if (!h || !h.minDate) return false;
  const slotW = TL_SLOT_W[tl.level] || 56;
  tl.monthCount = new Map();
  for (const m of h.months || []) tl.monthCount.set(m.y * 100 + m.m, m.n);
  tl.dayCount = new Map(h.days || []);

  const start = new Date(h.minDate);
  start.setDate(1); start.setHours(0, 0, 0, 0);
  const endMs = Math.max(h.maxDate || 0, Date.now());
  const end = new Date(endMs);
  end.setDate(1); end.setHours(0, 0, 0, 0);

  const slots = [];
  const byKey = new Map();
  let x = 0, maxN = 1, y = start.getFullYear(), mo = start.getMonth() + 1;
  for (let guard = 0; guard < 2400; guard++) {      // 200 年保护
    const n = tl.monthCount.get(y * 100 + mo) || 0;
    if (n > maxN) maxN = n;
    const slot = { y, m: mo, n, x0: x, w: slotW };
    slots.push(slot);
    byKey.set(y * 100 + mo, slot);
    x += slotW;
    if (y === end.getFullYear() && mo === end.getMonth() + 1) break;
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  tl.slots = slots;
  tl.slotByKey = byKey;
  tl.totalW = x;
  tl.maxN = maxN;
  tlLayout();
  return true;
}

function tlLayout() {
  const panel = $('tlpanel');
  tl.width = panel.clientWidth || 900;
  tl.height = panel.clientHeight || 96;
  tl.dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = $('tlcanvas');
  if (cv) { cv.width = Math.round(tl.width * tl.dpr); cv.height = Math.round(tl.height * tl.dpr); }
  const first = tl.slots[0], last = tl.slots[tl.slots.length - 1];
  if (!first || !last) return;
  tl.cMin = first.w / 2;
  tl.cMax = Math.max(tl.cMin, tl.totalW - last.w / 2);
  tl.centerData = Math.min(tl.cMax, Math.max(tl.cMin, tl.centerData || tl.cMax));
  tl.offset = -tl.centerData;
}

function tlSetCenter(xData) {
  tl.centerData = Math.min(tl.cMax, Math.max(tl.cMin, xData));
  tl.offset = -tl.centerData;
}

const tlScreenX = (xData) => xData + tl.offset + tl.width / 2;
const tlDataX = (screenX) => screenX - tl.width / 2 - tl.offset;

/** 日期 → 数据坐标（找不到就返回 null） */
function tlXOfDate(ms) {
  const d = new Date(ms);
  const s = tl.slotByKey.get(d.getFullYear() * 100 + (d.getMonth() + 1));
  if (!s) return null;
  const dim = new Date(s.y, s.m, 0).getDate();
  const frac = (Math.min(d.getDate(), dim) - 1 + 0.5) / dim;
  return s.x0 + frac * s.w;
}

const ymdOf = (y, m, d) => y * 10000 + m * 100 + d;

/** 取某个数据坐标对应的时间点；默认磁吸到最近有内容的日子/月份 */
function tlPick(xData, noSnap) {
  if (!tl.slots.length) return null;
  const cx = Math.min(tl.totalW - 0.01, Math.max(0, xData));
  let lo = 0, hi = tl.slots.length - 1, idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, s = tl.slots[mid];
    if (cx < s.x0) hi = mid - 1;
    else if (cx >= s.x0 + s.w) lo = mid + 1;
    else { idx = mid; break; }
  }
  const s = tl.slots[idx];
  const dim = new Date(s.y, s.m, 0).getDate();
  const frac = Math.min(0.999, Math.max(0, (cx - s.x0) / s.w));
  const day = 1 + Math.floor(frac * dim);
  let picked = {
    y: s.y, m: s.m, d: tl.level === 'day' ? day : null,
    n: tl.level === 'day' ? (tl.dayCount.get(ymdOf(s.y, s.m, day)) || 0) : s.n,
  };
  if (noSnap) return picked;
  // 磁吸：拖到空白处时落到最近有照片的那天/那月，避免"跳过去什么都没有"
  if (tl.level === 'day' && !picked.n) {
    for (let delta = 1; delta <= 45; delta++) {
      for (const dir of [-1, 1]) {
        const t = new Date(s.y, s.m - 1, day + delta * dir, 12);
        const n = tl.dayCount.get(ymdOf(t.getFullYear(), t.getMonth() + 1, t.getDate())) || 0;
        if (n) return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), n };
      }
    }
    // 附近 45 天都没有内容：退到整条轴上最近的有内容月份，取它的第一天
    let best = null, bestD = Infinity;
    for (const s2 of tl.slots) {
      if (!s2.n) continue;
      const d2 = Math.abs(s2.x0 + s2.w / 2 - cx);
      if (d2 < bestD) { bestD = d2; best = s2; }
    }
    if (best) {
      const dim2 = new Date(best.y, best.m, 0).getDate();
      for (let d2 = 1; d2 <= dim2; d2++) {
        const n2 = tl.dayCount.get(ymdOf(best.y, best.m, d2)) || 0;
        if (n2) return { y: best.y, m: best.m, d: d2, n: n2 };
      }
    }
  } else if (tl.level !== 'day' && !picked.n) {
    for (let delta = 1; delta <= 36; delta++) {
      for (const dir of [-1, 1]) {
        const t = new Date(s.y, s.m - 1 + delta * dir, 15);
        const s2 = tl.slotByKey.get(t.getFullYear() * 100 + (t.getMonth() + 1));
        if (s2 && s2.n) return { y: s2.y, m: s2.m, d: null, n: s2.n };
      }
    }
  }
  return picked;
}

/** 只画可见范围内的时间段 */
function tlDraw() {
  const cv = $('tlcanvas');
  if (!cv || !tl.slots.length) return;
  const ctx = cv.getContext('2d');
  const w = tl.width, h = tl.height;
  ctx.setTransform(tl.dpr, 0, 0, tl.dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const topY = 24;                 // 柱子最高处
  const baseY = h - 42;            // 柱子基线
  const maxBarH = Math.max(8, baseY - topY);
  const labelY = h - 20;           // 刻度文字基线
  const nowMs = Date.now();

  // 年份分隔线 + 吸边年份标签
  ctx.textBaseline = 'top';
  ctx.font = '600 12px "Noto Serif SC", "Microsoft YaHei", serif';
  let pinLeft = null;
  for (const s of tl.slots) {
    if (s.m !== 1) continue;
    const x = tlScreenX(s.x0);
    if (x < 26) { pinLeft = s.y; continue; }
    if (x > w + 40) break;
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 8); ctx.lineTo(Math.round(x) + 0.5, h - 30); ctx.stroke();
    ctx.fillStyle = 'rgba(201,206,219,.5)';
    ctx.fillText(String(s.y), x + 5, 5);
  }
  if (pinLeft != null) {
    ctx.fillStyle = 'rgba(224,178,106,.75)';
    ctx.fillText(String(pinLeft), 10, 5);
  }

  // 连续基线，让整条时间轴看起来是连贯的一节
  ctx.fillStyle = 'rgba(255,255,255,.10)';
  ctx.fillRect(0, baseY, w, 1);

  // 密度柱（按天）；年份档位太窄，按月一根
  for (const s of tl.slots) {
    const x = tlScreenX(s.x0);
    if (x + s.w < -24 || x > w + 24) continue;
    if (!s.n) continue;                              // 空月份只留基线
    const dim = new Date(s.y, s.m, 0).getDate();
    if (tl.level === 'year') {
      const ratio = Math.sqrt(s.n / tl.maxN);
      ctx.fillStyle = `rgba(224,178,106,${(0.3 + ratio * 0.6).toFixed(2)})`;
      ctx.fillRect(x + 1, baseY - Math.max(2, maxBarH * ratio), Math.max(1, s.w - 3), Math.max(2, maxBarH * ratio));
    } else {
      const bw = s.w / dim;
      for (let d = 1; d <= dim; d++) {
        const n = tl.dayCount.get(ymdOf(s.y, s.m, d)) || 0;
        if (!n) continue;
        const ratio = Math.sqrt(n / tl.maxN);
        const bh = Math.max(2, maxBarH * ratio);
        ctx.fillStyle = `rgba(224,178,106,${(0.32 + ratio * 0.6).toFixed(2)})`;
        ctx.fillRect(x + (d - 1) * bw, baseY - bh, Math.max(1, bw - (tl.level === 'day' ? 2 : 0.5)), bh);
      }
    }
  }

  // 今天
  const xNow = tlXOfDate(nowMs);
  if (xNow != null) {
    const xn = tlScreenX(xNow);
    if (xn > -20 && xn < w + 20) {
      ctx.strokeStyle = 'rgba(224,178,106,.8)';
      ctx.beginPath(); ctx.moveTo(Math.round(xn) + 0.5, 12); ctx.lineTo(Math.round(xn) + 0.5, baseY + 2); ctx.stroke();
      ctx.fillStyle = 'rgba(224,178,106,.9)';
      ctx.beginPath(); ctx.arc(xn, baseY + 2, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(224,178,106,.7)';
      ctx.font = '500 10px "Microsoft YaHei", sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText('今天', Math.min(w - 30, xn + 5), topY + 2);
    }
  }

  // 刻度文字
  ctx.textBaseline = 'alphabetic';
  for (const s of tl.slots) {
    const x = tlScreenX(s.x0);
    if (x + s.w < -60 || x > w + 60) continue;
    if (tl.level === 'day') {
      ctx.font = '600 11px "Noto Serif SC", "Microsoft YaHei", serif';
      ctx.fillStyle = 'rgba(201,206,219,.55)';
      ctx.fillText(`${s.m}月`, x + 4, labelY - 12);
      const dim = new Date(s.y, s.m, 0).getDate();
      ctx.font = '500 10px "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(146,152,168,.45)';
      for (let d = 1; d <= dim; d += 5) {
        ctx.fillText(String(d), x + (d - 1) * (s.w / dim) + 1, labelY);
      }
    } else {
      if (s.m === 1 || s.m % 3 === 1) {
        ctx.font = '500 10px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = 'rgba(146,152,168,.55)';
        ctx.fillText(`${s.m}月`, x + 4, labelY);
      }
    }
  }
  ctx.textBaseline = 'top';
}

function tlReadout() {
  const p = tl.pickNow;
  if (!p) return;
  $('tl-big').textContent = p.d
    ? `${p.y} 年 ${p.m} 月 ${p.d} 日`
    : `${p.y} 年 ${p.m} 月`;
  const silent = p.n ? '' : (tl.level === 'day' ? '这天没有回忆' : '这个月没有回忆');
  $('tl-sub').textContent = p.n ? `${p.n} 个回忆` : silent;
  // 只有关掉"松手即跳"时才需要这个按钮
  $('tl-go').hidden = state.ui.tlAutoJump !== false || !p.n;
}

/**
 * 找出当前视口里第一个/最后一个可见卡片。
 * 不用 elementFromPoint：稀疏行（一个 4:3 卡片只占半行）很容易探到空白处，
 * 之前就是这样导致视口框时有时无。改为按 y 坐标二分 + 小范围前进扫描。
 */
function tlVisibleTiles() {
  // 缓存一次 .tile 列表：滚动时每帧都 querySelectorAll 会白白分配 400+ 个节点
  if (!tl._tiles || tl._tilesLen !== state.items.length) {
    tl._tiles = document.querySelectorAll('.tile');
    tl._tilesLen = state.items.length;
  }
  const tiles = tl._tiles;
  if (!tiles.length) return null;
  const box = $('scroll').getBoundingClientRect();
  const panelTop = $('tlpanel').hidden ? box.bottom : $('tlpanel').getBoundingClientRect().top;
  const top = box.top + 54;                       // 让开标题栏
  const bottom = Math.min(box.bottom, panelTop) - 8;
  let lo = 0, hi = tiles.length - 1, first = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (tiles[mid].getBoundingClientRect().bottom > top) { first = mid; hi = mid - 1; } else lo = mid + 1;
  }
  if (first < 0) return null;
  let last = first;
  for (let i = first; i < tiles.length && i < first + 80; i++) {
    if (tiles[i].getBoundingClientRect().top < bottom) last = i; else break;
  }
  return { first: tiles[first], last: tiles[last] };
}

/** 列表当前视口对应的时间段，画成一个框 */
function tlDrawViewport() {
  const el = $('tlviewport');
  if (!el) return;
  const vis = tlVisibleTiles();
  if (!vis) { el.hidden = true; return; }
  const a = state.items.find((x) => x.id === vis.first.dataset.id);
  const b = state.items.find((x) => x.id === vis.last.dataset.id);
  const xa = a ? tlXOfDate(a.dateMs) : null;
  const xb = b ? tlXOfDate(b.dateMs) : null;
  if (xa == null || xb == null) { el.hidden = true; return; }
  const x0 = Math.max(0, tlScreenX(Math.min(xa, xb)));
  const x1 = Math.min(tl.width, tlScreenX(Math.max(xa, xb)));
  if (x1 - x0 < 2) { el.hidden = true; return; }
  el.hidden = false;
  el.style.left = Math.round(x0) + 'px';
  el.style.width = Math.round(x1 - x0) + 'px';
}

function tlRender() {
  if (!tl.open) return;
  tl.pickNow = tlPick(tlDataX(tl.width / 2));
  tlDraw();
  tlReadout();
  tlDrawViewport();
  if (tl.drag) tlUpdatePreview();
}

function tlSchedule() {
  if (tl.raf) return;
  tl.raf = requestAnimationFrame(() => { tl.raf = 0; tlRender(); });
}

/** 拖动时在上方浮出这个时段的缩略图 */
let tlPrevTimer = null;
function tlUpdatePreview() {
  clearTimeout(tlPrevTimer);
  tlPrevTimer = setTimeout(async () => {
    const box = $('tlprev');
    const p = tl.pickNow;
    if (!p || !tl.drag) { box.hidden = true; return; }
    const dateMs = new Date(p.y, p.m - 1, p.d || 15, 12).getTime();
    const seq = ++tl.prevSeq;
    let res = null;
    try { res = await window.sg.invoke('lib:around', { dateMs, limit: 3 }); } catch (e) { res = null; }
    if (seq !== tl.prevSeq || !tl.drag) return;
    if (!res || !res.items.length) { box.hidden = true; return; }
    box.textContent = '';
    for (const it of res.items) {
      const d = document.createElement('div');
      d.className = 'tlthumb' + (it.hasThumb ? '' : ' nothumb');
      if (it.hasThumb) d.style.backgroundImage = `url("${it.thumbUrl}")`;
      box.appendChild(d);
    }
    box.hidden = false;
  }, 90);
}

/** 跳到当前选中的时段 */
async function tlJumpPicked() {
  const p = tl.pickNow;
  if (!p) return;
  if (!p.n) { toast('这个时间段还没有回忆'); return; }
  const target = new Date(p.y, p.m - 1, p.d || 15, 12).getTime();
  let loc = null;
  try {
    loc = await window.sg.invoke('lib:locate', {
      dateMs: target, filter: state.filter, q: state.q, day: state.day, albumId: state.albumId,
    });
  } catch (e) { loc = null; }
  if (!loc || !loc.total) { toast('这个时间段还没有回忆'); return; }

  // 临时放大页大小，少来回几次把目标序号加载进来
  const prevSize = state.pageSize;
  state.pageSize = 200;
  let guard = 0;
  const maxRounds = Math.ceil((loc.index + 1) / state.pageSize) + 6;
  while (!state.done && state.items.length <= loc.index && guard++ < maxRounds) await loadPage();
  state.pageSize = prevSize;
  tl.syncGuard = Date.now() + 900;

  const item = loc.id ? state.items.find((x) => x.id === loc.id) : null;
  const tile = item ? tileById(item.id) : null;
  if (tile) {
    tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tile.classList.add('landed');
    setTimeout(() => tile.classList.remove('landed'), 1500);
    toast(p.d ? `已跳到 ${p.y}年${p.m}月${p.d}日` : `已跳到 ${p.y}年${p.m}月`, true);
    return;
  }
  const el = document.querySelector(`.month[data-y="${p.y}"][data-m="${p.m}"]`);
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  toast('这个时间段还没加载出来，先往上/下滚一点再试');
}

/** 键盘微调：按当前档位挪一格 */
function tlStep(dir) {
  if (!tl.slots.length) return;
  const step = TL_SLOT_W[tl.level] || 56;
  tlSetCenter(tl.centerData + dir * step);
  tlSchedule();
}

function tlTopVisibleDate() {
  const vis = tlVisibleTiles();
  if (!vis) return null;
  const item = state.items.find((x) => x.id === vis.first.dataset.id);
  return item ? item.dateMs : null;
}

/** 打开/关闭并定位到列表当前所在的时间；persist=true 时记住这次选择 */
async function toggleTimeline(force, persist) {
  const want = force !== undefined ? force : !tl.open;
  tl.open = want;
  $('tlpanel').hidden = !want;
  $('tlreadout').hidden = !want;
  $('app').classList.toggle('tlon', want);
  document.querySelectorAll('.rail button').forEach((b) => {
    if (b.dataset.nav === 'timeline') b.classList.toggle('on', want);
  });
  if (persist) {
    // 记住"启动时显示"的行为：下次打开软件保持这次的选择
    window.sg.invoke('ui:set', { tlOpen: want })
      .then((ui) => { state.ui = ui || state.ui; })
      .catch(() => {});
  }
  if (!want) { $('tlprev').hidden = true; return; }

  await tlLoadHist(!tl.slots.length);
  if (!tlBuild()) { toast('还没有可以展示的时间线'); return; }
  const ms = tlTopVisibleDate();
  const x = ms != null ? tlXOfDate(ms) : null;
  if (x != null) tlSetCenter(x);
  tlRender();
}

/* ═════════ 幻灯片放映：全屏 + 交叉淡入淡出，底部时间轴跟着走 ═════════ */
const ss = { on: false, list: [], idx: 0, timer: 0, paused: false, front: 'a', hold: 4500, lastId: null };

/** 放映列表：当前筛选下的条目，按时间正序（老 → 新）；先把分页补齐，免得放到一半断掉 */
async function ssBuildList(startId) {
  let guard = 0;
  while (!state.done && state.items.length < 1200 && guard++ < 12) await loadPage();
  const list = state.items.slice().sort((a, b) => a.dateMs - b.dateMs);
  ss.list = list;
  const i = startId ? list.findIndex((x) => x.id === startId) : -1;
  ss.idx = i >= 0 ? i : 0;
  return list;
}

function ssImg(item) {
  const img = document.createElement('img');
  img.src = item.hasThumb ? item.thumbUrl : item.srcUrl;
  img.addEventListener('error', () => { if (img.src !== item.thumbUrl) img.src = item.thumbUrl; });
  // 先用缩略图垫着，原图就绪再换，避免白屏
  const pre = new Image();
  pre.onload = () => { if (img.isConnected) img.src = item.srcUrl; };
  pre.src = item.srcUrl;
  return img;
}

function ssMakeMedia(item) {
  const wrap = document.createElement('div');
  wrap.className = 'ss-media';
  if (item.kind === 'video') {
    const v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.playsInline = true;
    v.src = item.srcUrl;
    v.addEventListener('error', () => {         // 解不了的编码（例如缺 HEVC 解码器）退回封面
      wrap.textContent = '';
      wrap.appendChild(ssImg(item));
    });
    v.addEventListener('ended', () => { if (ss.on && !ss.paused) { clearTimeout(ss.timer); ssShow(ss.idx + 1); } });
    wrap.appendChild(v);
  } else {
    wrap.appendChild(ssImg(item));
  }
  return wrap;
}

/** 显示第 i 张；两层交替做交叉淡入 */
function ssShow(i) {
  const n = ss.list.length;
  if (!n) return;
  ss.idx = ((i % n) + n) % n;
  const item = ss.list[ss.idx];
  ss.lastId = item.id;

  const nextKey = ss.front === 'a' ? 'b' : 'a';
  const next = $('ss-' + nextKey);
  const prev = $('ss-' + ss.front);
  next.textContent = '';
  next.appendChild(ssMakeMedia(item));

  const img = next.querySelector('img');
  if (img) {                                    // 照片给一点缓推，视频不推
    img.style.animation = 'none';
    void img.offsetWidth;
    img.style.animation = `ssZoom ${ss.hold + 900}ms ease-out both`;
  }

  next.classList.add('on');
  prev.classList.remove('on');
  ss.front = nextKey;

  $('ss-date').textContent = fmtDate(item.dateMs);
  const bits = [];
  if (item.kind === 'video') bits.push('视频');
  if (item.cam) bits.push(item.cam);
  bits.push(`${ss.idx + 1} / ${n}`);
  $('ss-sub').textContent = bits.join(' · ');

  ssSyncTimeline(item);
  ssScheduleNext(item);
}

/** 时间轴跟着放映位置移动，读数也随之更新 */
async function ssSyncTimeline(item) {
  if (!tl.open) { try { await toggleTimeline(true); } catch (e) { /* 忽略 */ } }
  if (!tl.slots.length) return;
  const x = tlXOfDate(item.dateMs);
  if (x == null) return;
  tlSetCenter(x);
  tl.syncGuard = Date.now() + 400;
  tlRender();
}

function ssScheduleNext(item) {
  clearTimeout(ss.timer);
  if (!ss.on || ss.paused) return;
  const ms = item.kind === 'video'
    ? Math.min(Math.max((item.duration || 6) * 1000, 2500), 20000)
    : ss.hold;
  ss.timer = setTimeout(() => ssShow(ss.idx + 1), ms);
}

function ssTogglePause(force) {
  ss.paused = force !== undefined ? force : !ss.paused;
  $('ss-pause').hidden = !ss.paused;
  const v = $('slideshow').querySelector('video');
  if (v) { if (ss.paused) v.pause(); else v.play().catch(() => {}); }
  if (ss.paused) clearTimeout(ss.timer); else ssScheduleNext(ss.list[ss.idx]);
}

/* ── 放映背景音乐：自动读 music/ 目录，随机起播、循环 ── */
const ssMusic = { list: [], idx: 0, audio: null, enabled: true, name: '' };

async function ssStartMusic() {
  if (state.ui.ssMusic === false) return;
  try { ssMusic.list = await window.sg.invoke('music:list'); } catch (e) { ssMusic.list = []; }
  if (!ssMusic.list.length) { $('ss-music').hidden = true; return; }
  ssMusic.enabled = true;
  ssMusic.idx = Math.floor(Math.random() * ssMusic.list.length);
  if (!ssMusic.audio) {
    ssMusic.audio = new Audio();
    ssMusic.audio.volume = 0.9;
    ssMusic.audio.addEventListener('ended', () => {
      ssMusic.idx = (ssMusic.idx + 1) % ssMusic.list.length;
      ssPlayMusic();
    });
  }
  ssPlayMusic();
}

function ssPlayMusic() {
  const a = ssMusic.audio;
  if (!a || !ssMusic.list.length || !ssMusic.enabled) return;
  ssMusic.name = ssMusic.list[ssMusic.idx].replace(/\.[^.]+$/, '');
  a.src = 'sg://music/' + encodeURIComponent(ssMusic.list[ssMusic.idx]);
  a.play().catch(() => {});
  $('ss-music-name').textContent = ssMusic.name;
  $('ss-music').hidden = false;
}

function ssToggleMusic() {
  ssMusic.enabled = !ssMusic.enabled;
  if (ssMusic.enabled) {
    if (ssMusic.audio && ssMusic.list.length) ssPlayMusic();
    else ssStartMusic();
  } else {
    if (ssMusic.audio) ssMusic.audio.pause();
    $('ss-music').hidden = true;
  }
}

function ssStopMusic() {
  if (ssMusic.audio) { try { ssMusic.audio.pause(); } catch (e) { /* 忽略 */ } }
  ssMusic.audio = null;
  ssMusic.list = [];
  $('ss-music').hidden = true;
}

async function startSlideshow(startId) {
  if (ss.on) return;
  const list = await ssBuildList(startId);
  if (!list.length) { toast('这里还没有可以放映的内容'); return; }
  if (!$('viewer').hidden) closeViewer();

  ss.on = true; ss.paused = false;
  $('slideshow').hidden = false;
  $('app').classList.add('ss');
  try { await window.sg.invoke('win:fullscreen', { on: true }); } catch (e) { /* 忽略 */ }
  if (!tl.open) await toggleTimeline(true);
  ssShow(ss.idx);
  ssStartMusic();

  const hint = $('ss-hint');
  hint.style.opacity = '1';
  setTimeout(() => { if (ss.on) hint.style.opacity = '0'; }, 3200);
}

async function stopSlideshow() {
  if (!ss.on) return;
  ss.on = false;
  clearTimeout(ss.timer);
  ssStopMusic();
  $('slideshow').hidden = true;
  $('app').classList.remove('ss');
  $('ss-a').textContent = '';
  $('ss-b').textContent = '';
  $('ss-pause').hidden = true;
  try { await window.sg.invoke('win:fullscreen', { on: false }); } catch (e) { /* 忽略 */ }
  // 回到列表时停在这一张，方便接着看
  if (ss.lastId) {
    const it = state.items.find((x) => x.id === ss.lastId);
    const tile = it ? tileById(it.id) : null;
    if (tile) {
      tl.syncGuard = Date.now() + 800;
      tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tile.classList.add('landed');
      setTimeout(() => tile.classList.remove('landed'), 1500);
    }
  }
}

/* ═════════ 首次使用引导 ═════════ */
const tour = { on: false, step: 0 };

const TOUR_STEPS = [
  {
    icon: 'sparkles', title: '欢迎来到拾光',
    body: '把照片和视频放进照片库，这里会把它们整理成一条可以慢慢走回去的时光长廊。\n\n如果还没放，点设置里的「浏览…」选一个放照片的文件夹就行。',
    side: 'left',
  },
  {
    icon: 'calendar-days', title: '时间线 · 你的回忆密度',
    body: '主界面直接按 T，或点左侧的日历图标：底部这根金色的条就是你的全部回忆。\n\n拖动它读时间，松手直接跳到那一天；在条上滚滚轮可以在 年 / 月 / 日 三级之间放大缩小。',
    side: 'left',
  },
  {
    icon: 'play', title: '幻灯片放映（推荐试试）',
    body: '在照片墙直接按 S，或点开一张照片后按 S：进入全屏放映。\n\n照片一张张淡入淡出，底部时间轴跟着走；把 .mp3 / .m4a 放进 music 文件夹还能配背景音乐。按 Esc 退出。',
    side: 'left',
  },
  {
    icon: 'pencil', title: '大图查看器',
    body: '点任意一张卡片放大：滚轮缩放、拖动平移、F 收藏、i 看详情、Delete 移入回收站。\n\n工具栏里还有旋转、裁剪、调色——编辑前会自动备份原文件，拍摄日期不会丢。',
    side: 'left',
  },
  {
    icon: 'heart', title: '收藏、评星与相册',
    body: '鼠标移到卡片上：❤ 收藏、★ 评星；放映和相册都按收藏走。\n\n左侧「相册」可以建自己的合集，比如「2026 春节」。',
    side: 'left',
  },
  {
    icon: 'hard-drive', title: '你的数据在哪里',
    body: '索引、缩略图、回收站、相册全部保存在本地，卸载软件也不会删。\n\n设置里可以换照片库位置、重看这份引导。遇到界面突然消失——那是沉浸模式，动一下鼠标就回来了。',
    side: 'left',
  },
];

function tourRender() {
  const s = TOUR_STEPS[tour.step];
  if (!s) return;
  $('tour-step').innerHTML = `<div class="tour-icon" id="tour-icon"></div><h3 class="tour-title"></h3><p class="tour-body"></p>`;
  $('tour-icon').innerHTML = icon(s.icon);
  $('tour-step').querySelector('.tour-title').textContent = s.title;
  $('tour-step').querySelector('.tour-body').textContent = s.body;

  const dots = $('tour-dots');
  dots.textContent = '';
  TOUR_STEPS.forEach((_, i) => {
    const d = document.createElement('i');
    d.className = 'tour-dot' + (i === tour.step ? ' on' : '');
    dots.appendChild(d);
  });
  $('tour-prev').disabled = tour.step === 0;
  $('tour-next').textContent = tour.step === TOUR_STEPS.length - 1 ? '开始使用' : '下一步';
}

function startTour() {
  if (tour.on) return;
  if (!$('settings').hidden) $('settings').hidden = true;
  tour.on = true; tour.step = 0;
  $('tour').hidden = false;
  wakeFn(60000);   // 引导期间不让界面隐身
  tourRender();
}

function endTour(finished) {
  if (!tour.on) return;
  tour.on = false;
  $('tour').hidden = true;
  wakeFn();
  if (state.ui.tourDone !== true) {
    window.sg.invoke('ui:set', { tourDone: true })
      .then((ui) => { state.ui = ui || state.ui; })
      .catch(() => {});
  }
  if (finished) toast('开始探索吧 · 随时可以在 设置 → 功能引导 重看', true);
}

/* ── 分页加载 ── */
async function loadPage() {
  if (state.loading || state.done) return;
  const gen = state.gen;
  state.loading = true;
  try {
    const res = await window.sg.invoke('lib:list', {
      filter: state.filter, q: state.q, day: state.day, albumId: state.albumId,
      offset: state.offset, limit: state.pageSize,
    });
    if (gen !== state.gen) return; // 列表已被重置，丢弃过期结果
    state.total = res.total;
    state.items.push(...res.items);
    state.offset += res.items.length;
    state.done = state.offset >= res.total || res.items.length === 0;
    renderNewItems(); // 只追加，不清空 → 滚动位置不丢
    $('more').hidden = !state.done;
    const label = state.q ? `"${state.q}"` : (state.albumName ? `相册《${state.albumName}》` : (state.day ? '那年今日' : null));
    $('more').textContent = state.items.length
      ? (label ? `${label} · 共 ${state.total} 条回忆` : '继续向下，回到最早的回忆 ↓')
      : (label ? `${label} · 没有找到照片` : '没有找到匹配的照片');
  } catch (e) {
    if (gen === state.gen) toast('加载失败：' + e.message);
  } finally {
    state.loading = false;
    if (gen === state.gen) {
      state.firstLoaded = true;
      maybeSmoke();
    }
  }
  if (gen !== state.gen) return;
  const sc = $('scroll');
  if (!state.done && sc.scrollHeight < sc.clientHeight + 300) loadPage();
}

async function resetList() {
  state.gen++; // 使未完成的旧请求全部失效
  state.items = []; state.offset = 0; state.done = false; state.firstLoaded = false;
  resetRender();
  $('more').hidden = true;
  while (state.loading) await new Promise((r) => setTimeout(r, 25));
  await loadPage();
}

/* ── 筛选 ── */
function refreshChips() {
  document.querySelectorAll('#chips button[data-chip]').forEach((b) => {
    b.classList.toggle('on', !state.albumId && b.dataset.chip === state.filter && !state.day);
  });
  let chip = $('chip-album');
  if (state.albumId) {
    if (!chip) {
      chip = document.createElement('button');
      chip.id = 'chip-album';
      chip.type = 'button';
      const chips = $('chips');
      chips.insertBefore(chip, chips.firstChild);
      chip.addEventListener('click', () => exitAlbum());
    }
    chip.textContent = `相册《${state.albumName}》 ✕`;
    chip.classList.add('on');
  } else if (chip) chip.remove();
}

function exitAlbum() {
  state.albumId = null; state.albumName = '';
  refreshChips();
  syncRail('home');
  resetList();
}

/* ── 侧栏高亮：时间轴按钮单独反映面板开关，不跟筛选走 ── */
function syncRail(nav) {
  document.querySelectorAll('.rail button').forEach((b) => {
    if (b.dataset.nav === 'timeline') b.classList.toggle('on', tl.open);
    else b.classList.toggle('on', b.dataset.nav === nav);
  });
}

function setFilter(f) {
  state.filter = f; state.day = null; state.q = ''; state.albumId = null; state.albumName = '';
  $('q').value = '';
  refreshChips();
  syncRail(f === 'all' ? 'home' : f);
  resetList();
}

/* ═════════ 查看器 ═════════ */
function cur() { return state.items[viewer.idx]; }

function applyTransform() {
  const el = $('v-media').querySelector('img, video');
  if (!el) return;
  // 旋转后按包围盒再缩一次：90° 时 900×700 的图会变成 700×900，不缩就会被舞台切掉
  const k = rotFitScale(el);
  el.style.transform = `translate(${viewer.tx}px, ${viewer.ty}px) scale(${(viewer.scale * k).toFixed(4)}) rotate(${viewer.rot}deg)`;
  const zl = $('v-zoomval');
  if (zl) zl.textContent = Math.round(viewer.scale * 100) + '%';
}

function rotFitScale(el) {
  const media = $('v-media');
  if (!el || !media) return 1;
  const nw = el.naturalWidth || el.videoWidth || el.clientWidth;
  const nh = el.naturalHeight || el.videoHeight || el.clientHeight;
  if (!nw || !nh) return 1;
  const box = media.getBoundingClientRect();
  const base = Math.min(box.width / nw, box.height / nh);
  const rot90 = Math.abs(viewer.rot % 180) === 90;
  const rw = (rot90 ? nh : nw) * base;
  const rh = (rot90 ? nw : nh) * base;
  return Math.min(1, box.width / rw, box.height / rh);
}

function setZoom(s) {
  viewer.scale = Math.min(8, Math.max(0.2, s));
  applyTransform();
}

function zoomFit() {
  viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
  applyTransform();
}

function applyEditPreview() {
  const el = $('v-media').querySelector('img');
  if (!el) return;
  const f = `brightness(${edit.bri}) contrast(${edit.con}) saturate(${edit.sat})`;
  el.style.filter = (edit.bri === 1 && edit.con === 1 && edit.sat === 1) ? '' : f;
}

function exitEditMode() {
  edit.on = false; edit.crop = false; edit.cropRect = null; edit.bri = 1; edit.con = 1; edit.sat = 1;
  viewer.rot = 0;
  $('editbar').hidden = true;
  $('vstar').hidden = true;
  $('cropbox').classList.remove('on');
  $('e-crop').classList.remove('on');
  const el = $('v-media').querySelector('img');
  if (el) el.style.filter = '';
  $('e-bri').value = 1; $('e-con').value = 1; $('e-sat').value = 1;
  applyTransform();
}

async function openViewer(i) {
  exitEditMode();
  viewer.idx = i; viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
  const item = cur();
  const media = $('v-media');
  media.textContent = '';
  $('v-loader').classList.remove('off');
  $('v-loader').textContent = '正在打开…';
  if (item.kind === 'video') {
    const v = document.createElement('video');
    v.controls = true; v.autoplay = true;
    v.src = item.srcUrl;
    v.addEventListener('loadeddata', () => $('v-loader').classList.add('off'));
    v.addEventListener('error', () => {
      // HEVC 等编码需要系统解码器；这里给出可操作的出口，而不是一句死文字
      const loader = $('v-loader');
      loader.classList.remove('off');
      loader.textContent = '';
      const wrap = document.createElement('div');
      wrap.className = 'verr';
      const p = document.createElement('p');
      p.textContent = '这个视频的编码当前系统解不了（HEVC 需要系统解码器），可以用系统播放器打开';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn glass';
      b.textContent = '在文件夹中打开';
      b.addEventListener('click', () => window.sg.invoke('photo:showInFolder', { id: item.id }));
      wrap.appendChild(p);
      wrap.appendChild(b);
      loader.appendChild(wrap);
    });
    media.appendChild(v);
  } else {
    // 渐进加载：先显示缩略图，原图就绪后替换
    const img = document.createElement('img');
    if (item.hasThumb) {
      img.src = item.thumbUrl;
      img.addEventListener('load', () => $('v-loader').classList.add('off'), { once: true });
    }
    media.appendChild(img);
    applyTransform();
    const pre = new Image();
    pre.src = item.srcUrl;
    pre.onload = () => {
      if (cur() === item && $('v-media').querySelector('img') === img) {
        img.src = item.srcUrl;
        $('v-loader').classList.add('off');
      }
    };
    pre.onerror = () => { if (!$('v-loader').classList.contains('off')) $('v-loader').textContent = '无法打开此图片（可能是不支持的格式）'; };
  }
  updateVBar();
  const zl = $('v-zoomval');
  if (zl) zl.textContent = '100%';
  if ($('infopanel').classList.contains('on')) fillInfoPanel();
  $('viewer').hidden = false;
}

function closeViewer() {
  const v = $('v-media').querySelector('video');
  if (v) v.pause();
  exitEditMode();
  $('viewer').hidden = true;
}

function stepViewer(dir) {
  if (viewer.idx < 0) return;
  const n = (viewer.idx + dir + state.items.length) % state.items.length;
  openViewer(n);
}

function updateVBar() {
  const item = cur();
  if (!item) return;
  $('v-cap').textContent = item.name;
  const bits = [fmtFull(item.dateMs)];
  if (item.duration) bits.push('时长 ' + fmtDur(item.duration));
  if (item.cam) bits.push(item.cam);
  if (item.w && item.h) bits.push(`${item.w}×${item.h}`);
  bits.push(fmtSize(item.size));
  if (item.gps) bits.push(`${item.gps[0].toFixed(3)}, ${item.gps[1].toFixed(3)}`);
  $('v-meta').innerHTML = `${icon('clock')}${bits.join(' · ')}`;
  $('v-fav').classList.toggle('on', item.fav);
  $('v-star').classList.toggle('on', !!item.star);
}

/** 播放/暂停当前视频（空格） */
function togglePlay() {
  const v = $('v-media').querySelector('video');
  if (!v) return;
  if (v.paused) v.play().catch(() => {}); else v.pause();
}

const DATE_SOURCE_LABEL = { exif: '相机 EXIF', meta: '视频元数据', file: '文件时间' };

/* ── 详细信息面板 ── */
function fmtExposure(v) {
  if (!v) return '';
  if (v >= 1) return `${v.toFixed(1)}s`;
  return `1/${Math.max(1, Math.round(1 / v))}s`;
}
function fmtFnum(v) { return v ? 'f/' + (v % 1 ? v.toFixed(1) : v) : ''; }
function fmtFocal(v) { return v ? Math.round(v) + 'mm' : ''; }

function fillInfoPanel() {
  const item = cur();
  const body = $('ip-body');
  if (!item || !body) return;
  body.textContent = '';
  const sec = (t) => {
    const d = document.createElement('div');
    d.className = 'ip-sec'; d.textContent = t;
    body.appendChild(d);
  };
  const row = (k, v) => {
    if (v === undefined || v === null || v === '') return;
    const d = document.createElement('div');
    d.className = 'ip-row';
    const kk = document.createElement('span'); kk.className = 'ip-k'; kk.textContent = k;
    const vv = document.createElement('span'); vv.className = 'ip-v'; vv.textContent = String(v);
    d.appendChild(kk); d.appendChild(vv);
    body.appendChild(d);
  };

  const e = item.exif || {};
  const swap = (item.orientation || 1) >= 5;

  sec('文件');
  row('文件名', item.name);
  row('类型', (item.kind === 'video' ? '视频' : '图片') + ' · ' + item.ext.replace('.', '').toUpperCase());
  row('大小', fmtSize(item.size));
  if (item.w && item.h) row('尺寸', `${swap ? item.h : item.w} × ${swap ? item.w : item.h}${swap ? '（竖拍）' : ''}`);
  row('位置', item.path);

  sec('拍摄');
  row('时间', fmtFull(item.dateMs));
  row('时间来源', DATE_SOURCE_LABEL[item.dateSource] || '文件时间');
  if (item.cam) row('设备', item.cam);
  if (e.iso) row('ISO', String(e.iso));
  if (e.fnum) row('光圈', fmtFnum(e.fnum));
  if (e.exposure) row('快门', fmtExposure(e.exposure));
  if (e.focal) row('焦距', fmtFocal(e.focal));
  if (item.gps) row('GPS', `${item.gps[0].toFixed(5)}, ${item.gps[1].toFixed(5)}`);
  if (item.duration) row('时长', fmtDur(item.duration));

  sec('状态');
  row('收藏', item.fav ? '❤ 已收藏' : '未收藏');
  row('评分', item.star ? '★'.repeat(item.star) : '未评分');

  sec('所属相册');
  const albBox = document.createElement('div');
  albBox.className = 'ip-empty';
  albBox.textContent = '读取中…';
  body.appendChild(albBox);
  window.sg.invoke('album:list').then((albums) => {
    const mine = albums.filter((a) => (a.photoIds || []).includes(item.id));
    albBox.textContent = '';
    if (!mine.length) { albBox.className = 'ip-empty'; albBox.textContent = '未加入相册'; return; }
    mine.forEach((a) => {
      const chip = document.createElement('span');
      chip.className = 'ip-chip';
      chip.textContent = a.name;
      albBox.appendChild(chip);
    });
  }).catch(() => { albBox.textContent = '读取失败'; });
}


function cropGeom() {
  const img = $('v-media').querySelector('img');
  if (!img || !img.naturalWidth) return null;
  const vm = $('v-media').getBoundingClientRect();
  const st = $('v-stage').getBoundingClientRect();
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const rot90 = Math.abs(viewer.rot % 180) === 90;
  const rw = rot90 ? nh : nw, rh = rot90 ? nw : nh;
  // 显示倍率 = 适应倍率 × 旋转后的收缩比，必须和 applyTransform 一致
  const s = Math.min(vm.width / nw, vm.height / nh) * rotFitScale(img);
  const boxW = rw * s, boxH = rh * s;
  const cx = st.left + st.width / 2, cy = st.top + st.height / 2;
  return { s, left: cx - boxW / 2, top: cy - boxH / 2, right: cx + boxW / 2, bottom: cy + boxH / 2, rw, rh };
}

/** 把矩形钳制在图像包围盒内 */
function clampCrop(r) {
  const g = cropGeom();
  if (!g) return null;
  const x0 = Math.max(g.left, Math.min(r.x, g.right));
  const y0 = Math.max(g.top, Math.min(r.y, g.bottom));
  const x1 = Math.min(g.right, Math.max(r.x + r.w, g.left));
  const y1 = Math.min(g.bottom, Math.max(r.y + r.h, g.top));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function paintCrop(r) {
  const g = cropGeom();
  const box = $('cropbox');
  if (!g || !box || !r) return;
  const st = $('v-stage').getBoundingClientRect();
  box.style.left = (r.x - st.left) + 'px';
  box.style.top = (r.y - st.top) + 'px';
  box.style.width = r.w + 'px';
  box.style.height = r.h + 'px';
  edit.cropRect = r;
  box.dataset.size = `${Math.round(r.w / g.s)} × ${Math.round(r.h / g.s)} px`;
}

function drawCropRect(x0, y0, x1, y1) {
  const r = clampCrop({
    x: Math.min(x0, x1), y: Math.min(y0, y1),
    w: Math.abs(x1 - x0), h: Math.abs(y1 - y0),
  });
  if (r) paintCrop(r);
}

/** 进入裁剪时的默认框：图像中央 80%，并保证完整可见 */
function defaultCrop() {
  const g = cropGeom();
  if (!g) return;
  const boxW = g.right - g.left, boxH = g.bottom - g.top;
  const w = boxW * 0.8, h = boxH * 0.8;
  paintCrop({ x: g.left + (boxW - w) / 2, y: g.top + (boxH - h) / 2, w, h });
}

function cropPayload() {
  if (!edit.cropRect || edit.cropRect.w < 10 || edit.cropRect.h < 10) return null;
  const g = cropGeom();
  if (!g) return null;
  const r = edit.cropRect;
  const left = Math.max(0, Math.round((r.x - g.left) / g.s));
  const top = Math.max(0, Math.round((r.y - g.top) / g.s));
  const width = Math.min(g.rw - left, Math.round(r.w / g.s));
  const height = Math.min(g.rh - top, Math.round(r.h / g.s));
  if (width < 8 || height < 8) return null;
  return { left, top, width, height };
}

/* ── 相册 ── */
async function openAlbums() {
  $('albums').hidden = false;
  await refreshAlbums();
}
async function refreshAlbums() {
  const list = await window.sg.invoke('album:list');
  const box = $('alb-list');
  box.textContent = '';
  if (!list.length) {
    box.innerHTML = '<div class="albempty">还没有相册。建一个，比如「2026 春节」。</div>';
    return;
  }
  for (const a of list) {
    const row = document.createElement('div');
    row.className = 'albitem';
    row.innerHTML = `<div class="aic">${icon('disc-album')}</div>
      <div class="ainfo"><div class="aname"></div><div class="ameta"></div></div>`;
    row.querySelector('.aname').textContent = a.name;
    row.querySelector('.ameta').textContent = `${a.count} 张照片`;
    const open = document.createElement('button');
    open.className = 'btn glass';
    open.type = 'button';
    open.textContent = '打开';
    open.addEventListener('click', () => {
      $('albums').hidden = true;
      state.albumId = a.id; state.albumName = a.name;
      state.filter = 'all'; state.day = null; state.q = ''; $('q').value = '';
      refreshChips();
      syncRail('albums');
      resetList();
    });
    const ren = document.createElement('button');
    ren.className = 'btn glass';
    ren.type = 'button';
    ren.textContent = '重命名';
    ren.addEventListener('click', async () => {
      const name = await inputDlg('重命名相册', a.name);
      if (name && name !== a.name) {
        await window.sg.invoke('album:rename', { id: a.id, name });
        if (state.albumId === a.id) state.albumName = name;
        refreshChips();
        refreshAlbums();
      }
    });
    const del = document.createElement('button');
    del.className = 'btn glass';
    del.type = 'button';
    del.textContent = '删除';
    del.addEventListener('click', async () => {
      const ok = await confirmDlg('删除相册', `相册《${a.name}》将被删除（照片本身保留）。`, '删除');
      if (!ok) return;
      await window.sg.invoke('album:remove', { id: a.id });
      if (state.albumId === a.id) exitAlbum();
      refreshAlbums();
    });
    row.appendChild(open); row.appendChild(ren); row.appendChild(del);
    box.appendChild(row);
  }
}
async function openPick() {
  const item = cur();
  if (!item) return;
  const list = await window.sg.invoke('album:list');
  const box = $('pick-list');
  box.textContent = '';
  if (!list.length) box.innerHTML = '<div class="albempty">先在左侧「相册」里建一个相册</div>';
  for (const a of list) {
    const row = document.createElement('div');
    row.className = 'albitem';
    row.innerHTML = `<div class="aic">${icon('disc-album')}</div>
      <div class="ainfo"><div class="aname"></div><div class="ameta"></div></div>`;
    row.querySelector('.aname').textContent = a.name;
    row.querySelector('.ameta').textContent = `${a.count} 张`;
    row.style.cursor = 'pointer';
    row.addEventListener('click', async () => {
      await window.sg.invoke('album:addPhotos', { id: a.id, ids: [item.id] });
      $('albumpick').hidden = true;
      toast(`已加入《${a.name}》`, true);
    });
    box.appendChild(row);
  }
  $('albumpick').hidden = false;
}

/* ── 回收站 ── */
async function openTrash() {
  $('trash').hidden = false;
  await refreshTrash();
}
async function refreshTrash() {
  const list = await window.sg.invoke('trash:list');
  const box = $('trash-list');
  box.textContent = '';
  if (!list.length) {
    box.innerHTML = '<div class="trashempty">回收站是空的</div>';
    return;
  }
  for (const e of list) {
    const row = document.createElement('div');
    row.className = 'trashitem';
    const th = document.createElement('div');
    th.className = 'tthumb';
    if (e.hasThumb) th.style.backgroundImage = `url("${e.thumbUrl}")`;
    else th.innerHTML = icon(e.kind === 'video' ? 'film' : 'image');
    row.appendChild(th);
    const info = document.createElement('div');
    info.className = 'tinfo';
    info.innerHTML = '<div class="tname"></div><div class="tmeta"></div>';
    info.querySelector('.tname').textContent = e.name;
    info.querySelector('.tmeta').textContent =
      `${e.type === 'edit-backup' ? '编辑前备份' : new Date(e.deletedAt).toLocaleString('zh-CN')} · 来自 ${e.origPath}`;
    row.appendChild(info);
    const restore = document.createElement('button');
    restore.className = 'btn glass';
    restore.type = 'button';
    // 编辑前备份恢复出来是"另一份副本"，别写成"恢复"让人以为原图回来了
    restore.innerHTML = `${icon('undo-2')}${e.type === 'edit-backup' ? '还原副本' : '恢复'}`;
    restore.addEventListener('click', async () => {
      const dest = await window.sg.invoke('trash:restore', { eid: e.eid });
      toast(dest && dest !== e.origPath ? '原位置有同名文件，已恢复为新文件名' : '已恢复到原位置');
      await refreshTrash();
      resetList();
      renderHero();
    });
    row.appendChild(restore);
    box.appendChild(row);
  }
}

/* ── 设置 ── */
async function openSettings() {
  const st = await window.sg.invoke('cfg:get');
  state.version = st.version || '';
  state.ui = st.ui || state.ui;
  $('set-lib').textContent = (st.libAvailable === false ? '（离线）' : '') + (st.libDir || '（未设置）');
  $('set-stats').textContent = `已索引 ${st.count.toLocaleString()} 个文件 · 相册 ${st.albumCount || 0} · 回收站 ${st.trashCount} 项`
    + (st.brokenCount ? ` · 无法预览 ${st.brokenCount}` : '');
  $('set-ver').textContent = st.version || '1.0.0';
  $('set-immersive').checked = !!state.ui.immersive;
  $('set-idle').value = String(state.ui.idleMs || 2600);
  $('set-tlauto').checked = state.ui.tlAutoJump !== false;
  $('set-tlopen').checked = state.ui.tlOpen !== false;
  $('set-ssmusic').checked = state.ui.ssMusic !== false;
  $('settings').hidden = false;
}

/* ── 冒烟 ── */
let smokeDone = false;
async function maybeSmoke() {
  if (!state.smoke || smokeDone || !state.firstLoaded) return;
  if (!state.done && state.items.length < 15) return; // 至少翻 3 页，覆盖跨月/跨页路径
  smokeDone = true;
  try {
    const first = state.items.find((i) => i.hasThumb);
    let thumbOk = false;
    if (first) {
      const r = await fetch(first.thumbUrl);
      const b = await r.blob();
      thumbOk = r.ok && b.size > 0;
    }
    await window.sg.invoke('smoke:report', {
      ok: state.items.length > 0 && thumbOk,
      tiles: state.items.length,
      thumbOk,
      heroShown: !$('hero').hidden,
    });
  } catch (e) {
    try { await window.sg.invoke('smoke:report', { ok: false, error: String(e) }); } catch (e2) { /* 忽略 */ }
  }
}

/* ── 初始化 ── */
let wakeFn = null;

async function init() {
  injectIcons();

  // 渲染层错误兜底：既提示用户，也留一份环形缓冲（自测时可读出，避免静默失败）
  window.__sgErrors = [];
  window.addEventListener('error', (e) => {
    if (window.__sgErrors.length < 20) window.__sgErrors.push('error: ' + (e.message || '未知错误'));
    toast('界面出了点问题：' + (e.message || '未知错误'));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason && (e.reason.message || e.reason)) || '未知原因';
    if (window.__sgErrors.length < 20) window.__sgErrors.push('rejection: ' + String(msg));
  });

  $('w-min').addEventListener('click', () => window.sg.invoke('win:min'));
  $('w-max').addEventListener('click', () => window.sg.invoke('win:max'));
  $('w-close').addEventListener('click', () => window.sg.invoke('win:close'));
  $('titlebar').addEventListener('dblclick', (e) => {
    if (e.target.closest('.search') || e.target.closest('.winbtns')) return;
    window.sg.invoke('win:max');
  });

  /* 沉浸模式 */
  const app = $('app');
  let idleTimer = null;
  wakeFn = (ms) => {
    app.classList.add('awake');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const inputFocused = document.activeElement && document.activeElement.tagName === 'INPUT';
      if (inputFocused) return wakeFn(4000);
      if (!$('viewer').hidden || $('settings').hidden === false || $('albums').hidden === false
          || $('trash').hidden === false || $('albumpick').hidden === false || $('confirm').hidden === false
          || $('inputdlg').hidden === false || tour.on) {
        return wakeFn(4000);
      }
      if (!state.ui.immersive) return;
      app.classList.remove('awake');
    }, ms || state.ui.idleMs || 2600);
  };
  ['mousemove', 'mousedown', 'wheel', 'keydown', 'touchstart'].forEach((ev) => {
    document.addEventListener(ev, () => wakeFn(), { passive: true });
  });
  wakeFn(5200);

  /* 侧导航 */
  document.querySelectorAll('.rail button').forEach((b) => {
    b.addEventListener('click', () => {
      const nav = b.dataset.nav;
      if (nav === 'home') {
        setFilter('all');
        $('scroll').scrollTo({ top: 0, behavior: 'smooth' });
      } else if (nav === 'onthisday') {
        renderHero().then(() => {
          if (!$('hero').hidden) $('hero').scrollIntoView({ behavior: 'smooth', block: 'start' });
          else toast('还没有那年今日的回忆');
        });
      } else if (nav === 'timeline') {
        toggleTimeline(undefined, true);
      } else if (nav === 'albums') {
        openAlbums();
      } else if (nav === 'fav' || nav === 'video') {
        setFilter(nav);
        $('scroll').scrollTo({ top: 0, behavior: 'smooth' });
      } else if (nav === 'trash') {
        openTrash();
      } else if (nav === 'settings') {
        openSettings();
      }
    });
  });

  document.querySelectorAll('#chips button[data-chip]').forEach((b) => {
    b.addEventListener('click', () => setFilter(b.dataset.chip));
  });

  let qTimer = null;
  $('q').addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.q = $('q').value.trim();
      state.day = null; state.albumId = null; state.albumName = '';
      refreshChips();
      resetList();
    }, 350);
  });

  const io = new IntersectionObserver((ents) => {
    if (ents.some((e) => e.isIntersecting)) loadPage();
  }, { root: $('scroll'), rootMargin: '600px' });
  io.observe($('sentinel'));

  /* 时间轴：拖动=读数+预览，松手=落地；滚轮=年/月/日三级缩放；空白处单击=直接跳 */
  const tlPanel = $('tlpanel');
  tlPanel.addEventListener('pointerdown', (e) => {
    if (!tl.open) return;
    const rect = tlPanel.getBoundingClientRect();
    tl.drag = { x0: e.clientX, c0: tl.centerData, moved: false, clickX: e.clientX - rect.left };
    try { tlPanel.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
    e.preventDefault();
  });
  tlPanel.addEventListener('pointermove', (e) => {
    if (!tl.drag) return;
    const dx = e.clientX - tl.drag.x0;
    if (Math.abs(dx) > 3) tl.drag.moved = true;
    tlSetCenter(tl.drag.c0 - dx);
    tlSchedule();
  });
  const endDrag = (e) => {
    const d = tl.drag;
    if (!d) return;
    tl.drag = null;
    $('tlprev').hidden = true;
    // 单击：对准点击位置；拖动：对准中心
    const xData = d.moved ? tlDataX(tl.width / 2) : tlDataX(d.clickX);
    const picked = tlPick(xData, e && e.shiftKey);
    if (picked) {
      const x = tlXOfDate(new Date(picked.y, picked.m - 1, picked.d || 15, 12).getTime());
      if (x != null) tlSetCenter(x);          // 吸附到有内容的位置，读数与落地一致
    }
    tlRender();
    if (state.ui.tlAutoJump !== false) tlJumpPicked();
  };
  tlPanel.addEventListener('pointerup', endDrag);
  tlPanel.addEventListener('pointercancel', () => { tl.drag = null; $('tlprev').hidden = true; });
  tlPanel.addEventListener('wheel', (e) => {
    if (!tl.open) return;
    e.preventDefault();
    const i = TL_LEVELS.indexOf(tl.level);
    const next = Math.min(TL_LEVELS.length - 1, Math.max(0, i + (e.deltaY > 0 ? -1 : 1)));
    if (next === i) return;
    const keep = tl.pickNow;
    tl.level = TL_LEVELS[next];
    tlBuild();
    if (keep) {
      const x = tlXOfDate(new Date(keep.y, keep.m - 1, keep.d || 15, 12).getTime());
      if (x != null) tlSetCenter(x);
    }
    tlRender();
  }, { passive: false });
  $('tl-go').addEventListener('click', tlJumpPicked);

  // 列表滚动时，时间轴跟着走（跟到"当前最上面那张"的日期，不再只跟年份）
  let tlSyncRaf = 0;
  $('scroll').addEventListener('scroll', () => {
    if (!tl.open || tl.drag || Date.now() < tl.syncGuard) return;
    if (tlSyncRaf) return;
    tlSyncRaf = requestAnimationFrame(() => {
      tlSyncRaf = 0;
      const ms = tlTopVisibleDate();
      if (ms == null) { tlDrawViewport(); return; }
      const x = tlXOfDate(ms);
      if (x != null) { tlSetCenter(x); tlSchedule(); }
      else tlDrawViewport();
    });
  }, { passive: true });

  // 窗口尺寸变化 → 重排行（保持滚动位置）
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (tl.open) { tl.level = tl.level; tlBuild(); tlRender(); }
      if (!state.items.length) return;
      const sc = $('scroll'); const y = sc.scrollTop;
      renderTimeline();
      sc.scrollTop = Math.min(y, sc.scrollHeight);
    }, 250);
  });

  // Ctrl + 滚轮：整墙缩放（行高缩放，偏好持久化）
  let gridScaleTimer = null;
  $('scroll').addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const curS = state.ui.gridScale || 1;
    const next = Math.min(1.6, Math.max(0.6, curS * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    if (Math.abs(next - curS) < 0.002) return;
    state.ui.gridScale = next;
    clearTimeout(gridScaleTimer);
    gridScaleTimer = setTimeout(() => {
      window.sg.invoke('ui:set', { gridScale: Math.round(next * 100) / 100 }).catch(() => {});
    }, 500);
    const sc = $('scroll'); const y = sc.scrollTop;
    renderTimeline();
    sc.scrollTop = Math.min(y, sc.scrollHeight);
  }, { passive: false });

  $('hero-btn').addEventListener('click', () => {
    const day = state.heroData && state.heroData.mmdd;
    if (!day) return;
    state.day = day; state.filter = 'all'; state.q = ''; state.albumId = null; $('q').value = '';
    refreshChips();
    syncRail('onthisday');
    resetList().then(() => toast('那年今日 · ' + day.replace('-', '月') + '日（所有年份）', true));
  });
  $('hero-shuffle').addEventListener('click', () => {
    if (state.items.length) openViewer(Math.floor(Math.random() * state.items.length));
    else toast('先等等，照片还在整理中');
  });

  $('empty-open').addEventListener('click', () => window.sg.invoke('app:openLib'));
  $('empty-scan').addEventListener('click', async () => {
    const r = await window.sg.invoke('lib:rescan');
    toast(`扫描完成：共 ${r.total} 个文件`);
    resetList(); renderHero();
  });
  $('offline-retry').addEventListener('click', async () => {
    const r = await window.sg.invoke('lib:rescan');
    if (r && r.offline) { toast('还是打不开，检查一下硬盘有没有插好'); return; }
    toast(`已恢复：共 ${r.total} 个回忆`, true);
    renderHero(); resetList();
  });
  $('offline-pick').addEventListener('click', async () => {
    const st = await window.sg.invoke('cfg:pickLib');
    if (!st) return;
    state.libDir = st.libDir;
    toast('照片库已切换：' + st.libDir, true);
    renderGreet(st); renderHero(); resetList();
  });

  /* ── 查看器 ── */
  $('v-close').addEventListener('click', closeViewer);
  $('vscrim').addEventListener('click', closeViewer);
  $('v-prev').addEventListener('click', () => stepViewer(-1));
  $('v-next').addEventListener('click', () => stepViewer(1));
  $('v-fav').addEventListener('click', async () => {
    const item = cur(); if (!item) return;
    item.fav = await window.sg.invoke('photo:fav', { id: item.id, on: !item.fav });
    updateVBar(); updateTileFlags(item);
  });
  $('v-star').addEventListener('click', () => {
    $('vstar').hidden = !$('vstar').hidden;
    $('editbar').hidden = true;
  });
  $('vstar').querySelectorAll('button').forEach((b) => {
    b.addEventListener('click', async () => {
      const item = cur(); if (!item) return;
      item.star = await window.sg.invoke('photo:star', { id: item.id, n: +b.dataset.n });
      $('vstar').hidden = true;
      updateVBar(); updateTileFlags(item);
    });
  });
  $('v-album').addEventListener('click', openPick);
  $('v-slideshow').addEventListener('click', () => {
    const item = cur();
    startSlideshow(item ? item.id : null);
  });
  // 放映中：点画面 = 暂停/继续
  $('slideshow').addEventListener('click', () => { if (ss.on) ssTogglePause(); });
  $('v-edit').addEventListener('click', () => {
    const item = cur();
    if (!item || item.kind !== 'photo') { toast('只有照片可以编辑'); return; }
    $('vstar').hidden = true;
    edit.on = true;
    viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
    applyTransform();
    $('editbar').hidden = false;
  });
  $('v-folder').addEventListener('click', () => {
    const item = cur(); if (item) window.sg.invoke('photo:showInFolder', { id: item.id });
  });
  $('v-zoomin').addEventListener('click', () => setZoom(viewer.scale * 1.25));
  $('v-zoomout').addEventListener('click', () => setZoom(viewer.scale / 1.25));
  $('v-zoomfit').addEventListener('click', zoomFit);
  $('v-info').addEventListener('click', () => {
    const panel = $('infopanel');
    const on = panel.classList.toggle('on');
    if (on) fillInfoPanel();
  });
  $('ip-close').addEventListener('click', () => $('infopanel').classList.remove('on'));
  $('v-trash').addEventListener('click', async () => {
    const item = cur(); if (!item) return;
    const ok = await confirmDlg('移入回收站', `「${item.name}」将被移入拾光的回收站，不会立即删除，可随时恢复。`, '移入');
    if (!ok) return;
    await window.sg.invoke('photo:trash', { ids: [item.id] });
    state.items.splice(viewer.idx, 1);
    state.total--;
    state.offset = state.items.length; // 否则下一页会从旧的 offset 取，漏掉一张
    if (!state.items.length) { closeViewer(); await resetList(); }
    else {
      const tile = tileById(item.id);
      if (tile) tile.remove(); // 原地移除，不重建列表
      openViewer(Math.min(viewer.idx, state.items.length - 1));
    }
    toast('已移入回收站');
  });

  /* 编辑面板 */
  const rotateBy = (d) => {
    viewer.rot += d;
    applyTransform();
    if (edit.crop) defaultCrop(); // 几何变了，重置裁剪框，避免旋转后框错位
  };
  $('e-rotl').addEventListener('click', () => rotateBy(-90));
  $('e-rotr').addEventListener('click', () => rotateBy(90));
  $('e-crop').addEventListener('click', () => {
    const item = cur();
    if (!edit.crop && item && NO_CROP_EXTS.includes(item.ext)) {
      toast('HEIC / TIFF 暂不支持裁剪，可以先用旋转或转换格式');
      return;
    }
    edit.crop = !edit.crop;
    $('e-crop').classList.toggle('on', edit.crop);
    if (edit.crop) {
      viewer.scale = 1; viewer.tx = 0; viewer.ty = 0;
      applyTransform();
      $('cropbox').classList.add('on');
      defaultCrop();
      toast('拖动框内移动 · 拖四角缩放 · 在空白处重画');
    } else {
      $('cropbox').classList.remove('on');
      edit.cropRect = null;
    }
  });
  [['e-bri', 'bri'], ['e-con', 'con'], ['e-sat', 'sat']].forEach(([id, key]) => {
    $(id).addEventListener('input', () => {
      edit[key] = parseFloat($(id).value);
      applyEditPreview();
    });
  });
  $('e-reset').addEventListener('click', () => {
    viewer.rot = 0; edit.bri = 1; edit.con = 1; edit.sat = 1; edit.cropRect = null;
    $('e-bri').value = 1; $('e-con').value = 1; $('e-sat').value = 1;
    const el = $('v-media').querySelector('img');
    if (el) el.style.filter = '';
    applyTransform();
    if (edit.crop) { $('cropbox').classList.remove('on'); edit.crop = false; $('e-crop').classList.remove('on'); }
  });
  $('e-cancel').addEventListener('click', exitEditMode);
  $('e-save').addEventListener('click', async () => {
    const item = cur();
    if (!item || item.kind !== 'photo') return;
    const rot = ((viewer.rot % 360) + 360) % 360;
    let crop = null;
    if (edit.crop) {
      crop = cropPayload();
      if (!crop) { toast('裁剪范围太小，请重新拖一个稍大的区域'); return; }
    }
    const changed = rot !== 0 || !!crop || edit.bri !== 1 || edit.con !== 1 || edit.sat !== 1;
    if (!changed) { toast('没有需要保存的修改'); return; }
    const parts = [];
    if (rot) parts.push(`旋转 ${rot}°`);
    if (crop) parts.push(`裁剪 ${crop.width}×${crop.height}`);
    if (edit.bri !== 1 || edit.con !== 1 || edit.sat !== 1) parts.push('调色');
    const ok = await confirmDlg('保存编辑', `将对「${item.name}」应用：${parts.join('、')}，并覆盖原文件。\n原文件会自动备份到回收站，拍摄日期等信息均保留。`, '保存');
    if (!ok) return;
    try {
      const fresh = await window.sg.invoke('photo:edit', {
        id: item.id,
        edit: { rot, crop, brightness: edit.bri, contrast: edit.con, saturation: edit.sat },
      });
      Object.assign(item, fresh, { srcUrl: fresh.srcUrl + '?v=' + Date.now(), thumbUrl: fresh.thumbUrl + '?v=' + Date.now() });
      const idx = viewer.idx;
      exitEditMode();
      await openViewer(idx);
      const tile = tileById(item.id); // 原地刷新缩略图
      if (tile) {
        const ph = tile.querySelector('.ph');
        if (ph && item.hasThumb) ph.style.backgroundImage = `url("${item.thumbUrl}")`;
      }
      toast('编辑已保存，原件备份在回收站', true);
    } catch (e) {
      toast('保存失败：' + e.message);
    }
  });

  /* 裁剪：画新框 / 拖动整体 / 8 个手柄缩放，全部钳制在图像内 */
  let cropDrag = null;
  $('v-stage').addEventListener('pointerdown', (e) => {
    if (!edit.crop || e.button !== 0) return;
    const box = $('cropbox');
    const handle = e.target && e.target.closest ? e.target.closest('.ch') : null;
    if (handle && edit.cropRect) {
      cropDrag = { mode: handle.dataset.h, sx: e.clientX, sy: e.clientY, orig: { ...edit.cropRect } };
    } else if (box && edit.cropRect && box.contains(e.target)) {
      cropDrag = { mode: 'move', sx: e.clientX, sy: e.clientY, orig: { ...edit.cropRect } };
    } else {
      cropDrag = { mode: 'new', sx: e.clientX, sy: e.clientY };
      drawCropRect(e.clientX, e.clientY, e.clientX, e.clientY);
    }
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (!cropDrag) return;
    const d = cropDrag, dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.mode === 'new') { drawCropRect(d.sx, d.sy, e.clientX, e.clientY); return; }
    const o = d.orig;
    if (d.mode === 'move') {
      const g = cropGeom();
      if (g) paintCrop({
        x: Math.min(Math.max(o.x + dx, g.left), Math.max(g.left, g.right - o.w)),
        y: Math.min(Math.max(o.y + dy, g.top), Math.max(g.top, g.bottom - o.h)),
        w: o.w, h: o.h,
      });
      return;
    }
    let x = o.x, y = o.y, w = o.w, h = o.h;
    if (d.mode.includes('w')) { x = o.x + dx; w = o.w - dx; }
    if (d.mode.includes('e')) { w = o.w + dx; }
    if (d.mode.includes('n')) { y = o.y + dy; h = o.h - dy; }
    if (d.mode.includes('s')) { h = o.h + dy; }
    if (w < 12) { if (d.mode.includes('w')) x = o.x + o.w - 12; w = 12; }
    if (h < 12) { if (d.mode.includes('n')) y = o.y + o.h - 12; h = 12; }
    const r = clampCrop({ x, y, w, h });
    if (r) paintCrop(r);
  });
  window.addEventListener('pointerup', () => { cropDrag = null; });

  /* 缩放 & 拖拽（照片与视频都支持缩放；视频拖动会干扰播放控件，只做缩放） */
  $('v-stage').addEventListener('wheel', (e) => {
    const item = cur();
    if (!item || edit.on) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setZoom(viewer.scale * factor);
  }, { passive: false });
  $('v-stage').addEventListener('dblclick', () => {
    if (edit.on) return;
    zoomFit();
  });
  $('v-media').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || edit.on) return;
    viewer.dragging = true; viewer.sx = e.clientX - viewer.tx; viewer.sy = e.clientY - viewer.ty;
    $('v-media').classList.add('dragging'); // 拖拽时关掉过渡，避免橡皮筋
    e.preventDefault();
  });
  window.addEventListener('pointermove', (e) => {
    if (viewer.dragging) {
      viewer.tx = e.clientX - viewer.sx; viewer.ty = e.clientY - viewer.sy;
      applyTransform();
    }
  });
  window.addEventListener('pointerup', () => {
    viewer.dragging = false;
    $('v-media').classList.remove('dragging');
  });

  /* 键盘 */
  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;

    // 引导优先：Enter/→ 下一步，← 上一步，Esc 跳过
    if (tour.on) {
      if (e.key === 'Escape') { e.preventDefault(); endTour(false); return; }
      if (!plain || typing) return;
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (tour.step >= TOUR_STEPS.length - 1) endTour(true); else { tour.step++; tourRender(); }
        return;
      }
      if (e.key === 'ArrowLeft' && tour.step > 0) { e.preventDefault(); tour.step--; tourRender(); return; }
      return;
    }

    // 放映模式优先吃掉键盘
    if (ss.on) {
      if (e.key === 'Escape' || e.key === 's' || e.key === 'S') { e.preventDefault(); stopSlideshow(); return; }
      if (e.key === ' ') { e.preventDefault(); ssTogglePause(); return; }
      if (e.key === 'm' || e.key === 'M') { e.preventDefault(); ssToggleMusic(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); ssShow(ss.idx - 1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); ssShow(ss.idx + 1); return; }
      return;
    }

    if (!$('viewer').hidden) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if ($('infopanel').classList.contains('on')) $('infopanel').classList.remove('on');
        else if (!$('vstar').hidden) $('vstar').hidden = true;
        else if (edit.on) exitEditMode();
        else closeViewer();
        return;
      }
      if (!plain || typing) return;                 // Ctrl+F5 / F12 / 输入框里的按键不拦
      if (e.key === 's' || e.key === 'S') { e.preventDefault(); startSlideshow(cur() ? cur().id : null); return; }
      const handled = ['ArrowLeft', 'ArrowRight', '+', '=', '-', '_', '0', ' ', 'Delete', 'f', 'F', 'i', 'I'];
      if (!handled.includes(e.key)) return;          // 其余键交还系统（刷新、DevTools…）
      e.preventDefault();
      if (e.key === 'ArrowLeft') stepViewer(-1);
      else if (e.key === 'ArrowRight') stepViewer(1);
      else if (e.key === ' ') togglePlay();
      else if (e.key === 'f' || e.key === 'F') $('v-fav').click();
      else if (e.key === 'i' || e.key === 'I') $('v-info').click();
      else if (e.key === '+' || e.key === '=') setZoom(viewer.scale * 1.25);
      else if (e.key === '-' || e.key === '_') setZoom(viewer.scale / 1.25);
      else if (e.key === '0') zoomFit();
      else if (e.key === 'Delete') $('v-trash').click();
      return;
    }

    if (e.key === 'Escape') {
      if (closeTopModal()) { e.preventDefault(); return; }
      if (tl.open) { toggleTimeline(false, true); e.preventDefault(); return; }
      if (document.activeElement === $('q')) {
        $('q').value = ''; state.q = ''; refreshChips(); resetList(); e.preventDefault();
      }
      return;
    }
    if (typing || !plain) return;
    if (e.key === '/') { e.preventDefault(); $('q').focus(); return; }
    if (openModalId()) return;                 // 有模态框时不要穿透到时间轴快捷键
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); toggleTimeline(undefined, true); return; }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); startSlideshow(null); return; }
    if (tl.open) {
      if (e.key === 'ArrowLeft') { tlStep(-1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { tlStep(1); e.preventDefault(); }
      else if (e.key === 'Enter') { tlJumpPicked(); e.preventDefault(); }
    }
  });

  /* ── 模态 ── */
  $('set-close').addEventListener('click', () => { $('settings').hidden = true; });
  $('alb-close').addEventListener('click', () => { $('albums').hidden = true; });
  $('pick-close').addEventListener('click', () => { $('albumpick').hidden = true; });
  $('trash-close').addEventListener('click', () => { $('trash').hidden = true; });
  ['settings', 'albums', 'albumpick', 'trash', 'confirm', 'inputdlg'].forEach((id) => {
    $(id).addEventListener('click', (e) => {
      if (e.target === $(id) && id !== 'confirm' && id !== 'inputdlg') $(id).hidden = true;
    });
  });

  /* 设置动作 */
  $('set-pick').addEventListener('click', async () => {
    const st = await window.sg.invoke('cfg:pickLib');
    if (st) {
      state.libDir = st.libDir;
      toast('照片库已切换：' + st.libDir, true);
      $('settings').hidden = true;
      renderGreet(st); renderHero(); resetList();
    }
  });
  $('set-openlib').addEventListener('click', () => window.sg.invoke('app:openLib'));
  $('set-rescan').addEventListener('click', async () => {
    toast('开始扫描…');
    const r = await window.sg.invoke('lib:rescan');
    if (r && r.offline) toast('照片库路径打不开，已保留原有索引');
    else toast(`扫描完成：新增 ${r.added} · 移除 ${r.removed} · 共 ${r.total}`, true);
    $('settings').hidden = true;
    renderHero(); resetList();
  });
  $('set-data').addEventListener('click', () => window.sg.invoke('app:openData'));
  $('set-tour').addEventListener('click', startTour);
  $('tour-close').addEventListener('click', () => endTour(false));
  $('tour-prev').addEventListener('click', () => { if (tour.step > 0) { tour.step--; tourRender(); } });
  $('tour-next').addEventListener('click', () => {
    if (tour.step >= TOUR_STEPS.length - 1) endTour(true);
    else { tour.step++; tourRender(); }
  });
  $('set-immersive').addEventListener('change', async () => {
    state.ui = await window.sg.invoke('ui:set', { immersive: $('set-immersive').checked });
    if (!state.ui.immersive) wakeFn(10);
    toast(state.ui.immersive ? '沉浸模式已开启' : '界面将保持常显');
  });
  $('set-idle').addEventListener('change', async () => {
    state.ui = await window.sg.invoke('ui:set', { idleMs: parseInt($('set-idle').value, 10) });
    wakeFn();
  });
  $('set-tlauto').addEventListener('change', async () => {
    state.ui = await window.sg.invoke('ui:set', { tlAutoJump: $('set-tlauto').checked });
    if (tl.open) tlRender();
    toast(state.ui.tlAutoJump === false ? '时间轴：松手后需点「跳到这里」' : '时间轴：松手直接跳转');
  });
  $('set-tlopen').addEventListener('change', async () => {
    const on = $('set-tlopen').checked;
    state.ui = await window.sg.invoke('ui:set', { tlOpen: on });
    if (on !== tl.open) await toggleTimeline(on);
    toast(on ? '以后启动会自动展开时间轴' : '以后启动不再展开时间轴');
  });
  $('set-ssmusic').addEventListener('change', async () => {
    state.ui = await window.sg.invoke('ui:set', { ssMusic: $('set-ssmusic').checked });
    toast(state.ui.ssMusic === false ? '放映时不再播放背景音乐' : '放映时会播放背景音乐');
  });

  /* 相册动作 */
  $('alb-new').addEventListener('click', async () => {
    const name = $('alb-name').value.trim();
    if (!name) { toast('先输入相册名称'); return; }
    await window.sg.invoke('album:create', { name });
    $('alb-name').value = '';
    refreshAlbums();
  });
  $('alb-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('alb-new').click(); });

  /* 回收站动作 */
  $('trash-empty').addEventListener('click', async () => {
    const ok = await confirmDlg('清空回收站', '回收站里的所有文件（含编辑前备份）将被永久删除，无法恢复。', '永久删除');
    if (!ok) return;
    await window.sg.invoke('trash:empty');
    toast('回收站已清空');
    refreshTrash(); resetList();
  });

  /* ── 主进程事件 ── */
  window.sg.on('lib:state', (st) => {
    state.smoke = !!st.smoke;
    state.libDir = st.libDir || state.libDir;
    if (st.ui) state.ui = st.ui;
    state.lastStats = st;
    renderGreet(st);
    // 库里数量变了 → 时间轴的直方图要重算（打开状态下才刷新，避免无谓请求）
    if (tl.open && st.count !== state.lastCount) {
      tlLoadHist(true).then(() => { tlBuild(); tlRender(); }).catch(() => {});
    } else if (tl.open) {
      tlDrawViewport();
    }
    if (state.lastCount >= 0 && st.count !== state.lastCount && state.firstLoaded
        && $('viewer').hidden && $('settings').hidden && $('trash').hidden && $('albums').hidden) {
      // 库有增删时刷新列表，但保住滚动位置
      const sc = $('scroll'); const y = sc.scrollTop;
      resetList().then(() => { sc.scrollTop = Math.min(y, sc.scrollHeight); });
    }
    state.lastCount = st.count;
  });
  window.sg.on('lib:thumb', (p) => { if (p && p.id) patchThumb(p.id); });
  window.sg.on('lib:thumbs-done', () => {
    // 预热结束：只补这一屏还是骨架的卡片（其余早就逐个补过了）
    document.querySelectorAll('.tile.nothumb').forEach((t) => patchThumb(t.dataset.id));
  });
  window.sg.on('win:max-state', (on) => {
    $('w-max').innerHTML = icon(on ? 'maximize-2' : 'square');
    $('w-max').setAttribute('aria-label', on ? '还原' : '最大化');
  });
  // 用户用系统方式退出全屏（F11 / Esc）时，放映也要跟着收
  window.sg.on('win:fullscreen-state', (on) => { if (!on && ss.on) stopSlideshow(); });
  window.sg.on('lib:progress', (p) => {
    const bar = $('progressbar');
    if (!p.total) { bar.classList.remove('on'); return; }
    bar.classList.add('on');
    bar.style.width = Math.round((p.done / p.total) * 100) + '%';
    if (p.done >= p.total) setTimeout(() => { bar.classList.remove('on'); bar.style.width = '0'; }, 800);
  });
  window.sg.on('lib:error', (msg) => toast('出错了：' + msg));

  /* 初始状态 */
  try {
    const st = await window.sg.invoke('cfg:get');
    state.smoke = !!st.smoke;
    state.libDir = st.libDir;
    state.lastCount = st.count;
    state.lastStats = st;
    if (st.ui) state.ui = st.ui;
    if (state.smoke) state.pageSize = 5; // 冒烟模式：小分页，强制走多页/跨月路径
    renderGreet(st);
  } catch (e) { /* 稍后通过事件刷新 */ }
  renderHero();
  await loadPage();
  // 默认展开时间轴（设置 → 时间轴 → 启动时显示 可以关掉）。
  // 延后一拍，等首批卡片落位后再定位，锚点才准。
  if (state.ui.tlOpen !== false) {
    setTimeout(() => { toggleTimeline(true).catch(() => {}); }, 160);
  }
  // 首次使用引导：只出现一次；之后在 设置 → 功能引导 重看
  if (state.ui.tourDone === false) {
    setTimeout(() => { if (!tour.on && $('viewer').hidden) startTour(); }, 700);
  }
}

document.addEventListener('DOMContentLoaded', init);
