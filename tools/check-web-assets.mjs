#!/usr/bin/env node
/**
 * 打包前自检：确认 assets 里的游戏页面是完整、带桥接、语法正确的。
 *
 *   node tools/check-web-assets.mjs
 *   # 本机若报「无法启动子进程」，补上 flag（见下）
 *   node --experimental-vm-modules tools/check-web-assets.mjs
 *
 * 检查项：
 *   1) index.html / three.module.js 存在且非空
 *   2) importmap 指向 ./three.module.js（离线加载的前提）
 *   3) 桥接标记 ANDROID-BRIDGE-BEGIN/END 各出现且仅出现一次（防叠加注入）
 *   4) 桥接方法 pause / resume / isPlaying / handleBack 都在
 *   5) 内联 <script> 逐个做 ESM 语法解析（能拦住语法破坏）
 *
 * 语法解析有两条路径：
 *   - `vm.SourceTextModule`（需 `--experimental-vm-modules`）：进程内解析，不依赖子进程，首选。
 *   - 子进程 `node --check`：Windows 上重复 spawn 同一个 node.exe 可能 EBUSY，所以只作回落。
 *
 * 退出码非 0 表示失败。本地同步完 assets 与 CI 都应跑一次。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'app', 'src', 'main', 'assets');
const HTML = path.join(ASSETS, 'index.html');
const THREE = path.join(ASSETS, 'three.module.js');

const problems = [];
const ok = (msg) => console.log('  ok    ' + msg);
const bad = (msg) => { problems.push(msg); console.log('  FAIL  ' + msg); };

// 「没能检查」与「检查出来是错的」是两回事，别混在同一个报错里误导人。
// 校验函数返回的错误串带此前缀即表示环境问题（而非被检查的代码有问题）。
const ENV_PREFIX = '\u0000ENV\u0000';

/** 用 vm.SourceTextModule 解析一段 ESM 源码；返回 null 表示通过，否则返回错误描述。 */
function parseEsm(source, filename) {
  const M = vm.SourceTextModule;
  if (typeof M !== 'function') return null; // 本环境不可用，交给调用方回落
  try {
    // 只构造不链接、不求值，因此不会真的执行 import
    new M(source, { identifier: filename });
    return null;
  } catch (e) {
    const first = String(e.message).split('\n')[0];
    return `${e.constructor.name}: ${first}`;
  }
}

/** 回落到子进程 `node --check`；同样返回 null 表示通过。 */
function checkViaChild(source, filename) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snake-assets-'));
  const f = path.join(dir, 'inline.mjs');
  try {
    fs.writeFileSync(f, source);
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    if (r.status === 0) return null;
    if (r.error) {
      return ENV_PREFIX + `无法启动子进程（${r.error.code}）。` +
        '本机请改用：node --experimental-vm-modules tools/check-web-assets.mjs';
    }
    const detail = [r.stdout, r.stderr].filter(Boolean).join('\n').trim();
    return detail || `node --check 退出码 ${r.status}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  // 1) 文件存在且非空（阈值取实际体积的保守下限，防截断）
  for (const [f, min] of [[HTML, 40000], [THREE, 1000000]]) {
    const rel = path.relative(ROOT, f);
    if (!fs.existsSync(f)) { bad(`缺少 ${rel}`); continue; }
    const size = fs.statSync(f).size;
    if (size < min) bad(`${rel} 只有 ${size} 字节（预期 ≥ ${min}），疑似被截断`);
    else ok(`${rel}  ${size} 字节`);
  }
  if (problems.length) return;

  const html = fs.readFileSync(HTML, 'utf8');

  // 2) importmap 指向本地 three
  if (/["']\.\/three\.module\.js["']/.test(html)) ok('importmap 指向 ./three.module.js');
  else bad('importmap 没有指向 ./three.module.js，离线加载会失败');

  // 3) 桥接标记唯一
  for (const mark of ['ANDROID-BRIDGE-BEGIN', 'ANDROID-BRIDGE-END']) {
    const n = html.split(mark).length - 1;
    if (n === 1) ok(`桥接标记 ${mark} 出现 1 次`);
    else bad(`桥接标记 ${mark} 出现 ${n} 次（应为 1）`);
  }

  // 4) 桥接方法齐全
  for (const name of ['pause', 'resume', 'isPlaying', 'handleBack']) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(html)) ok(`桥接方法 ${name}()`);
    else bad(`找不到桥接方法 ${name}()`);
  }

  // 5) 内联脚本语法
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/importmap/.test(m[1]))
    .map((m) => m[2]);
  if (!scripts.length) { bad('页面里没有可检查的内联脚本'); return; }

  const useVm = typeof vm.SourceTextModule === 'function';
  console.log(`  语法解析方式：${useVm ? 'vm.SourceTextModule（进程内）' : 'node --check（子进程回落）'}`);

  scripts.forEach((body, i) => {
    const label = `内联脚本 #${i + 1}（${body.length} 字符）`;
    const err = useVm ? parseEsm(body, `inline_${i + 1}.mjs`) : checkViaChild(body, `inline_${i + 1}.mjs`);
    if (err && err.startsWith(ENV_PREFIX)) {
      // 环境问题：代码本身没被验证过，既不能报通过也不能报语法错误
      bad(`${label} 未能检查（环境限制，非代码问题）：${err.slice(ENV_PREFIX.length)}`);
    } else if (err) {
      bad(`${label} 语法错误：${err}`);
    } else {
      ok(`${label} 语法通过`);
    }
  });
}

console.log('检查 assets …');
main();

if (problems.length) {
  console.error(`\n自检失败，${problems.length} 项问题：`);
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log('\nassets 自检全部通过。');
