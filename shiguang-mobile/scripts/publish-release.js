/* 发布一版：打包 APK → 算 sha256 → 生成并签名 latest.json → 上传到服务器
   用法：
     node scripts/publish-release.js --ver 1.0.2 --code 3 --notes "修好放映发糊"
     node scripts/publish-release.js --ver 1.0.2 --code 3 --notes "..." --upload
   说明：
     --apk <path>  指定 APK（默认取 build/outputs/apk/release/app-release.apk）
     --upload      用 ssh/scp 传到服务器（密钥默认 ~/.ssh/shiguang_deploy）
     --dry         只生成文件，不上传
*/
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const KEY = path.join(ROOT, 'keystore', 'update-key.pem');

// 服务器信息（换成自己的域名时同步改这里 + UpdateManager.MANIFEST_URL）
const HOST = 'root@your-server.example';
const PORT = '22';
const REMOTE_DIR = '/www/wwwroot/your-server.example/shiguang';
const BASE_URL = 'http://your-server.example/shiguang';
const SSH_KEY = path.join(process.env.USERPROFILE || process.env.HOME || '', '.ssh', 'shiguang_deploy');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) return true;
  return v;
}
const has = name => process.argv.includes('--' + name);

const ver = arg('ver');
const code = Number(arg('code'));
const notes = arg('notes', '');
const apkPath = arg('apk', path.join(ROOT, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'));

if (!ver || !code) {
  console.error('用法: node scripts/publish-release.js --ver 1.0.2 --code 3 --notes "更新说明" [--upload]');
  process.exit(1);
}
if (!fs.existsSync(apkPath)) {
  console.error('找不到 APK：' + apkPath + '\n先执行 gradle assembleRelease');
  process.exit(1);
}
if (!fs.existsSync(KEY)) {
  console.error('找不到签名私钥：' + KEY + '\n先执行 node scripts/gen-update-key.js');
  process.exit(1);
}

// 1) 复制 APK 到 dist/apk/
fs.mkdirSync(path.join(DIST, 'apk'), { recursive: true });
const apkName = 'shiguang-' + ver + '.apk';
const apkOut = path.join(DIST, 'apk', apkName);
fs.copyFileSync(apkPath, apkOut);

// 2) 校验 APK 内版本号是否和要发布的版本一致
const badging = execFileSync(path.join(process.env.ANDROID_HOME || 'D:\\android-dev\\sdk', 'build-tools', '34.0.0', 'aapt2.exe'),
  ['dump', 'badging', apkOut], { encoding: 'utf8' });
const m = /versionCode='(\d+)' versionName='([^']+)'/.exec(badging);
if (!m) { console.error('读不出 APK 版本号'); process.exit(1); }
if (Number(m[1]) !== code || m[2] !== ver) {
  console.error(`APK 里的版本是 ${m[2]}(${m[1]})，和要发布的 ${ver}(${code}) 不一致。`);
  console.error('请先改 app/build.gradle 的 versionCode / versionName 并重新编译。');
  process.exit(1);
}

// 3) 算哈希
const buf = fs.readFileSync(apkOut);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const size = buf.length;

// 4) 生成清单并签名
const url = BASE_URL + '/apk/' + apkName;
const payload = `${code}|${ver}|${sha256}|${size}|${url}`;
const sig = crypto.sign('sha256', Buffer.from(payload, 'utf8'), fs.readFileSync(KEY)).toString('base64');

const manifest = {
  versionCode: code,
  versionName: ver,
  url,
  sha256,
  size,
  notes,
  minSdk: 24,
  force: false,
  builtAt: new Date().toISOString(),
  sig
};
fs.writeFileSync(path.join(DIST, 'latest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log('版本    :', ver, '(' + code + ')');
console.log('大小    :', (size / 1048576).toFixed(1), 'MB');
console.log('sha256  :', sha256);
console.log('地址    :', url);
console.log('产物    : dist/apk/' + apkName + ' , dist/latest.json');

// 5) 上传
if (has('upload')) {
  if (!fs.existsSync(SSH_KEY)) {
    console.error('找不到部署密钥：' + SSH_KEY);
    process.exit(1);
  }
  const sshOpts = ['-i', SSH_KEY, '-P', PORT, '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes'];
  console.log('\n上传中…');
  execFileSync('scp', [...sshOpts, apkOut, `${HOST}:${REMOTE_DIR}/apk/${apkName}`], { stdio: 'inherit' });
  execFileSync('scp', [...sshOpts, path.join(DIST, 'latest.json'), `${HOST}:${REMOTE_DIR}/latest.json`], { stdio: 'inherit' });
  execFileSync('ssh', ['-i', SSH_KEY, '-p', PORT, '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes',
    HOST, `chown -R www:www ${REMOTE_DIR}; ls -l ${REMOTE_DIR}/latest.json ${REMOTE_DIR}/apk/${apkName}`],
    { stdio: 'inherit' });
  console.log('\n已上传。可以验证：');
  console.log('  curl ' + BASE_URL + '/latest.json');
}
