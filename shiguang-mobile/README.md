# 拾光 · 手机版（Android）

> 把手机里的照片和视频，排成一条可以往回走的时光长廊。
> 电脑版「拾光」原样保留，这是同一套气质的手机端实现 —— 各自守着自己设备上的照片。

---

## 它是什么

- **纯本地**：没有账号、没有云端、没有上传。只读系统相册（MediaStore），不复制、不移动、不修改任何文件。
- **时间线**：按年月分块 + 虚拟滚动（几千张也不卡），右侧「记忆密度光带」按住滑动可以一步跨过好几年。
- **全屏放映**：交叉淡入 + 缓慢推近（Ken Burns）+ 内置背景音乐 + 底部时间轴跟随镜头。
- **大图**：左右翻页、双指缩放、双击放大、下滑退出；视频用原画播放，可拖动进度。
- **收藏 / 隐藏 / 搜索 / 首次引导 / 那年今日**。

## 运行要求

| 项目 | 要求 |
|---|---|
| 系统 | Android 7.0（API 24）及以上 |
| 权限 | Android 13+ 用照片/视频细粒度权限；Android 14 支持「仅选择部分照片」 |
| 网络 | 不需要（应用内只有一个只监听 127.0.0.1 的临时服务，用来把图片喂给界面） |

## 为什么是「原生壳 + WebView」

电脑版是 Electron（Chromium + Node），能用 sharp 做缩略图、用 ffmpeg 读视频。
手机上既没有 Node，也不适合塞这些原生库，所以：

- **原生侧（Java）**负责：读 MediaStore 建索引、生成并缓存缩略图、把原图/视频/音乐以字节流提供出去、权限、沉浸式全屏、分享、返回键。
- **界面侧（HTML/CSS/JS）**负责：和电脑版同一套视觉语言，交互按手指重写（触摸、惯性滚动、手势缩放）。

WebView 与电脑版是同一个 Chromium 内核，CSS 表现基本一致，这也是为什么可以用桌面 Electron 做界面预览。

## 工程结构

```
shiguang-mobile/
├── app/src/main/java/com/shiguang/app/
│   ├── MainActivity.java     WebView 壳：JS 桥、权限、沉浸式、返回键、分享、常亮
│   ├── MediaRepo.java        MediaStore 索引 + 缩略图磁盘缓存 + 音乐清单
│   └── AssetServer.java      127.0.0.1 上的迷你 HTTP 服务：/t 缩略图 /f 原图(支持 Range) /m 音乐
├── app/src/main/assets/
│   ├── www/                  index.html base.css pages.css icons.js native.js
│   │                         app.js home.js timeline.js viewer.js slideshow.js
│   └── music/                01.m4a 02.m4a tracks.txt（"文件名|显示名"）
├── app/src/main/res/         启动图标（自适应图标 + 各密度）
├── dev/                      桌面预览：Electron + 假数据 + 逐屏截图（不打包进 APK）
├── scripts/                  gen-icons.py（出图标）/ gen-icons.js（抽图标）/ audit.js（静态自检）
└── keystore/shiguang.jks     发布签名（alias: shiguang，口令见 app/build.gradle）
```

## 构建

需要 JDK 17+、Android SDK Platform 34、Build-Tools 34.0.0、Gradle 8.7（AGP 8.5.2 可离线用缓存）。

```bash
export JAVA_HOME=/path/to/jdk21
export ANDROID_HOME=/path/to/android-sdk
gradle -p shiguang-mobile assembleRelease     # 产物 app/build/outputs/apk/release/app-release.apk
gradle -p shiguang-mobile assembleDebug       # 调试包
```

Windows 上本机验证过的命令：

```powershell
$env:JAVA_HOME="D:\android-dev\jdk21"; $env:ANDROID_HOME="D:\android-dev\sdk"
$env:GRADLE_USER_HOME="D:\android-dev\gradle-home"
D:\android-dev\gradle\gradle-8.7\bin\gradle.bat -p <本目录> --offline assembleRelease
```

## 界面预览（开发用，不进包）

```bash
node dev/prepare.js     # 把 assets/www 同步到 dev/ 并注入假数据
electron dev            # 逐屏截图输出到 dev/out/
```

假数据来自 `D:\android-dev\testmedia` 的样例照片，不涉及任何个人照片。

## 自检

```bash
node scripts/audit.js
```

检查：HTML 里的 id 与 JS 引用是否对得上、图标名是否存在、静态文件是否齐全、JS 桥方法是否和 `MainActivity` 一致、资源与音乐文件是否齐备。当前结果：**PASS**。

## 应用内更新（OTA）

Android 端支持应用内「检查更新 → 下载 → 安装」，服务器与发布流程见 [docs/OTA.md](docs/OTA.md)。
发布一条命令：
ode scripts/publish-release.js --ver 1.0.3 --code 4 --notes "..." --upload`n
## 和电脑版的差异

| | 电脑版 | 手机版 |
|---|---|---|
| 图库来源 | 指定一个文件夹（如 `D:\IQOO`） | 系统相册（MediaStore） |
| 编辑 | 旋转/裁剪/亮度对比饱和，写回文件 | 无（手机系统相册自带的编辑更合适） |
| 回收站 | 移到 `_trash` 目录，可还原 | 「隐藏」，只影响拾光里的显示 |
| 幻灯片 | 全屏交叉淡入 + 音乐 | 同左，另加手势与底部时间轴 |
| 视频 | 原画播放 | 同左；放映时显示封面帧 |

## 已知边界

- 只做 Android。iOS 需要 macOS + Xcode，Windows 上无法出包。
- 放映以照片为主；视频在放映里显示封面帧。
- 未做多选、地图、按人物聚合、云同步。
- 缩略图缓存上限约 400MB / 60 天，会自动清理；清应用缓存后会重新生成。

## 许可证

与电脑版一致，见仓库根目录 `LICENSE`。内置图标来自 [lucide](https://lucide.dev)（ISC License），字体为 Noto Serif SC（SIL OFL 1.1）。
