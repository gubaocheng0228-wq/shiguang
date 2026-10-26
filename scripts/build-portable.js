'use strict';
/**
 * 打包便携版到 D:\拾光：
 *   拾光.exe（Electron 运行时）+ resources\app（应用代码与生产依赖）
 *   并在桌面创建快捷方式（图标：拾光.ico）
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = 'D:\\拾光';
const electronExe = require('electron'); // node 环境下返回 electron.exe 路径
const DIST = path.dirname(electronExe);

async function copyDir(src, dest) {
  await fsp.cp(src, dest, { recursive: true, force: true });
}

async function main() {
  console.log('Electron 运行时:', DIST);
  if (!fs.existsSync(path.join(DIST, 'electron.exe'))) throw new Error('找不到 electron.exe');

  // 1) 清空并复制运行时
  await fsp.rm(OUT, { recursive: true, force: true });
  await copyDir(DIST, OUT);

  // 2) 应用目录
  const appDir = path.join(OUT, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const item of ['main.js', 'preload.js', 'lib', 'renderer']) {
    await copyDir(path.join(ROOT, item), path.join(appDir, item));
  }
  fs.mkdirSync(path.join(appDir, 'build'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'build', 'icon.png'), path.join(appDir, 'build', 'icon.png'));
  fs.copyFileSync(path.join(ROOT, 'build', '拾光.ico'), path.join(appDir, 'build', '拾光.ico'));

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({
    name: pkg.name, productName: pkg.productName, version: pkg.version,
    description: pkg.description, main: pkg.main,
    dependencies: pkg.dependencies,
  }, null, 2));

  // 3) 生产依赖
  console.log('安装生产依赖（sharp / exif-reader / heic-decode / ffmpeg）…');
  execSync('npm install --omit=dev --no-audit --no-fund', {
    cwd: appDir,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/' },
  });

  // 新版 ffmpeg（若已下载到 bin/）
  const localFf = path.join(ROOT, 'bin', 'ffmpeg.exe');
  if (fs.existsSync(localFf)) {
    fs.mkdirSync(path.join(appDir, 'bin'), { recursive: true });
    fs.copyFileSync(localFf, path.join(appDir, 'bin', 'ffmpeg.exe'));
    console.log('已内置新版 ffmpeg');
  }

  // 4) 重命名主程序
  await fsp.rename(path.join(OUT, 'electron.exe'), path.join(OUT, '拾光.exe'));

  // 4.5) 只留中英文语言包，省 ~39MB（55 个 .pak 里其余都用不到）
  try {
    const locDir = path.join(OUT, 'locales');
    let removed = 0;
    for (const f of fs.readdirSync(locDir)) {
      if (!/^(zh-CN|zh-TW|en-US|en-GB)\.pak$/i.test(f)) { fs.unlinkSync(path.join(locDir, f)); removed++; }
    }
    console.log(`已裁剪语言包：删除 ${removed} 个，保留 zh-CN / en-US 等`);
  } catch (e) { /* 没有 locales 目录就算了 */ }

  // 5) 使用说明（正文与 deploy.js 共用）
  fs.writeFileSync(path.join(OUT, '使用说明.txt'), require('./readme-text')(pkg.version));

  // 6) 桌面快捷方式
  const ps = [
    `$d=[Environment]::GetFolderPath('Desktop');`,
    `$w=New-Object -ComObject WScript.Shell;`,
    `$s=$w.CreateShortcut((Join-Path $d '拾光.lnk'));`,
    `$s.TargetPath='${OUT}\\拾光.exe';`,
    `$s.WorkingDirectory='${OUT}';`,
    `$s.IconLocation='${appDir}\\build\\拾光.ico';`,
    `$s.Description='拾光 · 本地照片回忆库';`,
    `$s.Save();`,
    `Write-Output ('Shortcut: ' + (Join-Path $d '拾光.lnk'))`,
  ].join(' ');
  execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });

  console.log('\n打包完成 → ' + OUT);
}

main().catch(e => { console.error(e); process.exit(1); });
