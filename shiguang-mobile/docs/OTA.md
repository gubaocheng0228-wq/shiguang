# 拾光 · 应用内更新（OTA）

用户打开 App → 设置 → 「检查更新」→ 看到新版本说明 → 点「下载并更新」→ 下载完成 → 「安装」→ 系统确认一次 → 覆盖安装，数据保留。

---

## 一、它是怎么跑起来的

```
                              ┌──────────────────────────────┐
  App 启动 2.5 秒后            │  http://your-server.example/       │
  GET latest.json?t=<ts>  ────▶│    shiguang/latest.json       │
                              │    shiguang/apk/shiguang-x.apk│
                              └──────────────────────────────┘
         │
         ├─ 用内置公钥验 RSA 签名（防止清单被篡改 / 降级攻击）
         ├─ 比 versionCode，比本机大才提示
         ├─ 用户点更新 → 下载到 cacheDir/update/ → 校验 sha256
         ├─ 交给系统安装器（content:// + ACTION_VIEW）
         └─ 覆盖安装，收藏与设置保留
```

- 清单地址写死在 `UpdateManager.MANIFEST_URL`；换域名只改这一处 + 发布脚本里的 `BASE_URL`。
- 用明文 HTTP 也安全：**APK 必须由你的 keystore 签名**，别人伪造的包系统会直接拒装；清单再用 RSA 签名，连"降级到旧版本"都做不了。
- 没网、服务器挂了、签名不对，都只会静默失败，不影响打开 App。

## 二、服务器上的目录

```
/www/wwwroot/your-server.example/shiguang/
├── latest.json          # 版本清单（覆盖它就等于发布）
└── apk/
    ├── shiguang-1.0.2.apk
    └── shiguang-1.0.3.apk   # 旧版本不要删，便于回滚
```

对外地址：

- 清单：`http://your-server.example/shiguang/latest.json`
- 安装包：`http://your-server.example/shiguang/apk/shiguang-1.0.2.apk`

> 现在用的是 80 端口的明文 HTTP（那台机器的 443 是自签证书，Android 不认）。
> 以后有了已备案域名，把 `BASE_URL` 改成 `https://你的域名/shiguang` 即可，客户端不用改代码，只要发一版新 APK。

## 三、发一版新的（三步）

```bash
# 1. 改版本号（app/build.gradle）
versionCode 4
versionName '1.0.3'

# 2. 编译
gradle -p shiguang-mobile assembleRelease

# 3. 发布（签名清单 + 上传 + 改权限）
node scripts/publish-release.js --ver 1.0.3 --code 4 --notes "这次改了什么" --upload
```

`publish-release.js` 会做这些事：

1. 把 APK 复制到 `dist/apk/shiguang-1.0.3.apk`
2. 用 `aapt2` 读 APK 里的真实版本号，**和 `--ver/--code` 不一致就拒绝发布**（防止清单和包对不上）
3. 算 sha256
4. 生成 `dist/latest.json`，用 `keystore/update-key.pem` 做 RSA-SHA256 签名
5. `scp` 上传，`chown www:www`
6. 打印验证命令

## 四、验证

```bash
node scripts/verify-update.js
```

会：拉清单 → 用 **App 里那份公钥**验签 → 下载 APK → 比对 sha256 与大小。
输出 `PASS` 就说明手机上"检查更新 → 下载 → 安装"这条链是通的。

## 五、密钥与安全

| 文件 | 作用 | 注意 |
|---|---|---|
| `keystore/shiguang.jks` | **APK 签名**（决定"能不能覆盖安装"） | 丢了 = 以后的新包都装不上，只能卸载重装 |
| `keystore/update-key.pem` | **更新清单签名**（决定"App 认不认这个清单"） | 丢了 = 只能换密钥并重发 APK；泄露 = 别人能推假清单（但装不进假包，因为 APK 还要过第一道签名） |

- 两个文件都**不要**进仓库、不要上传网盘。
- 备份建议：拷到 U 盘 + 一个加密压缩包。
- `app/src/main/java/com/shiguang/app/UpdateKey.java` 里是**公钥**，随包发布，安全。

## 六、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 点检查更新提示"清单签名校验失败" | 发布时用的私钥和 App 内公钥不是一对。检查 `keystore/update-key.pem` 是否被换过 |
| 下载卡住 / 失败 | 服务器带宽约 3Mbps，26MB 需要 ~80 秒；网络差会超时，重试即可 |
| 提示"需要允许安装未知应用" | 正常，第一次必须手动允许；跳转后打开开关，回来再点安装 |
| 安装时提示"签名不一致" | 新包不是用 `shiguang.jks` 签的，或者用户装的是别的渠道的包 |
| 提示"已是最新"但其实发了新版 | `versionCode` 没往上加（必须比手机上的大） |
| 想回滚 | 把 `latest.json` 指回旧 APK **不起作用**（code 更小不会提示）。要回滚就发一个 code 更大的旧功能版本 |

## 七、还没做的部分

- **静默安装**：Android 不允许普通应用静默装 APK，必须用户点一次确认（除非用 adb 把手机设为 device owner）。
- **界面层热更新**：目前每次都要重装 APK（26MB）。如果以后想"改个文案 2 秒生效"，可以再叠一层 www 热更新（更新包只有几十 KB），架构上已经预留了位置。
