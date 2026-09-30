#!/usr/bin/env node
/**
 * 把主仓库的游戏页面同步进 Android assets，并打上 Android 壳桥接补丁。
 *
 *   node tools/sync-web.mjs [源目录]
 *
 * 源目录默认取同级 snake-3d-tauri 工作副本，需包含：
 *   ui/index.html        （importmap 已指向 ./three.module.js 的离线版）
 *   ui/three.module.js   （three r161）
 *
 * 同步时会做两件事：
 *   1) 原样拷贝 three.module.js
 *   2) 给 index.html 注入 window.__snake3d 的桥接方法（pause / resume / handleBack），
 *      供 MainActivity 调用。补丁带显式标记，重复运行不会叠加。
 *
 * 补丁校验失败会直接报错退出，不会写出残缺文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ASSETS = path.join(ROOT, 'app', 'src', 'main', 'assets');

const DEFAULT_SRC = path.resolve(ROOT, '..', '2026-09-28-17-24-07', 'tauri-app', 'ui');
const srcDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SRC;

const BEGIN = '/* ==== ANDROID-BRIDGE-BEGIN ==== */';
const END = '/* ==== ANDROID-BRIDGE-END ==== */';

// 注入进 window.__snake3d 对象字面量的方法。
// 依赖游戏模块作用域里的 state / pauseGame / resumeGame，所以必须写在对象字面量内部。
const BRIDGE = [
  BEGIN,
  '  // ---- Android 壳桥接（由 tools/sync-web.mjs 注入，勿手改）----',
  '  pause() { if (state === \'playing\') pauseGame(); return state; },',
  '  resume() { if (state === \'paused\') resumeGame(); return state; },',
  '  isPlaying() { return state === \'playing\'; },',
  '  // 返回键：游戏中先暂停防手滑退出；其余状态交回系统',
  '  handleBack() { if (state === \'playing\') { pauseGame(); return true; } return false; },',
  END,
].join('\n');

function main() {
  const srcHtml = path.join(srcDir, 'index.html');
  const srcThree = path.join(srcDir, 'three.module.js');
  for (const f of [srcHtml, srcThree]) {
    if (!fs.existsSync(f)) throw new Error(`缺少源文件: ${f}`);
  }

  fs.mkdirSync(ASSETS, { recursive: true });

  // 1) three.js 原样拷贝
  fs.copyFileSync(srcThree, path.join(ASSETS, 'three.module.js'));
  console.log('copy   three.module.js  (%s KB)', Math.round(fs.statSync(srcThree).size / 1024));

  // 2) index.html 注入桥接
  let html = fs.readFileSync(srcHtml, 'utf8');
  // 源文件可能是 CRLF（Windows），注入内容必须跟它保持一致，否则 diff 会很难看
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  const BRIDGE_EOL = BRIDGE.replace(/\n/g, eol);

  // 校验源文件的关键结构，防止上游改动后补丁静默失效
  if (!/importmap/.test(html)) throw new Error('源 index.html 里没有 importmap，上游结构可能已变化');
  if (!/window\.__snake3d\s*=\s*\{/.test(html)) throw new Error('找不到 window.__snake3d = { 入口');
  if (/ANDROID-BRIDGE-BEGIN/.test(html)) {
    // 上游本身带了补丁（例如从本仓库回拷），先剥掉旧的再注入，保证幂等
    html = html.replace(new RegExp(`[ \\t]*${BEGIN}[\\s\\S]*?${END}(?:${eol})?`), '');
  }

  const anchor = /window\.__snake3d\s*=\s*\{(?:\r\n|\n)/;
  if (!anchor.test(html)) throw new Error('window.__snake3d = { 后没有紧跟换行，无法定位注入点');
  html = html.replace(anchor, (m) => m + BRIDGE_EOL + eol);

  // 3) 安卓端不需要 importmap 之外的东西，但保留它以贴近上游；只做一致性断言
  if (!/\.\/three\.module\.js/.test(html)) {
    console.warn('  ! 注意：index.html 的 importmap 没有指向 ./three.module.js，离线加载可能失败');
  }

  fs.writeFileSync(path.join(ASSETS, 'index.html'), html);
  console.log('patch  index.html        (%s KB, 桥接 %d 行)', Math.round(html.length / 1024), BRIDGE.split('\n').length);

  // 4) 自检：桥接方法是否真的进了产物
  const out = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8');
  for (const name of ['pause', 'resume', 'isPlaying', 'handleBack']) {
    if (!new RegExp(`\\b${name}\\s*\\(`).test(out)) throw new Error(`自检失败：产物里找不到 ${name}()`);
  }
  console.log('check  桥接方法 pause/resume/isPlaying/handleBack 均已就位');
}

try {
  main();
} catch (e) {
  console.error('同步失败：' + e.message);
  process.exit(1);
}
