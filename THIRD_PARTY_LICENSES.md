# 第三方组件与许可 · THIRD PARTY LICENSES

拾光（shiguang）自身代码以 [MIT](LICENSE) 许可发布。
本应用打包/依赖了以下第三方组件，各自的许可如下：

| 组件 | 用途 | 许可 | 来源 |
|---|---|---|---|
| Electron 33 | 桌面运行时 | MIT | https://github.com/electron/electron |
| Chromium（随 Electron 分发） | 渲染引擎 | BSD-3-Clause 等多项 | 见随程序附带的 `LICENSES.chromium.html` |
| sharp 0.33 | 图像解码/缩放/编辑 | Apache-2.0 | https://sharp.pixelplumbing.com |
| libvips（sharp 预编译） | 图像处理底层 | LGPL-2.1+ | https://www.libvips.org |
| ffmpeg | 视频缩略图 / 时长 / 元数据 | LGPL-2.1+（如使用 GPL 构建则为 GPL-3.0，请以所用构建的说明为准） | https://ffmpeg.org |
| exif-reader | EXIF 解析 | MIT | https://github.com/bnoordhuis/node-exif |
| heic-decode / libheif-js | HEIC 兜底解码 | LGPL-3.0 / GPL（libheif） | https://github.com/catdad/exiftool-vendored |
| lucide-static | 界面图标 | ISC | https://lucide.dev |
| Noto Serif SC | 界面字体 | SIL OFL 1.1 | https://fonts.google.com/noto |
| WinForms / .NET Framework | Windows 安装器 | 随系统分发 | — |

## 说明

- **ffmpeg**：本仓库不直接分发 ffmpeg 二进制（见 `.gitignore`）。发布版安装包/便携版内置的
  ffmpeg 构建请以对应 Release 页面注明的来源与许可为准；自行构建时请使用 LGPL 配置
  （默认官方构建即 LGPL）以避免 GPL 传染。
- **图片与字体**：`renderer/fonts/` 中的 Noto Serif SC 字体子集随源码分发，OFL 允许再分发，
  但不得单独作为字体商品出售。
- 若你基于本项目再分发，请保留本文件与上述各组件的许可声明。
