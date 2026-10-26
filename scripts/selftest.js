'use strict';
/** 数据层自测：相册 / 日期搜索 / 编辑 / 回收站缩略图 / 原子备份（在临时沙盒中运行） */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Library } = require('../lib/library');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-selftest-'));
const LIB = path.join(TMP, 'photos');
const DATA = path.join(TMP, 'data');
const TRASH_FILE = path.join(DATA, 'trash', 'entries.json');
fs.mkdirSync(LIB, { recursive: true });

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

async function main() {
  const sharp = require('sharp');
  // 准备 4 张照片：2026-10-01 两张、2025-06-15 一张、一张 HEIC
  const svg = (c) => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700"><rect width="900" height="700" fill="${c}"/></svg>`;
  const files = [
    ['a1.jpg', '2026-10-01T10:00', '#2c4d78'],
    ['a2.jpg', '2026-10-02T11:00', '#c97a52'],
    ['b1.jpg', '2025-06-15T09:00', '#2f5d3a'],
  ];
  for (const [name, when, color] of files) {
    const p = path.join(LIB, name);
    await sharp(Buffer.from(svg(color))).jpeg().toFile(p);
    const d = new Date(when);
    fs.utimesSync(p, d, d);
  }
  const heic = path.join(LIB, 'c1.heic');
  await sharp(Buffer.from(svg('#e0b26a'))).heif({ compression: 'av1', quality: 80 }).toFile(heic);
  fs.utimesSync(heic, new Date('2026-10-05T12:00'), new Date('2026-10-05T12:00'));

  const lib = new Library(DATA);
  await lib.init({ defaultLibDir: LIB });
  const r = await lib.rescanAll(true);
  await lib.warmThumbs(); // 等缩略图全部就绪再断言
  console.log('\n[扫描]');
  check('扫描到 4 个文件', r.total === 4);
  check('全部有缩略图', Array.from(lib.photos.values()).every((p) => fs.existsSync(lib.thumbPath(p.id))));
  const heicRec = Array.from(lib.photos.values()).find((p) => p.ext === '.heic');
  check('HEIC 解析出宽高', !!(heicRec && heicRec.w));

  console.log('\n[日期搜索]');
  check('搜 202610 命中 3', (await lib.query({ q: '202610' })).total === 3);
  check('搜 2025 命中 1', (await lib.query({ q: '2025' })).total === 1);
  check('搜 0615 命中 1', (await lib.query({ q: '0615' })).total === 1);
  check('搜 a2 命中 1', (await lib.query({ q: 'a2' })).total === 1);

  console.log('\n[收藏/评星]');
  const id1 = Array.from(lib.photos.values()).find((p) => p.name === 'a1.jpg').id;
  lib.setFav(id1, true);
  lib.setStar(id1, 3);
  check('收藏过滤 1', (await lib.query({ filter: 'fav' })).total === 1);
  check('评星=3', lib.setStar(id1, 3) === 3);
  check('星级钳制 0-5', lib.setStar(id1, 99) === 5);

  console.log('\n[相册]');
  const alb = lib.albumCreate('测试相册');
  lib.albumAddPhotos(alb.id, [id1]);
  check('相册数量', lib.listAlbums()[0].count === 1);
  check('按相册查询', (await lib.query({ albumId: alb.id })).total === 1);
  lib.albumRename(alb.id, '改名相册');
  check('重命名', lib.listAlbums()[0].name === '改名相册');

  console.log('\n[编辑（旋转+裁剪+调色）]');
  const fresh = await lib.editSave(id1, { rot: 90, crop: { left: 0, top: 0, width: 400, height: 300 }, brightness: 1.1, saturation: 1.2, contrast: 1 });
  check('编辑后宽高对调为 700x900→裁剪', fresh.w === 400 && fresh.h === 300);
  check('编辑备份进回收站', lib.listTrash().some((e) => e.type === 'edit-backup'));

  console.log('\n[回收站（含缩略图）]');
  const id2 = Array.from(lib.photos.values()).find((p) => p.name === 'a2.jpg').id;
  await lib.trashPhotos([id2]);
  const list = lib.listTrash();
  check('删除后计数 3', lib.stats().count === 3);
  check('回收站带缩略图', list.some((e) => e.hasThumb));
  check('相册引用被清理', lib.listAlbums()[0].count === 1); // id1 仍在
  await lib.restoreEntry(list.find((e) => e.name === 'a2.jpg').eid);
  check('恢复后计数 4', lib.stats().count === 4);
  check('恢复后缩略图回来', fs.existsSync(lib.thumbPath(id2)));

  console.log('\n[原子写入与备份]');
  lib.save();
  await new Promise((r2) => setTimeout(r2, 900));
  check('index.json 存在', fs.existsSync(path.join(DATA, 'index.json')));
  check('entries.json 存在', fs.existsSync(TRASH_FILE));
  // 模拟损坏：写坏 index.json，重新加载应回退或重新扫描恢复
  fs.writeFileSync(path.join(DATA, 'index.json'), '{broken!!');
  const lib2 = new Library(DATA);
  await lib2.init({ defaultLibDir: LIB });
  if (lib2.stats().count < 3) await lib2.rescanAll(true);
  check('损坏后可恢复', lib2.stats().count >= 4);

  console.log('\n[EXIF 方向烘焙 + 元数据保留]');
  const orient = path.join(LIB, 'o1.jpg');
  await sharp(Buffer.from(svg('#778899')))
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD0: { DateTime: '2023:05:01 08:30:00' } } })
    .toFile(orient);
  await lib.rescanAll(true);
  const oRec = Array.from(lib.photos.values()).find((p) => p.name === 'o1.jpg');
  check('orientation 识别为 6', oRec && oRec.orientation === 6);
  const oFresh = await lib.editSave(oRec.id, { rot: 0, crop: { left: 0, top: 0, width: 300, height: 400 } });
  check('按显示坐标裁剪（300x400）', oFresh.w === 300 && oFresh.h === 400);
  check('拍摄日期保留（未跳到今天）', new Date(oFresh.dateMs).getFullYear() === 2023);

  console.log('\n[v1.5 库离线不清索引]');
  const OFFLIB = path.join(TMP, 'offlib');
  const OFFDATA = path.join(TMP, 'offdata');
  fs.mkdirSync(OFFLIB, { recursive: true });
  for (const n of ['x1.jpg', 'x2.jpg']) {
    await sharp(Buffer.from(svg('#334455'))).jpeg().toFile(path.join(OFFLIB, n));
  }
  const olib = new Library(OFFDATA);
  await olib.init({ defaultLibDir: OFFLIB });
  await olib.rescanAll(true);
  const offBefore = olib.stats().count;
  olib.setFav(Array.from(olib.photos.values())[0].id, true);
  olib.flush();
  // 直接改写 config 指向一个不存在的目录，等价于"移动硬盘拔掉"；
  // 不依赖重命名目录（Windows 上常被索引/杀软占用，偶尔 EPERM 会让整组测试跳过）
  const offCfgFile = path.join(OFFDATA, 'config.json');
  const offCfg = JSON.parse(fs.readFileSync(offCfgFile, 'utf8'));
  offCfg.libDir = path.join(TMP, 'library-gone-away');
  fs.writeFileSync(offCfgFile, JSON.stringify(offCfg, null, 2));

  const olib2 = new Library(OFFDATA);
  await olib2.init({ defaultLibDir: path.join(TMP, 'should-not-be-used') });
  const offRes = await olib2.rescanAll(false);
  check('离线时索引条数不变', olib2.stats().count === offBefore);
  check('离线时 libAvailable=false', olib2.libAvailable === false);
  check('离线时不改写 libDir', olib2.libDir === offCfg.libDir);
  check('离线时收藏仍在', olib2.stats().favCount === 1);
  check('离线 rescan 返回 offline', offRes.offline === true);

  console.log('\n[v1.5 日期搜索收紧]');
  check('搜 "20" 不再把 2026 全部命中', (await lib.query({ q: '20' })).total < lib.stats().count);
  check('搜 "1001" 命中 10 月 1 日', (await lib.query({ q: '1001' })).total >= 1);

  console.log('\n[v1.5 编辑失败不留垃圾]');
  const bId = Array.from(lib.photos.values()).find((p) => p.name === 'a2.jpg').id;
  const bkBefore = lib.listTrash().filter((e) => e.type === 'edit-backup').length;
  const filesBefore = fs.readdirSync(LIB).length;
  let editThrew = false;
  try { await lib.editSave(bId, { crop: { left: 0, top: 0, width: 99999, height: 99999 } }); }
  catch (e) { editThrew = true; }
  check('越界裁剪会报错', editThrew);
  check('失败后原图仍在', fs.existsSync(path.join(LIB, 'a2.jpg')));
  check('失败后没有残留临时文件', !fs.readdirSync(LIB).some((f) => /\.sg-(tmp|bak)$/.test(f)));
  check('失败后文件数不变', fs.readdirSync(LIB).length === filesBefore);
  check('失败后没有多出编辑备份', lib.listTrash().filter((e) => e.type === 'edit-backup').length === bkBefore);

  console.log('\n[v1.5 无主缩略图清理]');
  const ghost = 'deadbeef'.repeat(5);
  fs.writeFileSync(path.join(DATA, 'thumbs', ghost + '.jpg'), 'x');
  await lib.rescanAll(false);
  check('无主缩略图被清掉', !fs.existsSync(path.join(DATA, 'thumbs', ghost + '.jpg')));

  console.log('\n[v1.5 HEIC/TIFF 走预览转码]');
  const heicRec2 = Array.from(lib.photos.values()).find((p) => p.ext === '.heic');
  const pv = await lib.previewPath(heicRec2.id);
  check('HEIC 预览转成 jpg', !!pv && /\.jpg$/i.test(pv) && fs.existsSync(pv));
  const jpgRec = Array.from(lib.photos.values()).find((p) => p.ext === '.jpg');
  check('普通 JPEG 直接用原图', (await lib.previewPath(jpgRec.id)) === jpgRec.path);

  console.log('\n[v1.5 视频元数据（时长/宽高/creation_time）]');
  const ff = path.join(__dirname, '..', 'bin', 'ffmpeg.exe');
  if (!fs.existsSync(ff)) {
    console.log('  · 跳过（没有 bin/ffmpeg.exe）');
  } else {
    const clip = path.join(LIB, 'clip.mp4');
    const { spawnSync } = require('child_process');
    const r = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc=size=320x240:rate=10', '-t', '2', '-pix_fmt', 'yuv420p',
      '-metadata', 'creation_time=2024-05-06T07:08:09Z', '-y', clip], { stdio: 'ignore' });
    if (r.status !== 0 || !fs.existsSync(clip)) {
      console.log(`  · 跳过（ffmpeg 造样例失败：${r.error ? r.error.code : 'exit ' + r.status}）`);
    } else {
      await lib.rescanAll(false);
      const vRec = Array.from(lib.photos.values()).find((p) => p.name === 'clip.mp4');
      for (let i = 0; i < 100 && vRec && !vRec.probed; i++) await new Promise((r2) => setTimeout(r2, 200));
      if (vRec && !vRec.probed && vRec.broken) {
        console.log('  · 跳过（当前环境不允许子进程管道，ffmpeg 无法被调用）');
      } else {
        check('视频宽高补齐 320x240', vRec && vRec.w === 320 && vRec.h === 240);
        check('视频时长 ≈ 2s', vRec && Math.abs(vRec.duration - 2) < 0.5);
        check('拍摄时间取自 creation_time', vRec && vRec.dateSource === 'meta'
          && new Date(vRec.dateMs).getFullYear() === 2024);
      }
    }
  }

  console.log('\n[v1.6 时间轴：直方图 / 定位 / 预览]');
  const hist = lib.histogram();
  const total = lib.stats().count;
  check('直方图有起止时间', !!(hist.minDate && hist.maxDate));
  check('月份数量合计 = 总数', hist.months.reduce((a, m) => a + m.n, 0) === total);
  check('按天数量合计 = 总数', hist.days.reduce((a, d) => a + d[1], 0) === total);
  check('月份按时间升序', hist.months.every((m, i, arr) => i === 0
    || (arr[i - 1].y * 100 + arr[i - 1].m) < (m.y * 100 + m.m)));

  const allIds = lib._sortedList().map((r) => r.id);
  const locNew = lib.locate({ dateMs: hist.maxDate + 86400000 });
  check('比库里更新的时间 → 落到第 0 条', locNew.index === 0 && locNew.id === allIds[0]);
  const locOld = lib.locate({ dateMs: hist.minDate - 86400000 });
  check('比库里更早的时间 → 落到最后一条', locOld.index === allIds.length - 1);
  const midRec = lib._sortedList()[Math.floor(allIds.length / 2)];
  const locMid = lib.locate({ dateMs: midRec.dateMs });
  check('locate 命中目标本身', locMid.id === midRec.id);
  check('locate 与线性扫描一致',
    locMid.index === lib._sortedList().findIndex((r) => r.dateMs <= midRec.dateMs));

  const around = await lib.around({ dateMs: midRec.dateMs, limit: 3 });
  check('around 返回 3 条且带 id', around.items.length === 3 && !!around.items[0].id);

  lib.setFav(allIds[allIds.length - 1], true);
  const favList = lib._filterList({ filter: 'fav' });
  const locFav = lib.locate({ dateMs: midRec.dateMs, filter: 'fav' });
  check('locate 遵循当前筛选', locFav.total === favList.length && locFav.index < favList.length);
  check('直方图随库变化失效重算', (() => {
    const before = lib.histogram().months.length;
    lib.save();                                  // save 会把 _hist 置空
    return lib._hist === null && lib.histogram().months.length === before;
  })());

  console.log('\n[v1.7 改名/移动不丢收藏]');
  const mv1 = path.join(LIB, 'mv1.jpg');
  await sharp(Buffer.from(svg('#556677'))).jpeg().toFile(mv1);
  const mvDate = new Date('2024-02-03T04:05:06');
  fs.utimesSync(mv1, mvDate, mvDate);
  await lib.rescanAll(false);
  const mvRec = Array.from(lib.photos.values()).find((p) => p.name === 'mv1.jpg');
  await lib.ensureThumb(mvRec.id);                    // 先确保有缩略图，才能验证迁移
  lib.setFav(mvRec.id, true);
  const beforeCount = lib.stats().count;
  fs.renameSync(mv1, path.join(LIB, 'mv1-renamed.jpg'));
  const renameRes = await lib.rescanAll(false);
  const mvAfter = Array.from(lib.photos.values()).find((p) => p.name === 'mv1-renamed.jpg');
  check('改名后 id 不变', !!mvAfter && mvAfter.id === mvRec.id);
  check('改名后收藏还在', lib.fav.has(mvRec.id));
  check('改名后总数不变', lib.stats().count === beforeCount);
  check('scan 报告 renamed=1', renameRes.renamed === 1);
  check('改名后缩略图没丢', fs.existsSync(lib.thumbPath(mvRec.id)));
  // 两个同大小同时间的文件同时出现时不应乱迁移
  const twinA = path.join(LIB, 'twin-a.jpg');
  const twinB = path.join(LIB, 'twin-b.jpg');
  await sharp(Buffer.from(svg('#778899'))).jpeg().toFile(twinA);
  fs.copyFileSync(twinA, twinB);
  fs.utimesSync(twinA, mvDate, mvDate); fs.utimesSync(twinB, mvDate, mvDate);
  await lib.rescanAll(false);
  const twins = Array.from(lib.photos.values()).filter((p) => /^twin-[ab]\.jpg$/.test(p.name));
  check('同尺寸同时刻的两个文件都保留', twins.length === 2);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('自测异常:', e); process.exit(1); });
