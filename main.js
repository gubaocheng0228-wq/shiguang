'use strict';
const { app, BrowserWindow, ipcMain, protocol, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { Library } = require('./lib/library');

const ROOT = __dirname;
const IS_SMOKE = process.argv.includes('--smoke');

/** 默认照片库：D 盘存在就用 D:\照片库，否则退回系统「图片」目录（换电脑也能用） */
function defaultLibDir() {
  if (process.env.SG_LIB_DIR) return path.resolve(process.env.SG_LIB_DIR);
  try { if (fs.existsSync('D:\\')) return 'D:\\照片库'; } catch (e) { /* 忽略 */ }
  try { return path.join(app.getPath('pictures'), '拾光照片库'); } catch (e) { return path.join(ROOT, '照片库'); }
}
const DEFAULT_LIB = defaultLibDir();

/**
 * 数据目录：D:\拾光数据（独立于开发副本，删除 PhotoHub 不影响数据）。
 * 若旧位置 D:\PhotoHub\data 存在则自动迁移过去；冒烟测试使用隔离目录。
 * SG_DATA_DIR 可完全接管（开发/自测用，不会碰到真实数据）。
 */
function resolveDataDir() {
  if (process.env.SG_DATA_DIR) {
    const d = path.resolve(process.env.SG_DATA_DIR);
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { /* 忽略 */ }
    return d;
  }
  if (IS_SMOKE) return path.join(ROOT, 'data-smoke');
  const target = 'D:\\拾光数据';
  const legacy = 'D:\\PhotoHub\\data';
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(target)) fs.renameSync(legacy, target);
  } catch (e) { /* 迁移失败则各自使用 */ }
  try { fs.mkdirSync(target, { recursive: true }); return target; } catch (e) { /* 退回 */ }
  return path.join(ROOT, 'data');
}
const DATA_DIR = resolveDataDir();

/** 开发期跟踪：SG_LOG=路径 时把启动各阶段写入日志（正式运行不产生任何文件） */
function trace(msg) {
  if (!process.env.SG_LOG) return;
  try { fs.appendFileSync(process.env.SG_LOG, `${new Date().toISOString()} ${msg}\n`); } catch (e) { /* 忽略 */ }
}

if (IS_SMOKE || app.requestSingleInstanceLock()) {
  trace('lock ok, smoke=' + IS_SMOKE + ' dataDir=' + DATA_DIR);
  main();
} else {
  trace('single instance lock failed -> quit');
  app.quit();
}

