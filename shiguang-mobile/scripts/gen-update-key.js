/* 生成/复用「更新清单签名密钥」，并把公钥写进 Java 常量
   用法： node scripts/gen-update-key.js
   私钥：keystore/update-key.pem（绝不打进 APK，也不要提交到任何仓库） */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pemPath = path.join(ROOT, 'keystore', 'update-key.pem');
const javaPath = path.join(ROOT, 'app', 'src', 'main', 'java', 'com', 'shiguang', 'app', 'UpdateKey.java');

fs.mkdirSync(path.dirname(pemPath), { recursive: true });

let pubDer;
if (fs.existsSync(pemPath)) {
  pubDer = crypto.createPublicKey(fs.readFileSync(pemPath)).export({ type: 'spki', format: 'der' });
  console.log('复用已有私钥:', pemPath);
} else {
  const kp = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  fs.writeFileSync(pemPath, kp.privateKey, { mode: 0o600 });
  pubDer = kp.publicKey;
  console.log('已生成新私钥:', pemPath);
}

const b64 = pubDer.toString('base64');
const java = `package com.shiguang.app;

/**
 * 更新清单的验签公钥。私钥在 keystore/update-key.pem，只在你电脑上。
 * 换密钥 = 所有已安装的 App 都无法再接受新的更新清单（除非重发 APK）。
 */
final class UpdateKey {
    private UpdateKey() { }

    static final String PUBKEY_B64 =
            "${b64}";
}
`;
fs.writeFileSync(javaPath, java, 'utf8');
console.log('公钥已写入:', javaPath);
console.log('公钥(base64, 前 48 字符):', b64.slice(0, 48) + '…');
