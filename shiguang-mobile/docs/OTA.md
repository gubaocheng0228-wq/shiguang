# 拾光 · 应用内更新（OTA）

用户打开 App → 设置 → 「检查更新」→ 看到新版本说明 → 点「下载并更新」→ 下载完成 → 「安装」→ 系统确认一次 → 覆盖安装，数据保留。

---

## 一、它是怎么跑起来的

```
                              ┌────────────────────────────────┐
   App 启动 2.5 秒后           │  https://你的服务器/shiguang/   │
   GET latest.json?t=<ts> ────▶│     latest.json                │
                              │     apk/shiguang-x.y.z.apk     │
                              └────────────────────────────────┘
         │
         ├─ 用内置公钥验 RSA 签名（防止清单被篡改 / 降级攻击）
         ├─ 比 versionCode，比本机大才提示
         ├─ 用户点更新 → 下载到 cacheDir/update/ → 校验 sha256
         ├─ 交给系统安装器（content:// + ACTION_VIEW）
         └─ 覆盖安装，收藏与设置保留
```

- **清单地址不在源码里**：写在 `local.properties` 的 `sg.updateUrl`，构建时由 Gradle 编成常量（`BuildConfig.UPDATE_URL`）。`local.properties` 已被 `.gitignore` 忽略。
- 注意：这个地址最终会出现在 APK 里，属于公开信息。所以服务器安全**不靠隐藏地址**，而是靠：APK 必须由你的 keystore 签名（伪造包装不上）+ 清单再用 RSA 签名（连降级都做不了）。
- 没网、服务器挂了、签名不对，都只会静默失败，不影响打开 App。

## 二、本地配置（一次性）

在 `shiguang-mobile/local.properties` 里填（这个文件不进仓库）：

```properties
sg.updateUrl=https://你的域名/shiguang/latest.json
sg.baseUrl=https://你的域名/shiguang
sg.host=root@你的服务器
sg.remoteDir=/var/www/shiguang
sg.sshPort=22
sg.sshKey=C:\Users\你\.ssh\your_deploy_key
```

| 键 | 给谁用 |
|---|---|
| `sg.updateUrl` | 编译进 APK 的更新清单地址（`UpdateManager.MANIFEST_URL`） |
| `sg.baseUrl` / `sg.host` / `sg.remoteDir` / `sg.sshPort` / `sg.sshKey` | `scripts/publish-release.js` 上传用 |

也可以用环境变量覆盖：`SG_HOST`、`SG_BASE_URL`、`SG_REMOTE_DIR`、`SG_SSH_PORT`、`SG_SSH_KEY`、`SG_UPDATE_URL`。

## 三、服务器上的目录

```
/var/www/shiguang/                 # 换成你自己 nginx 的站点目录
├── latest.json                    # 版本清单（覆盖它就等于发布）
└── apk/
    ├── shiguang-1.0.2.apk
    └── shiguang-1.0.3.apk         # 旧版本不要删，便于回滚
```

对外地址：

- 清单：`https://你的域名/shiguang/latest.json`
- 安装包：`https://你的域名/shiguang/apk/shiguang-1.0.3.apk`

> 建议用 HTTPS。如果只能用 IP + HTTP，务必保留签名校验（本方案默认就有），并且不要把服务器密码/密钥放在仓库里。
> nginx 记得给 `latest.json` 加 `Cache-Control: no-cache`，否则手机可能一直看到旧清单（客户端另外还带了 `?t=<时间戳>`，双保险）。

## 四、发一版新的（三步）

```bash
# 1. 改版本号（app/build.gradle）
versionCode 4
versionName '1.0.3'

# 2. 编译
gradle -p shiguang-mobile assembleRelease

# 3. 发布（签名清单 + 上传 + 改权限）
node shiguang-mobile/scripts/publish-release.js --ver 1.0.3 --code 4 --notes "这次改了什么" --upload
```

`publish-release.js` 会做这些事：

1. 把 APK 复制到 `dist/apk/shiguang-1.0.3.apk`
2. 用 `aapt2` 读 APK 里的真实版本号，**和 `--ver/--code` 不一致就拒绝发布**
3. 算 sha256
4. 生成 `dist/latest.json`，用 `keystore/update-key.pem` 做 RSA-SHA256 签名
5. `scp` 上传，`chown www:www`
6. 打印验证命令

## 五、验证

```bash
node shiguang-mobile/scripts/verify-update.js
```

会：拉清单 → 用 **App 里那份公钥**验签 → 下载 APK → 比对 sha256 与大小。
输出 `PASS` 就说明"检查更新 → 下载 → 安装"这条链是通的。

## 六、密钥与安全

| 文件 | 作用 | 注意 |
|---|---|---|
| `keystore/shiguang.jks` | **APK 签名**（决定"能不能覆盖安装"） | 丢了 = 以后的新包都装不上，只能卸载重装 |
| `keystore/update-key.pem` | **更新清单签名**（决定"App 认不认这个清单"） | 丢了 = 只能换密钥并重发 APK |

- 两个文件都**不要**进仓库、不要上传网盘（`.gitignore` 已挡住）。
- 备份：U 盘 + 一个加密压缩包。
- `UpdateKey.java` 里是**公钥**，随包发布，安全。

## 七、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 提示"清单签名校验失败" | 发布用的私钥和 App 内公钥不是一对。检查 `keystore/update-key.pem` 是否被换过 |
| 下载卡住 / 失败 | 看服务器带宽：26MB 在 3Mbps 下约 80 秒，网络差会超时，重试即可 |
| 提示"需要允许安装未知应用" | 正常，第一次必须手动允许；跳转后打开开关，回来再点安装 |
| 安装时提示"签名不一致" | 新包不是用同一个 keystore 签的，或用户装的是别的渠道的包 |
| 提示"已是最新"但其实发了新版 | `versionCode` 没往上加（必须比手机上的大） |
| 想回滚 | 把 `latest.json` 指回旧 APK **不起作用**（code 更小不会提示）。要回滚就发一个 code 更大的旧功能版本 |

## 八、还没做的部分

- **静默安装**：Android 不允许普通应用静默装 APK，必须用户点一次确认（除非用 adb 把手机设为 device owner）。
- **界面层热更新**：目前每次都要重装 APK。如果以后想"改个文案 2 秒生效"，可以再叠一层 www 热更新（更新包只有几十 KB）。
