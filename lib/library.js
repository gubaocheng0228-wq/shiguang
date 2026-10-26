'use strict';
/**
 * 拾光 · 照片库数据引擎 v3
 * v3 变更：EXIF 方向烘焙 + 元数据保留、缩略图优先级队列、视频时长异步探测、
 *         恢复防覆盖、低频备份、退出 flush、720px 缩略图。
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.heif']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm', '.3gp', '.mts', '.m2ts']);
const THUMB_SIZE = 720;

let exifParser = null;
try {
  const m = require('exif-reader');
  exifParser = m.default || m;
} catch (e) { /* 稍后动态加载 */ }
let heicDecodeAll = null;

/** 优先本地新版 ffmpeg（bin/），否则用 @ffmpeg-installer 的内置版本 */
let ffPathCached = undefined;
function ffmpegPath() {
  if (ffPathCached !== undefined) return ffPathCached;
  const local = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
  ffPathCached = fs.existsSync(local) ? local : null;
  if (!ffPathCached) {
    try { ffPathCached = require('@ffmpeg-installer/ffmpeg').path; } catch (e) { ffPathCached = ''; }
  }
  return ffPathCached;
}

function hashId(absPath) {
  return crypto.createHash('sha1').update(absPath.toLowerCase()).digest('hex');
}

function walk(dir, out, exts) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return out; }
  for (const ent of entries) {
    if (ent.name.startsWith('.') || ent.name === '__MACOSX' || ent.name === 'Thumbs.db') continue;
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out, exts);
    else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (exts.has(ext)) out.push(abs);
    }
  }
  return out;
}

function exifDate(d) {
  if (d instanceof Date && !isNaN(d)) return d.getTime();
  if (typeof d === 'string') {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(d);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }
  return null;
}

function digitsOf(s) { return String(s).replace(/[^0-9]/g, ''); }

/**
 * 数字搜索按"前缀/整段"匹配，而不是全串 includes——
 * 旧实现里输入 "12" 会命中 2012 年、12 月、12 日，噪音极大。
 * 规则：8 位=年月日全等；5-7 位=年月日前缀；4 位=年份全等或月日全等；
 *       3 位=月日的前/后缀；2 位=月或日全等；1 位不参与日期匹配。
 */
function dateMatch(dateMs, qd) {
  if (!qd) return false;
  const d = new Date(dateMs);
  const y = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const ymd = y + mm + dd;
  const mmdd = mm + dd;
  switch (qd.length) {
    case 8: return ymd === qd;
    case 7:
    case 6:
    case 5: return ymd.startsWith(qd);
    case 4: return y === qd || mmdd === qd;
    case 3: return mmdd.startsWith(qd) || mmdd.endsWith(qd);
    case 2: return mm === qd || dd === qd;
    default: return false;
  }
}

/** 备份间隔（毫秒）：索引每次保存都复制 .bak 会放大 I/O，降频到 10 分钟 */
const BAK_INTERVAL = 10 * 60 * 1000;
const lastBak = new Map();

function atomicWrite(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  const now = Date.now();
  if (now - (lastBak.get(file) || 0) > BAK_INTERVAL) {
    try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); lastBak.set(file, now); } catch (e) { /* 忽略 */ }
  }
  fs.renameSync(tmp, file);
}

function readJsonSafe(file) {
  for (const f of [file, file + '.bak']) {
    try { return { data: JSON.parse(fs.readFileSync(f, 'utf8')), from: f }; } catch (e) { /* 尝试下一个 */ }
  }
  return null;
}

function runFF(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const exe = ffmpegPath();
    if (!exe) return resolve({ ok: false });
    let done = false;
    const p = spawn(exe, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (b) => { err += b.toString(); });
    p.on('error', () => { if (!done) { done = true; resolve({ ok: false }); } });
    p.on('close', (code) => { if (!done) { done = true; resolve({ ok: code === 0, err }); } });
    setTimeout(() => {
      if (!done) { done = true; try { p.kill(); } catch (e) { /* 忽略 */ } resolve({ ok: false, err }); }
    }, timeoutMs);
  });
}

/**
 * 一次 ffmpeg -i 同时拿到 时长 / 宽高 / 拍摄时间（creation_time）。
 * 旧实现只为拿时长跑一次，宽高永远是 0（网格里所有视频都按 16:9 排版），
 * 日期也只会退回文件修改时间——而手机视频的 mp4 里其实写着真实拍摄时间。
 */
