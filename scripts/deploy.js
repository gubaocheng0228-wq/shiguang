'use strict';
/**
 * 增量部署：把源码同步到「开发副本 D:\PhotoHub」和「已安装目录 D:\拾光\resources\app」。
 * 相比 build-portable 只做“复制 + 改写 package.json + 生成使用说明”：
 *   · 不删目录，不动 node_modules，不联网装依赖
 *   · 逐文件比对哈希，没改过的跳过
 *   · 适用于“改完立刻生效”的迭代；需要完整重打包时再用 npm run build
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const readmeText = require('./readme-text');

const ROOT = path.join(__dirname, '..');
const OUT_APP = 'D:\\拾光';
const OUT_DEV = 'D:\\PhotoHub';

/** 需要同步的源码（相对项目根）；bin/、node_modules/、data-smoke/ 都不动 */
const SOURCE_FILES = [
  'main.js',
  'preload.js',
  'lib/library.js',
  'renderer/index.html',
  'renderer/app.js',
  'renderer/styles.css',
  'renderer/icons.js',
  'renderer/fonts.css',
];
/** 只同步到开发副本（已安装目录不需要测试脚本） */
const DEV_ONLY = [
  'scripts/selftest.js',
  'scripts/make-samples.js',
  'scripts/build-portable.js',
  'scripts/readme-text.js',
  'scripts/deploy.js',
  'CHANGELOG.md',
];

function sha1(file) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); } catch (e) { return null; }
}

async function syncOne(rel, destRoot) {
  const from = path.join(ROOT, rel);
  if (!fs.existsSync(from)) return 'missing';
  const to = path.join(destRoot, rel);
  if (sha1(from) === sha1(to)) return 'same';
  fs.mkdirSync(path.dirname(to), { recursive: true });
  await fsp.copyFile(from, to);
  return 'copied';
}

async function main() {
  if (!fs.existsSync(OUT_APP) || !fs.existsSync(OUT_DEV)) {
    throw new Error('找不到 D:\\拾光 或 D:\\PhotoHub，已中止');
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const report = { app: [], dev: [] };

  for (const rel of SOURCE_FILES) {
    if (await syncOne(rel, path.join(OUT_APP, 'resources', 'app')) === 'copied') report.app.push(rel);
    if (await syncOne(rel, OUT_DEV) === 'copied') report.dev.push(rel);
  }
  for (const rel of DEV_ONLY) {
    if (await syncOne(rel, OUT_DEV) === 'copied') report.dev.push(rel);
  }

  // 背景音乐（music/ 里的音频属于用户内容，不在上面的源码清单里；镜像同步过去）
  try {
    const musicSrc = path.join(ROOT, 'music');
    const musicDst = path.join(OUT_APP, 'resources', 'app', 'music');
    if (fs.existsSync(musicSrc)) {
      fs.mkdirSync(musicDst, { recursive: true });
      let copied = 0;
      for (const f of fs.readdirSync(musicSrc)) {
        const from = path.join(musicSrc, f);
        const to = path.join(musicDst, f);
        if (!fs.statSync(from).isFile()) continue;
        if (sha1(from) !== sha1(to)) { await fsp.copyFile(from, to); copied++; }
      }
      if (copied) report.app.push('music/（' + copied + ' 个音频）');
    }
  } catch (e) { /* music 目录不存在就算了 */ }

  // 开发副本用完整 package.json（含 devDependencies / scripts）
  await fsp.copyFile(path.join(ROOT, 'package.json'), path.join(OUT_DEV, 'package.json'));

  // 已安装目录用裁剪版：只保留运行时需要的字段
  const trimmed = {
    name: pkg.name, productName: pkg.productName, version: pkg.version,
    description: pkg.description, main: pkg.main, dependencies: pkg.dependencies,
  };
  fs.writeFileSync(path.join(OUT_APP, 'resources', 'app', 'package.json'), JSON.stringify(trimmed, null, 2));
  fs.writeFileSync(path.join(OUT_APP, '使用说明.txt'), readmeText(pkg.version));

  console.log('版本 ' + pkg.version);
  console.log('已安装目录更新 ' + report.app.length + ' 个文件' + (report.app.length ? '：\n  ' + report.app.join('\n  ') : ''));
  console.log('开发副本更新 ' + report.dev.length + ' 个文件' + (report.dev.length ? '：\n  ' + report.dev.join('\n  ') : ''));
  console.log('package.json / 使用说明.txt 已重写');
}

main().catch((e) => { console.error('部署失败:', e.message); process.exit(1); });
