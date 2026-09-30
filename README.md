# 🐍 Snake Android · 3D 贪吃蛇安卓端

[Snake 3D](https://github.com/ilses1/snake-3d-tauri) 的安卓端。复用主仓库里基于 Three.js 的 3D 游戏本体，
通过原生 Kotlin WebView 外壳承载，让同一份游戏代码在 **Web / 桌面 / 安卓** 三端保持一致：
连续管状蛇身、五张主题地图（沙滩 / 火山 / 山林 / 沼泽 / 大海）、程序化 Web Audio 配乐一个都不少。

| 项目 | 值 |
| --- | --- |
| 应用名 | 贪吃蛇 |
| 包名 | `com.ilses1.snake`（debug 版带 `.debug` 后缀，可与正式版并存） |
| 版本 | `1.0.0` (versionCode 1) |
| compileSdk / targetSdk / minSdk | 35 / 35 / **24**（Android 7.0） |
| 权限 | **零权限**。完全离线，不申请网络、存储等任何权限 |

## 技术方案

**原生 Kotlin WebView 套壳**，而不是 WebView + Cordova 之类的混合框架：

- **游戏逻辑零改动**：`web/index.html`（单文件，Three.js r161）原样打包进 `app/src/main/assets/`，
  与网页版、桌面版共用同一份代码，三端行为天然一致。
- **只加一层薄壳**：`MainActivity.kt` 只做四件事 —— 全屏承载、离线资源映射、生命周期联动、返回键转发。
- **完全离线**：`three.module.js`（1.25 MB）已本地化到 assets，页面里没有任何外部请求。

### 为什么必须用 `WebViewAssetLoader`

这是整个方案里唯一一个非显然的点：

1. 游戏用 `<script type="importmap">` + ES module 加载 Three.js，而 **importmap 需要 WebView 89+**（所以 `minSdk = 24` 只是下限，实际建议 89+）。
2. ES module 在 `file://` 协议下会被 **CORS 拦掉**，`import 'three'` 直接失败。
3. 所以用 `WebViewAssetLoader` 把 assets 映射到 `https://appassets.androidplatform.net/assets/`
   —— 一个"看起来是 https"的同源地址，模块加载才成立。

```kotlin
val assetLoader = WebViewAssetLoader.Builder()
    .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
    .build()
// 页面地址
"https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/index.html"
```

### JS ↔ 原生桥接

`tools/sync-web.mjs` 会在同步时往 `window.__snake3d` 对象字面量里注入 4 个方法，供外壳调用：

| 方法 | 作用 |
| --- | --- |
| `pause()` | 切后台时自动暂停（非 `playing` 状态是空操作） |
| `resume()` | 恢复 |
| `isPlaying()` | 查询状态 |
| `handleBack()` | 返回键：游戏中 → 暂停防手滑退出；其他状态 → 交回系统退出 App |

注入带 `/* ==== ANDROID-BRIDGE-BEGIN ==== */` 显式标记，**重复运行不会叠加**，且注入后会自动自检。

## 工程结构

```
snake-android/
├── app/
│   ├── build.gradle.kts
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml          # 零权限 / 硬件加速 / fullSensor / 无 ActionBar
│       ├── assets/
│       │   ├── index.html               # 游戏本体（含桥接补丁，由脚本生成）
│       │   └── three.module.js          # Three.js r161，本地化
│       ├── java/com/ilses1/snake/
│       │   └── MainActivity.kt          # WebView 外壳
│       └── res/
│           ├── mipmap-{m,h,xh,xxh,xxxh}dpi/   # 方形图标 + 自适应前景（各 5 档）
│           ├── mipmap-anydpi-v26/ic_launcher.xml  # 自适应图标（API 26+）
│           └── values/{colors,strings,themes}.xml
├── gradle/wrapper/                      # Gradle 8.9 wrapper
├── tools/
│   ├── make-icons.py                    # 从主仓库源图标生成全套安卓图标
│   └── sync-web.mjs                     # 同步游戏页面 + 注入桥接
├── build.gradle.kts
├── settings.gradle.kts                  # 阿里云镜像优先，回落官方源
└── gradle.properties
```

## 构建

### 环境要求

- **JDK 17+**（本项目用 JDK 21 运行 Gradle，字节码目标 17）
- **Android SDK**：platform `android-35`、build-tools `34.0.0` / `35.0.0`、platform-tools
- **Gradle 8.9**（用仓库自带的 `./gradlew`，或本地已装的 gradle 8.9）

`settings.gradle.kts` 里已把 **阿里云镜像放在官方源之前**（实测响应 0.05~0.1s），国内构建不需要额外配代理。

### 命令

```bash
# 1) 同步游戏页面与桥接（需要主仓库工作副本在同级目录）
node tools/sync-web.mjs

# 2) 生成图标（需要主仓库的 tauri-app/icon.png）
python tools/make-icons.py

# 3) 编译 debug APK
./gradlew :app:assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk

# 4) 装到设备
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

调试时用桌面 Chrome 打开 `chrome://inspect` 可直接远程调试 WebView（debug 版已开启 `setWebContentsDebuggingEnabled`）。

### 本机环境（Windows，全部装在 D 盘）

| 组件 | 路径 |
| --- | --- |
| JDK 21 | `D:\dev\jdk21` |
| Android SDK | `D:\dev\AndroidSdk` |
| Gradle 8.9 | `D:\dev\gradle-8.9` |
| Gradle 缓存 | `D:\dev\gradle-home`（`GRADLE_USER_HOME`） |

环境变量：`JAVA_HOME` / `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `GRADLE_USER_HOME` 均已配置到用户级与机器级。
`local.properties` 里写死了 `sdk.dir`（已 gitignore，不会提交）。

## 踩过的坑

留档，避免重蹈：

1. **Java 不读 `https_proxy` 环境变量**（curl 会读）。本机曾经有过
   `~/.gradle/gradle.properties` 里 `systemProp.https.proxyHost=mirrors.aliyun.com` 的**假代理**配置，
   导致 Gradle 所有网络请求静默失败 —— 报的却是 `Plugin ... was not found`，**完全看不出是网络问题**。
   本机直连可达，不需要任何代理。

2. **`caches/build-cache-1` 目录损坏**会导致：
   ```
   Failed to store cache entry ... for Kotlin DSL accessors for project ':app': ... (拒绝访问。)
   compileSdkVersion is not specified. Please add it to build.gradle
   ```
   第二条是第一条的**连带后果**（accessors 没生成 → AGP DSL 失效），不是真的没写 `compileSdk`。
   修法：移走 `caches/build-cache-1` 让 Gradle 重建；临时绕过可加 `--no-build-cache`。

3. **git Bash 的 GNU tar 不认 zip**，解压 Android SDK 包要用 `C:\Windows\System32\tar.exe`（bsdtar）。

4. **`sdkmanager --licenses` 会假装成功但不落盘**，需要手工写 licenses 哈希文件。
   本项目构建时 AGP 会自动补装缺失的 build-tools 并接受 license（日志里可见）。

## 相关仓库

| 仓库 | 说明 |
| --- | --- |
| [snake-3d-tauri](https://github.com/ilses1/snake-3d-tauri) | 主仓库：网页版（单 HTML）+ Tauri 桌面版（Windows / macOS / Linux） |
| snake-android | 本仓库：安卓端（原生 Kotlin WebView 壳） |

## License

[MIT](https://github.com/ilses1/snake-3d-tauri/blob/main/LICENSE)
