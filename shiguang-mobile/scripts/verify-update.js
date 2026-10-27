/* 端到端验证更新通道：拉清单 → 用 App 内嵌公钥验签 → 下载 APK → 校验 sha256
   用法： node scripts/verify-update.js */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const https = require('http');

const ROOT = path.join(__dirname, '..');
const MANIFEST = 'http://your-server.example/shiguang/latest.json';

function get(url, outFile, retried) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'Cache-Control': 'no-cache' } }, res => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      if (!outFile) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        return;
      }
      let got = 0;
      res.on('data', c => { got += c.length; });
      const f = fs.createWriteStream(outFile);
      res.pipe(f);
      f.on('finish', () => f.close(() => resolve(outFile)));
      f.on('error', reject);
    });
    req.on('error', err => {
      if (!retried) { setTimeout(() => get(url, outFile, true).then(resolve).catch(reject), 1500); return; }
      reject(err);
    });
    req.setTimeout(180000, () => req.destroy(new Error('timeout')));
  });
}

(async () => {
  console.log('1) 拉清单', MANIFEST);
  const raw = await get(MANIFEST);
  const o = JSON.parse(raw.toString('utf8'));
  console.log('   versionCode =', o.versionCode, ' versionName =', o.versionName);
  console.log('   size =', (o.size / 1048576).toFixed(1), 'MB   notes =', o.notes);

  console.log('2) 用 App 内嵌公钥验签');
  const javaSrc = fs.readFileSync(path.join(ROOT, 'app/src/main/java/com/shiguang/app/UpdateKey.java'), 'utf8');
  const b64 = /PUBKEY_B64\s*=\s*"([^"]+)"/.exec(javaSrc)[1];
  const pub = crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
  const payload = `${o.versionCode}|${o.versionName}|${o.sha256}|${o.size}|${o.url}`;
  const ok = crypto.verify('sha256', Buffer.from(payload, 'utf8'), pub, Buffer.from(o.sig, 'base64'));
  console.log('   签名', ok ? '✅ 通过' : '❌ 失败');

  console.log('3) 下载 APK 并算 sha256');
  const tmp = path.join(require('os').tmpdir(), 'sg-verify.apk');
  await get(o.url, tmp);
  const buf = fs.readFileSync(tmp);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  console.log('   本地大小 =', buf.length, ' 清单大小 =', o.size, buf.length === o.size ? '✅' : '❌');
  console.log('   本地 sha256 =', sha);
  console.log('   清单 sha256 =', o.sha256, sha === o.sha256 ? '✅' : '❌');
  fs.unlinkSync(tmp);

  console.log('');
  const pass = ok && sha === o.sha256 && buf.length === o.size;
  console.log(pass ? 'PASS · 更新通道可用：清单可验签、APK 完整' : 'FAIL · 有一项不对');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
