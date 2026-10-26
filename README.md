# 拾光 · shiguang

> 本地照片回忆库 —— 一个纯本地运行的 Windows 桌面相册应用。
> 照片、视频、时间轴、幻灯片，全部数据只存在你自己的电脑里，不联网、不上传。

**English**: shiguang ("picking up light") is a fully local-first photo & video memory app for Windows, built with Electron. No account, no cloud, no upload — your media never leaves your machine.

<p align="center">
  <img src="docs/screenshot-main.png" width="720" alt="拾光主界面">
</p>
<p align="center">
  <img src="docs/screenshot-slideshow.png" width="420" alt="幻灯片放映">
  <img src="docs/screenshot-installer.png" width="420" alt="安装器">
</p>

## ✨ 功能

- **时间线**：按年/月自动归档的瀑布流，底部密度时间轴——拖动读时间、松手跳转、滚轮在 年/月/日 三级间缩放
- **那年今日**：像手机相册一样，把往年今天的故事放在首屏
- **幻灯片放映**：全屏交叉淡入淡出，照片按时间正序轮播，底部时间轴同步跟随
- **放映背景音乐**：把 `.mp3 / .m4a` 等放进项目根目录 `music\`，放映时随机循环播放（`M` 开关）
- **大图查看器**：缩放/拖拽、收藏、1-5 星、旋转/裁剪/调色（编辑自动备份原文件、保留拍摄日期）
- **相册**：把任意照片归入相册，随时打开
- **回收站**：删除先进回收站（带缩略图），可恢复或彻底清空；编辑前自动备份
- **搜索**：文件名 + 日期数字（`202610` = 2026 年 10 月）
- **HEIC / HEIF / AVIF / TIFF**：自动转码预览，Windows 缺解码器也能看
- **首次使用引导**：新装用户第一次打开会自动分步介绍所有功能
- **沉浸模式**：静止几秒后界面自动隐去，只留照片

## 📦 安装

两种方式，任选其一（数据都存在本地，互不影响）：

1. **安装包**：到 [Releases](../../releases) 下载 `shiguang-setup-1.0.0.exe`，双击安装（不需要管理员权限）
2. **便携版**：下载便携版压缩包解压后，直接运行 `shiguang.exe`

> 视频缩略图与时长探测依赖 **ffmpeg**：安装包与便携版已内置；从源码运行请自行把 `ffmpeg.exe` 放到 `bin\` 目录。

## 🛠 从源码运行

需要 Node.js 18+ 和 npm。

```powershell
npm install          # sharp 会自动拉取预编译二进制
npm start            # 启动
npm test             # 数据层自测（58 项）
npm run smoke        # 界面冒烟（自动打开、自动退出、输出 [SMOKE] 报告）
npm run build        # 打包便携版（输出目录在 scripts/build-portable.js 顶部可改）
```

> 视频功能需要 ffmpeg：从 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 或 [BtbN builds](https://github.com/BtbN/FFmpeg-Builds/releases) 下载 Windows 构建，把 `ffmpeg.exe` 放到项目根目录的 `bin\` 下（没有它，图片功能不受影响，只是视频没有缩略图和时长）。

## 🎵 放映背景音乐

把 `.mp3 / .m4a / .aac / .flac / .wav / .ogg / .opus` 音频文件放进项目根目录的 `music\` 文件夹，幻灯片放映时会**随机起播、循环播放**，右上角显示当前曲名。放映中按 `M` 暂停/继续，设置里可整体关闭。

> 请只放入你拥有再分发权的音频文件。

## 🧪 开发说明

- **数据引擎**：`lib/library.js` —— 扫描、缩略图优先级队列、直方图、二分定位、编辑原子写、回收站
- **主进程**：`main.js` —— 窗口、自定义协议 `sg://`（缩略图/预览/原图/音乐按需生成）、IPC
- **渲染层**：`renderer/` —— 时间线、大图查看器、幻灯片、相册、回收站
- **测试**：`scripts/selftest.js` 在临时沙盒中自建照片/视频库，跑完自动清理
- **打包**：`scripts/build-portable.js`（Electron 运行时 + 生产依赖 + 使用说明）；`pack/` 是单文件安装器的源码

```
shiguang/
├── main.js            # Electron 主进程
├── preload.js         # 上下文隔离桥（白名单 IPC）
├── lib/library.js     # 数据引擎
├── renderer/          # 界面（原生 JS，无框架）
├── scripts/           # 自测 / 打包 / 图标 / 示例
├── pack/              # 安装器（C# WinForms，单文件 exe）
├── music/             # 放映背景音乐（用户自备）
└── bin/ffmpeg.exe     # 运行时依赖（不入库）
```

## 🔒 数据存放在哪

- 索引、缩略图、回收站、相册：默认 `D:\拾光数据`（可在代码里改），与程序目录完全分离
- 没有对应盘符时自动退回到系统「图片」目录
- 卸载程序**不会**删除数据目录

## 🧱 技术栈

Electron 33 · 原生 JavaScript（无前端框架）· sharp（图像）· ffmpeg（视频）· libheif（HEIC）· WinForms（安装器）

## 📄 许可

[MIT](LICENSE) © 2026

第三方组件许可见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
