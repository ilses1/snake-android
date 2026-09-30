#!/usr/bin/env bash
# 真机安装 / 启动 / 抓日志。Windows(Git Bash)、Linux、macOS 通用。
#
#   ./tools/install-debug.sh             安装并启动
#   ./tools/install-debug.sh --log       安装、启动，并跟随 WebView 日志
#   ./tools/install-debug.sh --devices   只看设备与 WebView 环境
#   ./tools/install-debug.sh --uninstall 卸载
#
# 前置：手机开启「开发者选项 → USB 调试」，插线后在本机弹出的「允许 USB 调试？」点允许。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="$ROOT/app/build/outputs/apk/debug/app-debug.apk"
PKG="com.ilses1.snake.debug"
ACTIVITY="$PKG/com.ilses1.snake.MainActivity"

# ---- 定位 adb：PATH 优先，否则用 ANDROID_HOME ----
if command -v adb >/dev/null 2>&1; then
  ADB="$(command -v adb)"
else
  SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-D:/dev/AndroidSdk}}"
  for c in "$SDK/platform-tools/adb.exe" "$SDK/platform-tools/adb"; do
    [ -x "$c" ] && { ADB="$c"; break; }
  done
fi
: "${ADB:?找不到 adb。请确认 ANDROID_HOME 指向 Android SDK，或把 platform-tools 加进 PATH}"
echo "adb     : $ADB"

# ---- 选设备：唯一 device 状态就用它；多个则要求显式 -s ----
pick_device() {
  local raw ready
  raw="$("$ADB" devices)"
  ready="$(printf '%s\n' "$raw" | awk 'NR>1 && $2=="device" {print $1}')"
  local n; n="$(printf '%s' "$ready" | grep -c . || true)"

  if [ "$n" -eq 0 ]; then
    if printf '%s' "$raw" | grep -q "unauthorized"; then
      echo "!! 设备未授权：请在手机屏幕上点「允许 USB 调试」后重跑" >&2
    else
      echo "!! 没有可用设备。检查：数据线、USB 调试开关、驱动" >&2
    fi
    printf '%s\n' "$raw" | sed 's/^/   /' >&2
    return 1
  fi
  if [ "$n" -gt 1 ]; then
    echo "!! 检测到多台设备，请用环境变量指定：ANDROID_SERIAL=<序列号> $0" >&2
    printf '%s\n' "$ready" | sed 's/^/   /' >&2
    return 1
  fi
  DEV="$(printf '%s' "$ready" | head -1)"
}

show_env() {
  echo
  echo "===== 设备 ====="
  "$ADB" -s "$DEV" shell getprop ro.product.model 2>/dev/null | tr -d '\r' | sed 's/^/  型号  : /'
  "$ADB" -s "$DEV" shell getprop ro.build.version.release 2>/dev/null | tr -d '\r' | sed 's/^/  系统  : Android /'
  "$ADB" -s "$DEV" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r' | sed 's/^/  API   : /'
  echo "===== WebView（关键：需 ≥ 89 才支持 importmap）====="
  "$ADB" -s "$DEV" shell dumpsys webviewupdate 2>/dev/null \
    | grep -iE "Current WebView package|version" | head -4 | tr -d '\r' | sed 's/^/  /' || true
  echo "===== 已装应用 ====="
  if "$ADB" -s "$DEV" shell pm list packages 2>/dev/null | grep -q "$PKG"; then
    echo "  已安装：$PKG"
  else
    echo "  未安装：$PKG"
  fi
}

pick_device
case "${1:-}" in
  --devices)
    show_env
    exit 0
    ;;
esac

if [ ! -f "$APK" ]; then
  echo "!! 找不到 APK：$APK" >&2
  echo "   先构建：cd \"$ROOT\" && ./gradlew :app:assembleDebug" >&2
  exit 1
fi

if [ "${1:-}" = "--uninstall" ]; then
  "$ADB" -s "$DEV" uninstall "$PKG" && echo "已卸载 $PKG"
  exit 0
fi

echo "APK     : $APK ($(wc -c < "$APK") 字节)"
show_env

echo
echo "===== 安装 ====="
"$ADB" -s "$DEV" install -r "$APK"

echo
echo "===== 启动 ====="
"$ADB" -s "$DEV" shell am start -n "$ACTIVITY"

if [ "${1:-}" = "--log" ]; then
  echo
  echo "===== 日志（Ctrl+C 退出）====="
  echo "提示：白屏/黑屏问题看 [web] 行与 chromium 报错"
  "$ADB" -s "$DEV" logcat -v time SnakeWebView:V chromium:E chromium:W AndroidRuntime:E "*:S"
fi
