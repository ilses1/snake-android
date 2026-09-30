# 🐍 Snake Android · 3D 贪吃蛇安卓端

[Snake 3D](https://github.com/ilses1/snake-3d-tauri) 的安卓端 —— 复用主仓库里基于 Three.js 的 3D 游戏本体，
通过 Android WebView 承载，让同一份游戏代码在 **Web / 桌面 / 安卓** 三端保持一致：连续管状蛇身、五张主题地图、程序化 Web Audio 配乐一个都不少。

> 🚧 **仓库初始化中**：目前只有占位说明，Android 工程尚未创建。

## 规划

**技术路线**：Android WebView 套壳 —— 把 `index.html` + 本地化的 `three.module.js` 打进 `app/src/main/assets/`，运行时从 assets 加载，完全离线、无需联网。

**复用主仓库的既有成果**

- 游戏逻辑与渲染：`web/index.html`（Three.js r161，单文件）
- 蛇形模型、五张主题地图（沙滩 / 火山 / 山林 / 沼泽 / 大海）、程序化配乐
- 触屏操作：网页版已有的滑动 + 右下角虚拟方向键

**待办清单**

- [ ] 用 Android Studio 创建 Kotlin 工程（`minSdk` 建议 24+，确保 WebView 对 WebGL / Web Audio 的支持）
- [ ] 从主仓库同步 `web/index.html` 与 `three.module.js` 到 `app/src/main/assets/`，并写一个同步脚本
- [ ] WebView 配置：开启硬件加速与 WebGL、禁用缩放与滚动条、沉浸式全屏、`onBackPressed` 处理
- [ ] 触摸与横竖屏适配、刘海屏安全区
- [ ] 音频策略：Web Audio 需要用户手势解锁，处理首次触摸激活
- [ ] 应用图标与启动图（沿用主仓库的 `tauri-app/icon.png`）
- [ ] CI：GitHub Actions 构建 APK / AAB 并附到 Release

## 相关仓库

| 仓库 | 说明 |
| --- | --- |
| [snake-3d-tauri](https://github.com/ilses1/snake-3d-tauri) | 主仓库：网页版（单 HTML）+ Tauri 桌面版（Windows / macOS / Linux） |
| snake-android | 本仓库：安卓端（规划中） |

## License

[MIT](https://github.com/ilses1/snake-3d-tauri/blob/main/LICENSE)