function main() {

  /** 启动/运行时异常落盘：以前启动失败只会静默退出，用户看不到任何原因 */
  function writeCrashLog(where, err) {
    const line = `[${new Date().toISOString()}] ${where}: ${(err && err.stack) || err}\n`;
    try { fs.appendFileSync(path.join(DATA_DIR, 'error.log'), line); } catch (e) { /* 忽略 */ }
    try { console.error(line); } catch (e) { /* 忽略 */ }
  }
  process.on('uncaughtException', (err) => writeCrashLog('uncaughtException', err));
  process.on('unhandledRejection', (err) => writeCrashLog('unhandledRejection', err));

  protocol.registerSchemesAsPrivileged([
    { scheme: 'sg', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);

  let win = null;
  let lib = null;

  const MIME = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff',
    '.avif': 'image/avif', '.heic': 'image/heic', '.heif': 'image/heic',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.3gp': 'video/3gpp', '.mts': 'video/mp2t', '.m2ts': 'video/mp2t',
    '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.aac': 'audio/aac', '.flac': 'audio/flac',
    '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
  };
  const MUSIC_EXTS = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i;

  function send(ch, payload) {
    if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
  }

  function fileResponse(filePath, request) {
    return new Promise((resolve) => {
      fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) return resolve(new Response('Not Found', { status: 404 }));
        const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
        const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes' };
        const range = request.headers.get('range');
        if (range) {
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          let start = m && m[1] ? parseInt(m[1], 10) : 0;
          let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
          if (m && !m[1] && m[2]) {           // 后缀区间 bytes=-N：最后 N 字节
            const n = parseInt(m[2], 10) || 0;
            start = Math.max(0, st.size - n);
            end = st.size - 1;
          }
          if (isNaN(start)) start = 0;
          if (start >= st.size) return resolve(new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } }));
          end = Math.min(isNaN(end) ? st.size - 1 : end, st.size - 1);
          if (start > end) return resolve(new Response(null, { status: 416 }));
          headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
          headers['Content-Length'] = String(end - start + 1);
          const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
          resolve(new Response(stream, { status: 206, headers }));
        } else {
          headers['Content-Length'] = String(st.size);
          const stream = Readable.toWeb(fs.createReadStream(filePath));
          resolve(new Response(stream, { status: 200, headers }));
        }
      });
    });
  }

  async function handleScheme(request) {
    try {
      const u = new URL(request.url);
      const route = u.hostname; // thumb / orig / trashthumb
      const id = decodeURIComponent(u.pathname.replace(/^\//, '')).split('?')[0];
      let filePath = null;
      if (route === 'thumb') {
        if (!/^[0-9a-f]{40}$/.test(id)) return new Response('Bad Request', { status: 400 }); // 防目录穿越
        const p = path.join(lib.thumbsDir, id + '.jpg');
        if (!fs.existsSync(p)) await lib.ensureThumb(id);
        if (fs.existsSync(p)) filePath = p;
      } else if (route === 'preview') {
        // 浏览器解不了的格式（HEIC/HEIF）按需转成 JPEG 再给前端
        if (!/^[0-9a-f]{40}$/.test(id)) return new Response('Bad Request', { status: 400 });
        const p = await lib.previewPath(id);
        if (p) filePath = p;
      } else if (route === 'orig') {
        const rec = lib.photos.get(id);
        if (rec && fs.existsSync(rec.path)) filePath = rec.path;
      } else if (route === 'trashthumb') {
        const entry = lib.trashEntryByEid(id);
        if (entry && entry.thumbPath && fs.existsSync(entry.thumbPath)) filePath = entry.thumbPath;
      } else if (route === 'music') {
        // 放映背景音乐：只允许读取 music/ 目录内的音频文件，防目录穿越
        const name = path.basename(id);
        if (name && MUSIC_EXTS.test(name)) {
          const p = path.join(ROOT, 'music', name);
          if (fs.existsSync(p)) filePath = p;
        }
      }
      if (!filePath) return new Response('Not Found', { status: 404 });
      return fileResponse(filePath, request);
    } catch (e) {
      return new Response('Error', { status: 500 });
    }
  }

  /** 数据引擎只建一次：窗口关闭/重开（macOS activate）时不会重扫、不会丢状态 */
  async function ensureLib() {
    if (lib) return lib;
    trace('ensureLib start');
    lib = new Library(DATA_DIR);
    lib.on('progress', (p) => send('lib:progress', p));
    lib.on('changed', () => send('lib:state', { ...lib.publicState(), smoke: IS_SMOKE }));
    lib.on('thumb', (p) => send('lib:thumb', p));
    lib.on('thumbs-done', () => send('lib:thumbs-done', { at: Date.now() }));
    await lib.init({ defaultLibDir: DEFAULT_LIB });
    trace('lib init done, libDir=' + lib.libDir + ' available=' + lib.libAvailable);
    lib.startWatching();
    lib._lastScan = lib.rescanAll(false).catch((err) => send('lib:error', String(err)));
    return lib;
  }

  function restoreBounds(w) {
    const b = lib && lib.ui && lib.ui.winBounds;
    if (!b || !b.width || !b.height) return;
    try {
      const area = require('electron').screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height }).workArea;
      // 显示器变了就不要再把窗口摆到看不见的地方
      const visible = b.x + b.width > area.x + 40 && b.x < area.x + area.width - 40
        && b.y + b.height > area.y + 40 && b.y < area.y + area.height - 40;
      const width = Math.min(Math.max(980, b.width), area.width);
      const height = Math.min(Math.max(640, b.height), area.height);
      if (visible) w.setBounds({ x: b.x, y: b.y, width, height });
      else w.setBounds({ width, height });
      if (b.maximized) w.maximize();
    } catch (e) { /* 忽略 */ }
  }

  let boundsTimer = null;
  function saveBounds(flushNow) {
    if (!win || win.isDestroyed() || !lib) return;
    clearTimeout(boundsTimer);
    const run = () => {
      try {
        const normal = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
        lib.setUi({ winBounds: { x: normal.x, y: normal.y, width: normal.width, height: normal.height, maximized: win.isMaximized() } });
      } catch (e) { /* 忽略 */ }
    };
    if (flushNow) run(); else boundsTimer = setTimeout(run, 700);
  }

  async function createWindow() {
    if (win && !win.isDestroyed()) { win.focus(); return; }
    await ensureLib();
    trace('creating BrowserWindow');
    win = new BrowserWindow({
      // SG_WIN_W / SG_WIN_H 只给自测用（截图时把窗口开高一点，一次看到更多网格）
      width: Number(process.env.SG_WIN_W) || 1320,
      height: Number(process.env.SG_WIN_H) || 880,
      minWidth: 980, minHeight: 640,
      show: false,
      frame: false,
      backgroundColor: '#0a0c12',
      icon: path.join(ROOT, 'build', 'icon.png'),
      title: '拾光',
      webPreferences: {
        preload: path.join(ROOT, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    if (!IS_SMOKE) win.setMenu(null);
    restoreBounds(win);
    // 外链一律交给系统浏览器，窗口本身不允许被导航走
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url).catch(() => {}); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith('file://')) { e.preventDefault(); shell.openExternal(url).catch(() => {}); }
    });
    win.once('ready-to-show', () => win.show());
    win.on('resize', () => saveBounds(false));
    win.on('move', () => saveBounds(false));
    win.on('maximize', () => { send('win:max-state', true); saveBounds(false); });
    win.on('unmaximize', () => { send('win:max-state', false); saveBounds(false); });
    // 全屏状态回传：用户按 F11 / 系统手势退出全屏时，放映模式要跟着收起来
    win.on('enter-full-screen', () => send('win:fullscreen-state', true));
    win.on('leave-full-screen', () => send('win:fullscreen-state', false));
    win.on('close', () => saveBounds(true));
    win.on('closed', () => { win = null; });
    await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
    trace('loadFile done');
    // 自测钩子（只在设了环境变量时生效）：
    //   SG_EXEC=<js>              页面加载后执行一段脚本（例如打开时间轴）
    //   SG_CAPTURE_AFTER=<ms>     执行完等多久截图
    //   SG_SCREENSHOT=<路径>       截图写到哪里
    //   SG_EXIT_AFTER_CAPTURE=1   截完退出
    if (process.env.SG_EXEC || Number(process.env.SG_CAPTURE_AFTER)) {
      setTimeout(async () => {
        if (!win || win.isDestroyed()) return;
        if (process.env.SG_EXEC) {
          try {
            const r = await win.webContents.executeJavaScript(process.env.SG_EXEC, true);
            if (process.env.SG_EXEC_OUT) fs.writeFileSync(process.env.SG_EXEC_OUT, JSON.stringify(r, null, 2));
          } catch (e) {
            trace('exec 失败: ' + e);
            if (process.env.SG_EXEC_OUT) fs.writeFileSync(process.env.SG_EXEC_OUT, JSON.stringify({ execError: String(e) }, null, 2));
          }
        }
        const after = Number(process.env.SG_CAPTURE_AFTER) || 800;
        setTimeout(async () => {
          try {
            if (process.env.SG_SCREENSHOT && win && !win.isDestroyed()) {
              const img = await win.webContents.capturePage();
              fs.writeFileSync(process.env.SG_SCREENSHOT, img.toPNG());
            }
          } catch (e) { trace('截图失败: ' + e); }
          if (process.env.SG_EXIT_AFTER_CAPTURE) app.quit();
        }, after);
      }, 1500);
    }
    send('lib:state', { ...lib.publicState(), smoke: IS_SMOKE });
  }

  const HANDLE = {
    'win:min': () => win && win.minimize(),
    'win:max': () => { if (!win) return false; win.isMaximized() ? win.unmaximize() : win.maximize(); return win.isMaximized(); },
    'win:fullscreen': (on) => { if (!win) return false; win.setFullScreen(!!on); return win.isFullScreen(); },
    'win:close': () => win && win.close(),
    'cfg:get': () => ({ ...lib.publicState(), smoke: IS_SMOKE, version: app.getVersion() }),
    'cfg:pickLib': async () => {
      const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择照片库文件夹' });
      if (r.canceled || !r.filePaths.length) return null;
      const st = await lib.setLibDir(r.filePaths[0]);
      lib.startWatching();
      return st;
    },
    'ui:set': (patch) => lib.setUi(patch || {}),
    'lib:rescan': () => lib.rescanAll(true),
    'lib:stats': () => lib.publicState(),
    'lib:list': (o) => lib.query(o || {}),
    'lib:histogram': () => lib.histogram(),
    'lib:locate': (o) => lib.locate(o || {}),
    'lib:around': (o) => lib.around(o || {}),
    'lib:onThisDay': () => lib.onThisDay(),
    'music:list': () => {
      try {
        return fs.readdirSync(path.join(ROOT, 'music'))
          .filter((f) => MUSIC_EXTS.test(f))
          .sort();
      } catch (e) { return []; }
    },
    'photo:fav': ({ id, on }) => lib.setFav(String(id), !!on),
    'photo:star': ({ id, n }) => lib.setStar(String(id), +n || 0),
    'photo:edit': ({ id, edit }) => lib.editSave(String(id), edit || {}),
    'photo:rotate': ({ id, deg }) => lib.editSave(String(id), { rot: +deg || 0 }),
    'photo:trash': ({ ids }) => lib.trashPhotos((ids || []).map(String)),
    'photo:showInFolder': ({ id }) => {
      const rec = lib.photos.get(String(id));
      if (rec) shell.showItemInFolder(rec.path);
      return !!rec;
    },
    'album:list': () => lib.listAlbums(),
    'album:create': ({ name }) => lib.albumCreate(name),
    'album:rename': ({ id, name }) => lib.albumRename(String(id), name),
    'album:remove': ({ id }) => lib.albumRemove(String(id)),
    'album:addPhotos': ({ id, ids }) => lib.albumAddPhotos(String(id), ids || []),
    'album:removePhoto': ({ id, photoId }) => lib.albumRemovePhoto(String(id), String(photoId)),
    'trash:list': () => lib.listTrash(),
    'trash:restore': ({ eid }) => lib.restoreEntry(String(eid)),
    'trash:empty': () => lib.emptyTrash(true),
    'app:openData': () => { shell.openPath(DATA_DIR); },
    'app:openLib': () => { if (lib.libDir) shell.openPath(lib.libDir); },
  };

  for (const [ch, fn] of Object.entries(HANDLE)) {
    ipcMain.handle(ch, async (_e, arg) => {
      try { return await fn(arg); }
      catch (err) { throw new Error(String(err && err.message || err)); }
    });
  }

  if (IS_SMOKE) {
    let reported = false;
    // 冒烟结果除了打控制台，也可以落盘（CI / 无法捕获 stdout 时用）：SG_SMOKE_OUT=路径
    const writeReport = (payload) => {
      const out = process.env.SG_SMOKE_OUT;
      if (!out) return;
      try { fs.writeFileSync(out, JSON.stringify(payload, null, 2)); } catch (e) { /* 忽略 */ }
    };
    ipcMain.handle('smoke:report', async (_e, report) => {
      reported = true;
      try { await (lib._lastScan || Promise.resolve()); } catch (e) { /* 扫描错误不阻塞判定 */ }
      const st = lib.publicState();
      const ok = !!(report && report.ok && st.count > 0);
      const payload = { renderer: report, library: st, ok };
      console.log('[SMOKE] ' + JSON.stringify(payload));
      writeReport(payload);
      // 冒烟附带截图（不受窗口遮挡/DPI 影响）：SG_SCREENSHOT=路径
      if (process.env.SG_SCREENSHOT && win && !win.isDestroyed()) {
        try {
          await new Promise((r) => setTimeout(r, 2000)); // 等缩略图与入场动画落定
          const img = await win.webContents.capturePage();
          fs.writeFileSync(process.env.SG_SCREENSHOT, img.toPNG());
        } catch (e) { /* 截图失败不影响判定 */ }
      }
      setTimeout(() => app.exit(ok ? 0 : 1), 300);
      return ok;
    });
    setTimeout(() => {
      if (!reported) {
        const payload = { renderer: null, library: lib.publicState(), ok: false, timeout: true };
        console.log('[SMOKE] TIMEOUT ' + JSON.stringify(payload.library));
        writeReport(payload);
        app.exit(1);
      }
    }, 180000);
  } else {
    // preload 白名单里有 smoke:report，正式包里给一个明确的"不支持"，
    // 免得渲染层拿到 "No handler registered for 'smoke:report'" 这种原始错误
    ipcMain.handle('smoke:report', () => false);
  }

  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  try { if (process.platform === 'win32') app.setAppUserModelId('com.shiguang.photovault'); } catch (e) { /* 忽略 */ }

  app.whenReady().then(async () => {
    protocol.handle('sg', handleScheme);
    await createWindow();
  }).catch((err) => {
    console.error('启动失败:', err);
    app.exit(1);
  });

  app.on('before-quit', () => {
    try { saveBounds(true); } catch (e) { /* 忽略 */ }
    try { lib && lib.flush(); } catch (e) { /* 忽略 */ }
  });

  app.on('window-all-closed', () => {
    lib && lib.stopWatching();
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