async function ffVideoMeta(file) {
  const r = await runFF(['-i', file], 15000);
  const err = r.err || '';
  const out = { duration: 0, w: 0, h: 0, createdMs: null, readable: /Stream #|Duration:/.test(err) };
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  if (dur) out.duration = (+dur[1]) * 3600 + (+dur[2]) * 60 + (+dur[3]);
  const vs = /Stream #\d+:\d+.*?: Video:.*?(\d{2,5})x(\d{2,5})/.exec(err);
  if (vs) { out.w = +vs[1]; out.h = +vs[2]; }
  const ct = /creation_time\s*:\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?/.exec(err);
  if (ct) {
    // ffmpeg 输出的 creation_time 是 UTC，补 Z 再交给 Date 转本地时间
    const t = Date.parse(ct[1].replace(' ', 'T') + 'Z');
    if (isFinite(t)) out.createdMs = t;
  }
  return out;
}

/** 带优先级的任务池：当前页缩略图插队，后台预热排队 */
class Pool {
  constructor(n) { this.n = n; this.running = 0; this.hi = []; this.lo = []; }
  run(fn, priority) {
    return new Promise((resolve, reject) => {
      (priority ? this.hi : this.lo).push({ fn, resolve, reject });
      this._next();
    });
  }
  _next() {
    while (this.running < this.n) {
      const job = this.hi.shift() || this.lo.shift();
      if (!job) break;
      this.running++;
      job.fn().then(job.resolve, job.reject).finally(() => { this.running--; this._next(); });
    }
  }
}

class Library extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.thumbsDir = path.join(dataDir, 'thumbs');
    this.previewDir = path.join(dataDir, 'preview');
    this.trashDir = path.join(dataDir, 'trash');
    this.trashThumbsDir = path.join(this.trashDir, 'thumbs');
    this.configPath = path.join(dataDir, 'config.json');
    this.indexPath = path.join(dataDir, 'index.json');
    this.albumsPath = path.join(dataDir, 'albums.json');
    this.trashIndexPath = path.join(this.trashDir, 'entries.json');
    this.photos = new Map();
    this.fav = new Set();
    this.stars = new Map();
    this.albums = [];
    this.trashEntries = [];
    this.config = { libDir: '', ui: { immersive: true, idleMs: 2600, tlOpen: true, tlAutoJump: true, ssMusic: true, tourDone: false } };
    this._pool = new Pool(Math.max(2, Math.min(4, Math.floor((os.cpus() || []).length / 2) || 2)));
    this._saveTimer = null;
    this._watcher = null;
    this._watchTimer = null;
    this._nativeImage = null;
    this._sorted = null;
    this._hist = null;
    this.ready = false;
    /** 照片库目录是否可用（U 盘/移动硬盘拔掉时不做任何删除，只提示） */
    this.libAvailable = false;
    /** 缩略图失败负缓存：id -> 时间戳（避免坏文件被反复重试） */
    this._thumbFail = new Map();
    this._thumbFailTtl = 10 * 60 * 1000;
  }

  async init(opts = {}) {
    fs.mkdirSync(this.thumbsDir, { recursive: true });
    fs.mkdirSync(this.previewDir, { recursive: true });
    fs.mkdirSync(this.trashThumbsDir, { recursive: true });
    const cfgLoaded = readJsonSafe(this.configPath);
    if (cfgLoaded) this.config = { ...this.config, ...cfgLoaded.data, ui: { ...this.config.ui, ...(cfgLoaded.data.ui || {}) } };
    const idxLoaded = readJsonSafe(this.indexPath);
    if (idxLoaded) {
      for (const r of idxLoaded.data.photos || []) this.photos.set(r.id, r);
      this.fav = new Set(idxLoaded.data.fav || []);
      this.stars = new Map(Object.entries(idxLoaded.data.stars || {}));
      try {
        if (!fs.existsSync(this.indexPath + '.bak') && fs.existsSync(this.indexPath)) {
          fs.copyFileSync(this.indexPath, this.indexPath + '.bak');
        }
      } catch (e) { /* 忽略 */ }
    }
    const albLoaded = readJsonSafe(this.albumsPath);
    if (albLoaded) this.albums = albLoaded.data.albums || albLoaded.data || [];
    if (!Array.isArray(this.albums)) this.albums = [];
    const trLoaded = readJsonSafe(this.trashIndexPath);
    if (trLoaded) this.trashEntries = trLoaded.data || [];

    if (!exifParser) {
      try { exifParser = (await import('exif-reader')).default; } catch (e) { /* 无 EXIF 能力 */ }
    }
    if (!heicDecodeAll) {
      try { heicDecodeAll = require('heic-decode').all; } catch (e) { /* 无 HEIC 兜底 */ }
    }
    try { this._nativeImage = require('electron').nativeImage; } catch (e) { /* 非 Electron 环境 */ }

    // 关键：已配置的库目录不存在时（移动硬盘拔了 / 盘符被占用）绝不能改写配置，
    // 否则紧接着的扫描会把索引当成"全部已删除"，收藏和星级被 pruneOverlays 一起清掉。
    if (this.config.libDir) {
      this.libAvailable = fs.existsSync(this.config.libDir);
    } else if (opts.defaultLibDir) {
      try {
        fs.mkdirSync(opts.defaultLibDir, { recursive: true });
        this.config.libDir = opts.defaultLibDir;
        this.libAvailable = true;
        this._saveConfig();
      } catch (e) { this.config.libDir = ''; this.libAvailable = false; }
    }
    this.pruneOverlays();
    this.ready = true;
  }

  get libDir() { return this.config.libDir; }

  _saveConfig() {
    try { atomicWrite(this.configPath, JSON.stringify(this.config, null, 2)); } catch (e) { /* 忽略 */ }
  }

  get ui() { return { ...this.config.ui }; }
  setUi(patch) {
    this.config.ui = { ...this.config.ui, ...patch };
    this._saveConfig();
    return this.ui;
  }

  async setLibDir(dir) {
    if (!dir || !fs.existsSync(dir)) throw new Error('目录不存在');
    this.config.libDir = dir;
    this.libAvailable = true;
    this._saveConfig();
    this.photos.clear();
    this._sorted = null;
    this.save();
    await this.rescanAll(true);
    return this.publicState();
  }

  pruneOverlays() {
    const valid = new Set(this.photos.keys());
    for (const e of this.trashEntries) valid.add(e.id);
    let dirty = false;
    for (const id of Array.from(this.fav)) { if (!valid.has(id)) { this.fav.delete(id); dirty = true; } }
    for (const id of Array.from(this.stars.keys())) { if (!valid.has(id)) { this.stars.delete(id); dirty = true; } }
    if (dirty) this.save();
  }

  /* ── 扫描 ── */
  async rescanAll(force = false) {
    if (!this.libDir) return { added: 0, updated: 0, removed: 0, total: this.photos.size, offline: true };
    if (!fs.existsSync(this.libDir)) {
      // 库目录暂时不可用：保留索引/收藏/缩略图，只把状态标成离线，绝不删除任何记录
      const was = this.libAvailable;
      this.libAvailable = false;
      this.emit('progress', { phase: 'scan', done: 0, total: 0 });
      if (was) this.emit('changed');
      return { added: 0, updated: 0, removed: 0, total: this.photos.size, offline: true };
    }
    this.libAvailable = true;
    const files = walk(this.libDir, [], new Set([...PHOTO_EXTS, ...VIDEO_EXTS]));
    const byPath = new Map();
    for (const rec of this.photos.values()) byPath.set(rec.path, rec);
    let added = 0, updated = 0, done = 0;
    const freshRecs = [];   // 本轮新增的记录（用于改名/移动检测）

    for (const abs of files) {
      done++;
      if (done % 200 === 0) this.emit('progress', { phase: 'scan', done, total: files.length });
      // 每 40 个文件让出一次事件循环：大库扫描时界面/IPC 不被同步逻辑长时间占住
      if (done % 40 === 0) await new Promise((r) => setImmediate(r));
      let st;
      try { st = fs.statSync(abs); } catch (e) { continue; }
      const sig = `${st.size}-${Math.floor(st.mtimeMs / 1000)}`;
      const old = byPath.get(abs);
      if (old && !force && old.sig === sig) { byPath.delete(abs); continue; }
      const rec = await this._processFile(abs, st, { skipVideoProbe: true });
      if (rec) {
        this.photos.set(rec.id, rec);
        if (old) updated++; else { added++; freshRecs.push(rec); }
      }
      byPath.delete(abs);
    }

    /* ── 改名 / 移动检测 ──
     * id 是基于路径的哈希，文件一改名就等于"旧的消失 + 新的出现"，收藏/星级/相册归属会全丢。
     * 这里用「大小 + 修改时间（秒） + 扩展名」在新增记录里找唯一对应，
     * 命中就把旧 id 与缩略图迁移过去；条件不唯一时宁可不迁移，避免张冠李戴。 */
    let renamed = 0;
    if (byPath.size && freshRecs.length) {
      const pool = new Map();
      for (const r of freshRecs) {
        const key = `${r.size}|${Math.round(r.mtimeMs / 1000)}|${r.ext}`;
        if (!pool.has(key)) pool.set(key, []);
        pool.get(key).push(r);
      }
      for (const [oldPath, stale] of Array.from(byPath.entries())) {
        const key = `${stale.size}|${Math.round(stale.mtimeMs / 1000)}|${stale.ext}`;
        const cands = pool.get(key);
        if (!cands || cands.length !== 1) continue;      // 只在唯一匹配时迁移，避免张冠李戴
        const next = cands[0];
        pool.delete(key);
        // 用旧 id 接管新路径：收藏/星级/相册都按旧 id 存，原地保留
        this.photos.delete(next.id);
        try {
          const tp = this.thumbPath(next.id);
          if (fs.existsSync(tp)) fs.renameSync(tp, this.thumbPath(stale.id));
        } catch (e) { /* 缩略图迁不动就让它重新生成 */ }
        stale.path = next.path;
        stale.name = next.name;
        stale.sig = next.sig;
        stale.mtimeMs = next.mtimeMs;
        stale.size = next.size;
        byPath.delete(oldPath);        // 从"待删除"里移除
        renamed++;
        added--;
      }
    }

    let removed = 0;
    for (const stale of byPath.values()) { this.photos.delete(stale.id); removed++; }
    this._sorted = null;
    // 缩略图已经存在的记录，broken 标记一律清掉（旧版本/临时故障留下的脏标记）
    for (const rec of this.photos.values()) {
      if (rec.broken && fs.existsSync(this.thumbPath(rec.id))) rec.broken = false;
    }
    this.pruneOverlays();
    this.pruneThumbs();
    this.save();
    this.emit('changed');
    this.emit('progress', { phase: 'scan', done: files.length, total: files.length });
    this.warmThumbs();
    this.probeVideos(); // 异步补 时长/宽高/拍摄时间，不阻塞扫描
    return { added, updated, removed, renamed, total: this.photos.size, offline: false };
  }

  async _processFile(abs, st, opts = {}) {
    const ext = path.extname(abs).toLowerCase();
    const kind = PHOTO_EXTS.has(ext) ? 'photo' : 'video';
    const rec = {
      id: hashId(abs),
      path: abs,
      name: path.basename(abs),
      ext,
      kind,
      size: st.size,
      mtimeMs: st.mtimeMs,
      sig: `${st.size}-${Math.floor(st.mtimeMs / 1000)}`,
      w: 0, h: 0, orientation: 1, cam: '', gps: null, duration: 0,
      dateMs: st.mtimeMs, dateSource: 'file',
    };
    if (kind === 'video') {
      if (!opts.skipVideoProbe) rec.duration = 0; // 时长统一异步探测
    } else if (exifParser) {
      try {
        const sharp = require('sharp');
        const meta = await sharp(abs, { failOn: 'none' }).metadata();
        if (meta.width) rec.w = meta.width;
        if (meta.height) rec.h = meta.height;
        if (meta.orientation) rec.orientation = meta.orientation;
        if (meta.exif) {
          const exif = exifParser(meta.exif);
          const t = exifDate(exif?.Photo?.DateTimeOriginal) || exifDate(exif?.Photo?.DateTime) || exifDate(exif?.Image?.DateTime);
          if (t) { rec.dateMs = t; rec.dateSource = 'exif'; }
          const make = exif?.Image?.Make, model = exif?.Image?.Model;
          rec.cam = [make, model].filter(Boolean).join(' ').trim();
          const rat = (v) => {
            if (typeof v === 'number') return v;
            if (Array.isArray(v) && v.length >= 2 && v[1]) return v[0] / v[1];
            return null;
          };
          const ph = exif?.Photo || {};
          const iso = ph.ISOSpeedRatings ?? ph.ISOSpeed ?? null;
          const fnum = rat(ph.FNumber);
          const exposure = rat(ph.ExposureTime);
          const focal = rat(ph.FocalLength);
          if (iso || fnum || exposure || focal) {
            rec.exif = { iso, fnum, exposure, focal };
          }
          const g = exif?.gps || exif?.GPSInfo;
          if (g && Array.isArray(g.GPSLatitude) && Array.isArray(g.GPSLongitude)) {
            const dec = (a) => a[0] + (a[1] || 0) / 60 + (a[2] || 0) / 3600;
            let lat = dec(g.GPSLatitude), lon = dec(g.GPSLongitude);
            if (g.GPSLatitudeRef === 'S') lat = -lat;
            if (g.GPSLongitudeRef === 'W') lon = -lon;
            if (isFinite(lat) && isFinite(lon)) rec.gps = [lat, lon];
          }
        }
      } catch (e) { /* 按普通文件处理 */ }
    }
    return rec;
  }

  /**
   * 视频元数据后台补齐：一次 ffmpeg 拿到 时长 + 宽高 + creation_time。
   * 旧版只补时长，导致视频宽高恒为 0（网格全部 16:9）、日期只能吃文件修改时间。
   * 整批结束后只落盘一次，避免 400+ 次 debounce 写盘。
   */
  probeVideos() {
    const pending = Array.from(this.photos.values()).filter((r) => r.kind === 'video'
      && (!r.duration || !r.w || !r.h || (!r.probed && r.dateSource === 'file')));
    if (!pending.length) return;
    let dirty = false;
    let left = pending.length;
    const finish = () => {
      if (--left > 0) return;
      if (dirty) { this._sorted = null; this.save(); this.emit('changed'); }
    };
    pending.forEach((rec) => {
      this._pool.run(async () => {
        const m = await ffVideoMeta(rec.path);
        const cur = this.photos.get(rec.id);
        if (!cur) return;
        if (m.duration > 0) { cur.duration = m.duration; dirty = true; }
        if (m.w && m.h && (cur.w !== m.w || cur.h !== m.h)) { cur.w = m.w; cur.h = m.h; dirty = true; }
        if (m.createdMs && cur.dateSource === 'file') {
          cur.dateMs = m.createdMs;
          cur.dateSource = 'meta';
          dirty = true;
        }
        if (m.readable) { cur.probed = true; dirty = true; }
        else { cur.broken = true; dirty = true; }
      }).catch(() => {}).finally(finish);
    });
  }

  /** 清理无主缩略图（历史版本/冒烟测试/已彻底删除的照片留下的 .jpg） */
  pruneThumbs() {
    try {
      const valid = new Set(this.photos.keys());
      for (const e of this.trashEntries) {
        if (e.thumbPath) valid.add(path.basename(e.thumbPath, path.extname(e.thumbPath)));
      }
      let removed = 0;
      for (const dir of [this.thumbsDir, this.previewDir]) {
        let names = [];
        try { names = fs.readdirSync(dir); } catch (e) { continue; }
        for (const f of names) {
          if (!/\.jpe?g$/i.test(f)) continue;
          const id = f.replace(/\.[^.]+$/, '');
          if (valid.has(id)) continue;
          try { fs.unlinkSync(path.join(dir, f)); removed++; } catch (e) { /* 忽略 */ }
        }
      }
      return removed;
    } catch (e) { return 0; }
  }

  /* ── 大图预览 ──
   * Chromium 不认 HEIC/HEIF/TIFF：这类格式按需转成 JPEG 缓存后再给前端，
   * 其余格式直接返回原图（避免多一次解码和一份副本）。
   */
  needsPreview(ext) { return ext === '.heic' || ext === '.heif' || ext === '.tif' || ext === '.tiff'; }

  previewPath(id) {
    const rec = this.photos.get(id);
    if (!rec || rec.kind !== 'photo') return Promise.resolve(null);
    if (!this.needsPreview(rec.ext)) return Promise.resolve(rec.path);
    const out = path.join(this.previewDir, id + '.jpg');
    if (fs.existsSync(out)) return Promise.resolve(out);
    if (!this._previewJobs) this._previewJobs = new Map();
    if (!this._previewJobs.has(id)) {
      const job = this._pool.run(() => this._makePreview(rec), true)
        .finally(() => this._previewJobs.delete(id));
      this._previewJobs.set(id, job);
    }
    return this._previewJobs.get(id);
  }

  async _makePreview(rec) {
    const out = path.join(this.previewDir, rec.id + '.jpg');
    const MAX = 2560;
    try {
      const sharp = require('sharp');
      await sharp(rec.path, { failOn: 'none' })
        .rotate()
        .resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(out);
      return out;
    } catch (e) { /* 继续用 wasm 兜底 */ }
    if (heicDecodeAll) {
      try {
        const sharp = require('sharp');
        const img = await heicDecodeAll({ buffer: await fsp.readFile(rec.path) });
        await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
          .resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toFile(out);
        return out;
      } catch (e) { /* 放弃 */ }
    }
    return null;
  }

  removeByPath(abs) {
    const id = hashId(abs);
    const had = this.photos.delete(id);
    if (had) { this._sorted = null; this.save(); this.emit('changed'); }
    return had;
  }

  /* ── 缩略图 ── */
  thumbPath(id) { return path.join(this.thumbsDir, id + '.jpg'); }

  ensureThumb(id, priority) {
    const rec = this.photos.get(id);
    if (!rec) return Promise.resolve(null);
    const p = this.thumbPath(id);
    if (fs.existsSync(p)) return Promise.resolve(p);
    // 负缓存：坏文件/不支持的格式 10 分钟内不重复起 ffmpeg
    const failedAt = this._thumbFail.get(id);
    if (failedAt && Date.now() - failedAt < this._thumbFailTtl) return Promise.resolve(null);
    if (!this._thumbJobs) this._thumbJobs = new Map();
    if (!this._thumbJobs.has(id)) {
      const job = this._pool.run(() => this._makeThumb(rec), priority)
        .then((out) => {
          if (out) {
            this._thumbFail.delete(id);
            rec.broken = false;
            // 通知渲染层：这张卡的缩略图就绪，前端就地补背景，不必整列表重排
            this.emit('thumb', { id });
          } else {
            this._thumbFail.set(id, Date.now());
            rec.broken = true;
          }
          return out;
        })
        .finally(() => this._thumbJobs.delete(id));
      this._thumbJobs.set(id, job);
    }
    return this._thumbJobs.get(id);
  }

  async _makeThumb(rec) {
    const out = this.thumbPath(rec.id);
    if (rec.kind === 'video') {
      try {
        const at = rec.duration > 10 ? Math.min(rec.duration * 0.1, 10) : Math.min(Math.max(rec.duration * 0.5, 0.2), 1);
        const r = await runFF(['-ss', String(at), '-i', rec.path, '-frames:v', '1',
          '-vf', `scale='min(${THUMB_SIZE},iw)':-2`, '-q:v', '4', '-y', out], 25000);
        if (r.ok && fs.existsSync(out)) return out;
      } catch (e) { /* 落到失败 */ }
      return null;
    }
    try {
      const sharp = require('sharp');
      await sharp(rec.path, { failOn: 'none' })
        .rotate()
        .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toFile(out);
      return out;
    } catch (e) { /* 继续 */ }
    if (heicDecodeAll && (rec.ext === '.heic' || rec.ext === '.heif' || rec.ext === '.avif')) {
      try {
        const sharp = require('sharp');
        const img = await heicDecodeAll({ buffer: await fsp.readFile(rec.path) });
        await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } })
          .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 }).toFile(out);
        return out;
      } catch (e) { /* 继续 */ }
    }
    try {
      if (this._nativeImage) {
        const img = this._nativeImage.createFromPath(rec.path);
        if (!img.isEmpty()) {
          const size = img.getSize();
          // nativeImage.resize 只接受对象；旧代码传数字，异常被吞掉 → 这个兜底从来没生效过
          const target = Math.min(480, size.width || 480);
          const small = target && target < (size.width || 0)
            ? img.resize({ width: target, quality: 'good' })
            : img;
          fs.writeFileSync(out, small.toJPEG(80));
          return out;
        }
      }
    } catch (e) { /* 放弃 */ }
    return null;
  }

  async warmThumbs() {
    const missing = [];
    for (const rec of this.photos.values()) {
      if (!fs.existsSync(this.thumbPath(rec.id))) missing.push(rec.id);
    }
    if (!missing.length) {
      this.emit('progress', { phase: 'thumbs', done: 0, total: 0 });
      this.emit('thumbs-done');
      return;
    }
    let done = 0;
    this.emit('progress', { phase: 'thumbs', done: 0, total: missing.length });
    await Promise.all(missing.map((id) => this.ensureThumb(id).then(() => {
      done++;
      if (done % 10 === 0 || done === missing.length) this.emit('progress', { phase: 'thumbs', done, total: missing.length });
    })));
    // 批量预热结束后通知一次：渲染层可以一次性补上漏掉的卡片
    this.emit('thumbs-done');
  }

  /* ── 查询 ── */
  _sortedList() {
    if (!this._sorted) {
      this._sorted = Array.from(this.photos.values());
      this._sorted.sort((a, b) => (b.dateMs - a.dateMs) || (b.mtimeMs - a.mtimeMs));
    }
    return this._sorted;
  }

  /** 把筛选条件抽出来：query / locate / 时间轴定位共用一套规则，避免序号错位 */
  _filterList(opts = {}) {
    const { filter = 'all', q = '', year = null, month = null, day = null, albumId = null } = opts;
    let list = this._sortedList();
    if (filter === 'fav') list = list.filter((r) => this.fav.has(r.id));
    if (filter === 'video') list = list.filter((r) => r.kind === 'video');
    if (year) list = list.filter((r) => new Date(r.dateMs).getFullYear() === year);
    if (month) list = list.filter((r) => new Date(r.dateMs).getMonth() + 1 === month);
    if (day) {
      list = list.filter((r) => {
        const d = new Date(r.dateMs);
        return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') === day;
      });
    }
    if (albumId) {
      const alb = this.albums.find((a) => a.id === albumId);
      const ids = new Set(alb ? alb.photoIds : []);
      list = list.filter((r) => ids.has(r.id));
    }
    if (q) {
      const text = String(q).toLowerCase();
      const qd = digitsOf(q);
      list = list.filter((r) =>
        r.name.toLowerCase().includes(text) ||
        r.path.toLowerCase().includes(text) ||
        (qd.length >= 2 && dateMatch(r.dateMs, qd))
      );
    }
    return list;
  }

  /** 时间倒序数组里二分：找到「该时间点及其之后最新的那一条」 */
  _locateIn(list, dateMs) {
    const t = Number(dateMs);
    if (!list.length) return { index: 0, total: 0, id: null };
    if (!isFinite(t)) return { index: 0, total: list.length, id: list[0].id };
    let lo = 0, hi = list.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].dateMs <= t) { ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    if (ans < 0) ans = list.length - 1;         // 比库里任何一条都早 → 落到最早那张
    return { index: ans, total: list.length, id: list[ans] ? list[ans].id : null };
  }

  /** 时间轴跳转：返回目标在当前筛选结果里的序号（O(log n)，不用逐页翻） */
  locate(opts = {}) {
    return this._locateIn(this._filterList(opts), opts.dateMs);
  }

  /** 时间轴拖动预览：给出某个时间点附近最多 N 条 */
  async around(opts = {}) {
    const { dateMs, limit = 3 } = opts;
    const list = this._sortedList();
    if (!list.length) return { items: [] };
    const loc = this._locateIn(list, dateMs);
    const n = Math.max(1, Math.min(6, limit));
    const start = Math.max(0, Math.min(list.length - n, loc.index - 1));
    const items = list.slice(start, start + n).map((r) => this._wire(r));
    await Promise.all(items.filter((i) => i.kind === 'photo').map((i) => this.ensureThumb(i.id, true)));
    items.filter((i) => i.kind === 'video').forEach((i) => this.ensureThumb(i.id));
    return { items };
  }

  /** 时间轴直方图：按月/按天的数量，一次算好缓存 */
  histogram() {
    if (this._hist) return this._hist;
    const months = new Map();
    const days = new Map();
    let min = Infinity, max = -Infinity;
    for (const r of this.photos.values()) {
      if (!r.dateMs) continue;
      const d = new Date(r.dateMs);
      const ym = d.getFullYear() * 100 + (d.getMonth() + 1);
      const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      months.set(ym, (months.get(ym) || 0) + 1);
      days.set(ymd, (days.get(ymd) || 0) + 1);
      if (r.dateMs < min) min = r.dateMs;
      if (r.dateMs > max) max = r.dateMs;
    }
    this._hist = {
      minDate: isFinite(min) ? min : null,
      maxDate: isFinite(max) ? max : null,
      months: Array.from(months.entries())
        .map(([k, n]) => ({ y: Math.floor(k / 100), m: k % 100, n }))
        .sort((a, b) => (a.y - b.y) || (a.m - b.m)),
      days: Array.from(days.entries()).sort((a, b) => a[0] - b[0]),
    };
    return this._hist;
  }

  async query(opts = {}) {
    const { offset = 0, limit = 60 } = opts;
    const list = this._filterList(opts);
    const total = list.length;
    const page = list.slice(offset, offset + limit);
    // 照片缩略图高优先生成（当前页插队）；视频靠协议按需生成，不阻塞翻页
    await Promise.all(page.filter((r) => r.kind === 'photo').map((r) => this.ensureThumb(r.id, true)));
    page.filter((r) => r.kind === 'video').forEach((r) => { this.ensureThumb(r.id); });
    return { total, items: page.map((r) => this._wire(r)) };
  }

  _wire(rec) {
    const hasThumb = fs.existsSync(this.thumbPath(rec.id));
    return {
      id: rec.id, name: rec.name, ext: rec.ext, kind: rec.kind,
      path: rec.path, size: rec.size,
      dateMs: rec.dateMs, dateSource: rec.dateSource,
      w: rec.w, h: rec.h, orientation: rec.orientation || 1,
      cam: rec.cam, gps: rec.gps, duration: rec.duration || 0,
      exif: rec.exif || null,
      fav: this.fav.has(rec.id),
      star: this.stars.get(rec.id) || 0,
      hasThumb,
      broken: !hasThumb && !!rec.broken,
      thumbUrl: `sg://thumb/${rec.id}`,
      // 照片走 preview（HEIC/TIFF 会自动转 JPEG），视频走 orig
      srcUrl: rec.kind === 'video' ? `sg://orig/${rec.id}` : `sg://preview/${rec.id}`,
    };
  }

  stats() {
    const arr = Array.from(this.photos.values());
    const byYear = new Map();
    let photoCount = 0, videoCount = 0, brokenCount = 0;
    let min = Infinity, max = -Infinity;
    for (const r of arr) {
      const y = new Date(r.dateMs).getFullYear();
      byYear.set(y, (byYear.get(y) || 0) + 1);
      if (r.kind === 'video') videoCount++; else photoCount++;
      if (r.broken) brokenCount++;
      if (r.dateMs < min) min = r.dateMs;
      if (r.dateMs > max) max = r.dateMs;
    }
    return {
      count: arr.length, photoCount, videoCount, brokenCount,
      favCount: this.fav.size, albumCount: this.albums.length,
      years: Array.from(byYear.entries()).map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year),
      minDate: isFinite(min) ? min : null,
      maxDate: isFinite(max) ? max : null,
      trashCount: this.trashEntries.length,
    };
  }

  async onThisDay() {
    const now = new Date();
    const mmdd = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const groups = new Map();
    for (const r of this._sortedList()) {
      const d = new Date(r.dateMs);
      if (d.getFullYear() === now.getFullYear()) continue;
      if (String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') !== mmdd) continue;
      if (!groups.has(d.getFullYear())) groups.set(d.getFullYear(), []);
      groups.get(d.getFullYear()).push(r);
    }
    const years = Array.from(groups.keys()).sort((a, b) => b - a);
    const days = years.map((y) => ({
      year: y,
      yearsAgo: now.getFullYear() - y,
      count: groups.get(y).length,
      items: groups.get(y).slice(0, 4).map((r) => this._wire(r)),
    }));
    for (const d of days) await Promise.all(d.items.map((i) => this.ensureThumb(i.id, true)));
    return { mmdd, days };
  }

  setFav(id, on) {
    if (on) this.fav.add(id); else this.fav.delete(id);
    this.save(); this.emit('changed');
    return this.fav.has(id);
  }

  setStar(id, n) {
    n = Math.max(0, Math.min(5, Math.round(+n || 0)));
    if (!n) this.stars.delete(id); else this.stars.set(id, n);
    this.save(); this.emit('changed');
    return this.stars.get(id) || 0;
  }

  /* ── 相册 ── */
  listAlbums() {
    return this.albums.map((a) => ({ ...a, count: a.photoIds.filter((id) => this.photos.has(id)).length }));
  }

  albumCreate(name) {
    const album = { id: hashId('album' + name + Date.now()), name: String(name).trim(), createdAt: Date.now(), photoIds: [] };
    if (!album.name) throw new Error('相册名不能为空');
    this.albums.unshift(album);
    this._saveAlbums(); this.emit('changed');
    return this.listAlbums()[0];
  }

  albumRename(id, name) {
    const a = this.albums.find((x) => x.id === id);
    if (!a) throw new Error('相册不存在');
    a.name = String(name).trim() || a.name;
    this._saveAlbums(); this.emit('changed');
  }

  albumRemove(id) {
    this.albums = this.albums.filter((a) => a.id !== id);
    this._saveAlbums(); this.emit('changed');
  }

  albumAddPhotos(id, ids) {
    const a = this.albums.find((x) => x.id === id);
    if (!a) throw new Error('相册不存在');
    const set = new Set(a.photoIds);
    for (const pid of ids || []) if (this.photos.has(pid)) set.add(pid);
    a.photoIds = Array.from(set);
    this._saveAlbums(); this.emit('changed');
    return a.photoIds.length;
  }

  albumRemovePhoto(id, photoId) {
    const a = this.albums.find((x) => x.id === id);
    if (!a) throw new Error('相册不存在');
    a.photoIds = a.photoIds.filter((x) => x !== photoId);
    this._saveAlbums(); this.emit('changed');
  }

  _saveAlbums() {
    try { atomicWrite(this.albumsPath, JSON.stringify({ albums: this.albums }, null, 2)); } catch (e) { /* 忽略 */ }
  }

  /* ── 回收站 ── */
  async trashPhotos(ids) {
    const moved = [];
    for (const id of ids) {
      const rec = this.photos.get(id);
      if (!rec) continue;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const target = path.join(this.trashDir, `${stamp}_${Math.random().toString(36).slice(2, 6)}_${rec.name}`);
      try {
        await fsp.rename(rec.path, target);
      } catch (e) {
        try { await fsp.copyFile(rec.path, target); await fsp.unlink(rec.path); }
        catch (e2) { continue; }
      }
      let thumbTarget = null;
      const tp = this.thumbPath(id);
      if (fs.existsSync(tp)) {
        thumbTarget = path.join(this.trashThumbsDir, id + '.jpg');
        try { await fsp.rename(tp, thumbTarget); } catch (e) { thumbTarget = null; }
      }
      this.trashEntries.unshift({
        eid: hashId(target), id: rec.id, name: rec.name,
        origPath: rec.path, trashPath: target, thumbPath: thumbTarget,
        deletedAt: Date.now(), type: 'trash', kind: rec.kind, dateMs: rec.dateMs,
      });
      for (const a of this.albums) a.photoIds = a.photoIds.filter((x) => x !== id);
      this.photos.delete(id);
      moved.push(this.trashEntries[0].eid);
    }
    this._sorted = null;
    this._saveAlbums();
    this.save(); this._saveTrash();
    this.emit('changed');
    return moved;
  }

  async restoreEntry(eid) {
    const i = this.trashEntries.findIndex((e) => e.eid === eid);
    if (i < 0) throw new Error('回收站项不存在');
    const entry = this.trashEntries[i];
    // 防覆盖：原路径已被占用时，恢复为带时间后缀的新文件名
    let dest = entry.origPath;
    if (fs.existsSync(dest)) {
      const ext = path.extname(dest);
      const base = path.basename(dest, ext);
      const t = new Date();
      const hhmmss = [t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()]
        .map((v, i) => String(v).padStart(i === 3 ? 3 : 2, '0')).join('');
      dest = path.join(path.dirname(dest), `${base}（恢复于${hhmmss}）${ext}`);
    }
    try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (e) { /* 忽略 */ }
    try { await fsp.rename(entry.trashPath, dest); }
    catch (e) {
      await fsp.copyFile(entry.trashPath, dest);
      await fsp.unlink(entry.trashPath);
    }
    if (entry.thumbPath && fs.existsSync(entry.thumbPath)) {
      try { await fsp.rename(entry.thumbPath, this.thumbPath(entry.id)); } catch (e) { /* 重新生成 */ }
    }
    this.trashEntries.splice(i, 1);
    this._saveTrash();
    const st = fs.statSync(dest);
    const rec = await this._processFile(dest, st, { skipVideoProbe: true });
    if (rec) this.photos.set(rec.id, rec);
    this._sorted = null;
    this.save(); this.emit('changed');
    if (rec && rec.kind === 'video') this.probeVideos();
    return dest;
  }

  async emptyTrash() {
    for (const e of this.trashEntries) {
      try { await fsp.unlink(e.trashPath); } catch (err) { /* 忽略 */ }
      if (e.thumbPath) { try { await fsp.unlink(e.thumbPath); } catch (err) { /* 忽略 */ } }
    }
    this.trashEntries = [];
    this._saveTrash();
    this.pruneOverlays();
    this.emit('changed');
    return true;
  }

  listTrash() {
    return this.trashEntries.map((e) => ({
      eid: e.eid, name: e.name, origPath: e.origPath,
      deletedAt: e.deletedAt, type: e.type, kind: e.kind || 'photo', dateMs: e.dateMs,
      exists: fs.existsSync(e.trashPath),
      hasThumb: !!(e.thumbPath && fs.existsSync(e.thumbPath)),
      thumbUrl: (e.thumbPath && fs.existsSync(e.thumbPath)) ? `sg://trashthumb/${e.eid}` : null,
    }));
  }

  trashEntryByEid(eid) { return this.trashEntries.find((e) => e.eid === eid) || null; }

  _saveTrash() {
    try { atomicWrite(this.trashIndexPath, JSON.stringify(this.trashEntries, null, 2)); } catch (e) { /* 忽略 */ }
  }

  /* ── 编辑保存 ──
   * 关键：先把 EXIF 方向"烘焙"进像素（与浏览器显示一致），再做旋转/裁剪/调色，
   * 最后 withMetadata 保留拍摄日期/相机/GPS，照片不会跳到今天。 */
  async editSave(id, edit) {
    const rec = this.photos.get(id);
    if (!rec || rec.kind !== 'photo') throw new Error('照片不存在');
    const rot = (((+edit.rot || 0) % 360) + 360) % 360;
    const { crop = null, brightness = 1, saturation = 1, contrast = 1 } = edit;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backup = path.join(this.trashDir, `${stamp}_edit-backup_${rec.name}`);
    try { await fsp.copyFile(rec.path, backup); } catch (e) { /* 下方检查 */ }
    if (!fs.existsSync(backup)) throw new Error('无法创建备份，已取消保存');

    const tmp = rec.path + '.sg-tmp';
    const swap = rec.path + '.sg-bak';
    try {
      const sharp = require('sharp');
      // 阶段一：EXIF 方向烘焙（orientation>1 才需要）
      let input = rec.path;
      try {
        const meta = await sharp(input, { failOn: 'none' }).metadata();
        if (meta.orientation && meta.orientation > 1) {
          const buf = await sharp(input, { failOn: 'none' }).rotate().withMetadata().toBuffer();
          input = buf;
        }
      } catch (e) { /* 元数据读取失败则按原样处理 */ }

      // 阶段二：旋转 / 裁剪 / 调色（坐标系 = 浏览器里摆正后的图像）
      let pipe = sharp(input, { failOn: 'none' }).rotate(rot);
      if (crop && crop.width > 8 && crop.height > 8) {
        pipe = pipe.extract({
          left: Math.max(0, Math.round(crop.left)),
          top: Math.max(0, Math.round(crop.top)),
          width: Math.round(crop.width),
          height: Math.round(crop.height),
        });
      }
      if (brightness !== 1 || saturation !== 1) {
        pipe = pipe.modulate({ brightness: +brightness, saturation: +saturation });
      }
      if (contrast !== 1) {
        const a = +contrast, b = 128 * (1 - a);
        pipe = pipe.linear(a, b);
      }
      if (rec.ext === '.png') await pipe.png({ compressionLevel: 9 }).withMetadata().toFile(tmp);
      else await pipe.jpeg({ quality: 93, mozjpeg: true }).withMetadata().toFile(tmp);

      // 原子替换：原图先改名让位 → 新图就位 → 再删旧图。
      // 旧实现是"先删原图再改名"，中途崩溃/断电会让原图凭空消失。
      await fsp.rename(rec.path, swap);
      try {
        await fsp.rename(tmp, rec.path);
      } catch (e) {
        await fsp.rename(swap, rec.path).catch(() => {}); // 回滚
        throw e;
      }
      try { await fsp.unlink(swap); } catch (e) { /* 清理失败不影响结果 */ }

      // 只有真正写成功之后，才把"编辑前备份"登记进回收站
      this.trashEntries.unshift({
        eid: hashId(backup), id: rec.id, name: rec.name + '（编辑前备份）',
        origPath: rec.path, trashPath: backup, thumbPath: null,
        deletedAt: Date.now(), type: 'edit-backup', kind: rec.kind, dateMs: rec.dateMs,
      });
      this._saveTrash();
    } catch (err) {
      // 失败：清掉半成品和备份，回收站里不留垃圾条目
      try { await fsp.unlink(tmp); } catch (e) { /* 忽略 */ }
      try { await fsp.unlink(backup); } catch (e) { /* 忽略 */ }
      throw err;
    }

    const st = fs.statSync(rec.path);
    const fresh = await this._processFile(rec.path, st);
    fresh.id = rec.id;
    // 没有 EXIF 的照片（截图/PNG）原本拿文件时间当拍摄时间，重写文件会把 mtime 变成"现在"，
    // 照片在时间线上就会跳到今天。这里把原时间同时写回文件系统和记录。
    if (rec.dateSource === 'file' && rec.mtimeMs) {
      try { await fsp.utimes(rec.path, new Date(rec.mtimeMs), new Date(rec.mtimeMs)); } catch (e) { /* 忽略 */ }
      try {
        const st2 = fs.statSync(rec.path);
        fresh.mtimeMs = st2.mtimeMs;
        fresh.dateMs = rec.dateMs;
        fresh.dateSource = 'file';
        fresh.sig = `${st2.size}-${Math.floor(st2.mtimeMs / 1000)}`;
      } catch (e) { /* 忽略 */ }
    }
    this.photos.set(rec.id, fresh);
    try { fs.unlinkSync(this.thumbPath(id)); } catch (e) { /* 忽略 */ }
    try { fs.unlinkSync(path.join(this.previewDir, id + '.jpg')); } catch (e) { /* 忽略 */ }
    this._thumbFail.delete(id);
    await this.ensureThumb(id, true);
    this._sorted = null;
    this.save(); this.emit('changed');
    return this._wire(fresh);
  }

  /* ── 监控 ── */
  startWatching() {
    this.stopWatching();
    if (!this.libDir || !fs.existsSync(this.libDir)) return;
    try {
      this._watcher = fs.watch(this.libDir, { recursive: true }, (_evt, filename) => {
        // 编辑照片时的临时文件会触发自己，忽略掉，避免扫描打断保存
        if (filename && (/\.sg-(tmp|bak)$/i.test(filename) || /^~/.test(filename))) return;
        clearTimeout(this._watchTimer);
        this._watchTimer = setTimeout(() => {
          this.rescanAll(false).catch(() => {});
        }, 1500);
      });
    } catch (e) { /* 监控失败不影响使用 */ }
  }

  stopWatching() {
    if (this._watcher) { try { this._watcher.close(); } catch (e) { /* 忽略 */ } this._watcher = null; }
  }

  save() {
    this._hist = null;   // 时间轴直方图下次用到时重算
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._writeIndex(), 600);
  }

  /** 立即落盘（退出前调用），保证防抖窗口内的收藏等改动不丢 */
  flush() {
    clearTimeout(this._saveTimer);
    this._writeIndex();
  }

  _writeIndex() {
    try {
      atomicWrite(this.indexPath, JSON.stringify({
        v: 3, savedAt: Date.now(),
        photos: Array.from(this.photos.values()),
        fav: Array.from(this.fav),
        stars: Object.fromEntries(this.stars),
      }));
    } catch (e) { /* 磁盘错误时静默 */ }
  }

  publicState() {
    return { libDir: this.libDir, ui: this.ui, libAvailable: this.libAvailable, ...this.stats() };
  }
}

module.exports = { Library, PHOTO_EXTS, VIDEO_EXTS };
