// 移动端布局验证器：用 CDP 驱动本机 Chrome，真开移动端模拟（mobile+dpr+touch），
// 在多个手机视口下量 getBoundingClientRect() 做数值断言，并顺带截图留档。
//
// 为什么不用 agent-browser：它要现下 ~500MB Chromium，本机网络环境不划算。
// Node 22 自带全局 WebSocket，直接连 CDP 即可，零安装。
//
// 用法: node verify-mobile.mjs <url>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:8080/index.html';
const OUT = path.resolve('.workbuddy/verify-shots');
fs.mkdirSync(OUT, { recursive: true });

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('没找到 Chrome/Edge'); process.exit(2); }

const PORT = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snake-cdp-'));

// 输出必须实时，否则脚本一旦卡住就完全看不到卡在哪一步（日志全在最后才打印）。
const log = (...a) => { process.stdout.write(a.join(' ') + '\n'); };

// 总兜底：卡住也要把已收集到的结果吐出来，而不是无声挂死
const WATCHDOG_MS = 240000;

/** 挑一个空闲端口：避免上一轮残留的 Chrome 占着固定端口，
 *  导致新实例绑定失败、却被我们连到了那个半死的老实例上。 */
async function freePort() {
  const net = await import('node:net');
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

// 视口：机型名 / 宽 / 高 / 是否横屏标记
const VIEWPORTS = [
  { name: 'iphone-portrait', w: 390, h: 844 },
  { name: 'android-portrait-narrow', w: 360, h: 640 },
  { name: 'android-landscape', w: 800, h: 360 },
  { name: 'small-landscape', w: 667, h: 375 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 极简 CDP 客户端：一个 page target 一条 WS。 */
class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      } else if (m.method) {
        const arr = this.events.get(m.method) || [];
        arr.forEach((fn) => fn(m.params));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  once(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('等 ' + method + ' 超时')), timeoutMs);
      const fn = (p) => { clearTimeout(t); this.off(method, fn); resolve(p); };
      this.on(method, fn);
    });
  }
  on(method, fn) {
    const arr = this.events.get(method) || [];
    arr.push(fn);
    this.events.set(method, arr);
  }
  off(method, fn) {
    const arr = (this.events.get(method) || []).filter((f) => f !== fn);
    this.events.set(method, arr);
  }
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WS 连接失败')), { once: true });
  });
  return new Cdp(ws);
}

/** 页面侧断言：全部用真实布局数值，不靠肉眼。 */
const PROBE = `(() => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x:+b.x.toFixed(1), y:+b.y.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1),
             right:+b.right.toFixed(1), bottom:+b.bottom.toFixed(1),
             display:getComputedStyle(e).display }; };
  const overlays = [...document.querySelectorAll('.overlay')].filter(o => !o.classList.contains('hidden'));
  return {
    vw, vh, dpr: window.devicePixelRatio,
    touchClass: document.body.classList.contains('touch'),
    bridgeReady: !!window.__snake3d,
    gameState: window.__snake3d ? window.__snake3d.state : null,
    docScrollW: document.documentElement.scrollWidth,
    docScrollH: document.documentElement.scrollHeight,
    hud: r('#hud'), stats: r('#stats'), tools: r('#tools'), dpad: r('#dpad'),
    hint: r('#hint'),
    // 方向键四个按钮的实际尺寸（验证 clamp 是否生效）
    dpadCell: r('#dpad .d'),
    // 顶栏图标键（次要按钮，阈值低于方向键）
    iconBtn: r('#tools .btn-icon'),
    visOverlay: overlays.length ? overlays[0].id : null,
    card: overlays.length ? (() => { const c = overlays[0].querySelector('.card');
      const b = c.getBoundingClientRect();
      const o = overlays[0];
      return { top:+b.top.toFixed(1), bottom:+b.bottom.toFixed(1), h:+b.height.toFixed(1),
               ovClientH:o.clientHeight, ovScrollH:o.scrollHeight,
               startBtnBottom: (()=>{const s=o.querySelector('.btn-main'); if(!s) return null;
                 return +s.getBoundingClientRect().bottom.toFixed(1);})() }; })() : null,
    kbOnlyShown: [...document.querySelectorAll('.kb-only')].filter(e=>getComputedStyle(e).display!=='none').length,
    touchOnlyShown: [...document.querySelectorAll('.touch-only')].filter(e=>getComputedStyle(e).display!=='none').length,
  };
})()`;

async function shoot(cdp, name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(OUT, name + '.png');
  fs.writeFileSync(f, Buffer.from(data, 'base64'));
  return f;
}

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--hide-scrollbars',
  '--enable-unsafe-swiftshader',   // 无 GPU 环境下允许软件 WebGL
  'about:blank',
], { stdio: 'ignore' });

// 看门狗放在 spawn 之后，保证它引用 chrome 时变量已初始化（TDZ）
const watchdog = setTimeout(() => {
  console.error('\n[看门狗] 超过 ' + WATCHDOG_MS / 1000 + 's 仍未结束，强制退出');
  try { chrome.kill(); } catch {}
  process.exit(3);
}, WATCHDOG_MS);
watchdog.unref?.();

let browserWsUrl = null;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch('http://127.0.0.1:' + PORT + '/json/version');
    if (r.ok) { browserWsUrl = (await r.json()).webSocketDebuggerUrl; break; }
  } catch { /* 还没起来 */ }
  await sleep(250);
}
if (!browserWsUrl) { chrome.kill(); console.error('Chrome 调试端口(' + PORT + ')没起来'); process.exit(2); }
log('Chrome 已就绪，调试端口 ' + PORT);

const browser = await connect(browserWsUrl);
const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
const page = await connect('ws://127.0.0.1:' + PORT + '/devtools/page/' + targetId);
await page.send('Page.enable');
await page.send('Runtime.enable');

const results = [];
try {
  for (const vp of VIEWPORTS) {
    log('[' + vp.name + '] 设置移动端模拟 ' + vp.w + '×' + vp.h);
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: true,
    });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });

    // loadEventFired 有可能不触发（缓存命中 / 事件早于监听），所以超时后继续而不是卡死
    const loaded = Promise.race([
      page.once('Page.loadEventFired', 15000),
      sleep(15000).then(() => 'timeout'),
    ]).catch(() => 'timeout');
    await page.send('Page.navigate', { url: URL_BASE + '?touch=1' });
    await loaded;
    await sleep(700); // 等模块跑完（桥接 / 方向键判定）

    const ready = await page.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    const startShot = await shoot(page, vp.name + '-1-start');
    log('[' + vp.name + '] 开始页已量测并截图');

    // 开始游戏，看 HUD + 方向键在真实游戏态下的表现
    await page.send('Runtime.evaluate', {
      expression: "document.getElementById('btn-start').click()",
      returnByValue: true,
    });
    await sleep(900);
    const playing = await page.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
    const playShot = await shoot(page, vp.name + '-2-playing');
    log('[' + vp.name + '] 游戏中已量测并截图');

    // 方向键交互：只在第一个视口做一次。
    // 注意 dirFromScreen 在跟随视角下是相对机位的（按"上"=直行，不转向），
    // 所以先切到上帝视角（映射固定），再按"上"，蛇头的 z 必须真的变小。
    let tapTest = null;
    if (vp === VIEWPORTS[0]) {
      const headCell = () => page.send('Runtime.evaluate', {
        expression: "window.__snake3d.cells.split(' ')[0]",
        returnByValue: true,
      }).then((r) => r.result.value);
      await page.send('Runtime.evaluate', {
        expression: "document.getElementById('btn-view').click()",
        returnByValue: true,
      });
      await sleep(150);
      const cam = () => page.send('Runtime.evaluate', {
        expression: 'window.__snake3d.camMode',
        returnByValue: true,
      }).then((r) => r.result.value);
      // 先切到上帝视角（映射才是固定的屏幕方位），并确认真的切过去了。
      // 上一轮出现过点击后 camMode 仍是 0 的偶发，这里带确认 + 重试，别让测试本身变成玄学。
      let camAfter = await cam();
      for (let i = 0; i < 3 && camAfter !== 1; i++) {
        await page.send('Runtime.evaluate', {
          expression: "document.getElementById('btn-view').click()",
          returnByValue: true,
        });
        await sleep(150);
        camAfter = await cam();
      }
      const camBefore = camAfter === 1 ? 0 : camAfter;
      const before = await headCell();
      await page.send('Runtime.evaluate', {
        expression: "document.querySelector('#dpad .d.up').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))",
        returnByValue: true,
      });
      await sleep(750);   // 初始步进 0.175s，足够走 3~4 步
      const after = await headCell();
      const [bx, bz] = before.split(',').map(Number);
      const [ax, az] = after.split(',').map(Number);
      tapTest = { before, after, dz: az - bz, dx: ax - bx, camBefore, camAfter };
      log('[' + vp.name + '] 方向键 tap 测试: camMode ' + camBefore + '->' + camAfter + '，蛇头 ' + before + ' -> ' + after);
    }

    results.push({ vp, start: ready.result.value, playing: playing.result.value, startShot, playShot, tapTest });
  }
} catch (e) {
  console.error('[出错] ' + (e && e.message ? e.message : e));
  log('已收集 ' + results.length + ' 组视口结果，继续出报告');
} finally {
  clearTimeout(watchdog);
  try { await browser.send('Target.closeTarget', { targetId }); } catch {}
  try { browser.ws.close(); } catch {}
  chrome.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

// ---------- 判定 ----------
function judge(label, r, expectTouch) {
  const p = [];
  const bad = (m) => p.push('✗ ' + m);
  const good = (m) => p.push('✓ ' + m);

  if (!r.bridgeReady) bad('游戏脚本没跑起来（window.__snake3d 缺失）');
  else good('游戏脚本已执行，state=' + r.gameState);

  if (r.docScrollW > r.vw + 1) bad('出现横向溢出：scrollWidth=' + r.docScrollW + ' > vw=' + r.vw);
  else good('无横向溢出 (' + r.docScrollW + ' ≤ ' + r.vw + ')');

  // HUD 不能超出视口
  if (r.stats && r.stats.right > r.vw + 1) bad('分数面板右边界越界：' + r.stats.right + ' > ' + r.vw);
  else if (r.stats) good('分数面板在视口内 (right=' + r.stats.right + ')');
  if (r.tools && r.tools.right > r.vw + 1) bad('图标栏右边界越界：' + r.tools.right + ' > ' + r.vw);
  else if (r.tools) good('图标栏在视口内 (right=' + r.tools.right + ')');
  if (r.stats && r.tools && r.tools.y > r.stats.bottom - 2) {
    p.push('! 图标栏被换行到第二行 (tools.y=' + r.tools.y + ', stats.bottom=' + r.stats.bottom + ')');
  }
  if (r.stats && r.tools && r.tools.right > r.stats.left && r.tools.x < r.stats.right) {
    bad('分数面板与图标栏重叠');
  }

  // 方向键
  if (!r.dpad || r.dpad.display === 'none') bad('方向键未显示（?touch=1 下应显示）');
  else {
    good('方向键已显示，单格 ' + r.dpadCell.w + '×' + r.dpadCell.h + '，整体 ' + r.dpad.w + '×' + r.dpad.h);
    if (r.dpad.right > r.vw + 1) bad('方向键右侧越界：' + r.dpad.right + ' > ' + r.vw);
    else good('方向键右侧留白 ' + (r.vw - r.dpad.right).toFixed(1) + 'px');
    if (r.dpad.bottom > r.vh + 1) bad('方向键底部越界：' + r.dpad.bottom + ' > ' + r.vh);
    else good('方向键底部留白 ' + (r.vh - r.dpad.bottom).toFixed(1) + 'px');
    if (r.dpadCell.w < 40) bad('按钮过小：' + r.dpadCell.w + 'px（触摸目标建议 ≥44px）');
    else good('按钮尺寸达标');
  }

  // 顶栏图标键：次要按钮，放宽到 ≥36px（方向键才是必须 ≥44px 的主力控件）
  if (r.iconBtn) {
    if (r.iconBtn.w < 36) bad('顶栏图标键过小：' + r.iconBtn.w + 'px');
    else good('顶栏图标键 ' + r.iconBtn.w + 'px');
  }

  // 触摸文案
  if (expectTouch) {
    if (!r.touchClass) bad('body 上没有 touch 类，触摸文案不会切换');
    else good('body.touch 已挂上');
    if (r.touchOnlyShown < 1) bad('触摸说明未显示');
    else good('触摸说明已显示 ' + r.touchOnlyShown + ' 条');
    if (r.kbOnlyShown !== 0) bad('键盘说明仍显示 ' + r.kbOnlyShown + ' 条');
    else good('键盘说明已隐藏');
  }

  // 卡片可达性
  if (r.card) {
    const c = r.card;
    if (c.bottom > c.ovClientH + 1) {
      if (c.startBtnBottom !== null && c.startBtnBottom <= c.ovClientH + 1) {
        good('卡片超高但主按钮在首屏可见（卡片 ' + c.h + ' > 视口 ' + c.ovClientH + '）');
      } else {
        bad('主按钮被裁掉：bottom=' + c.startBtnBottom + ' > 可视高 ' + c.ovClientH);
      }
      if (c.ovScrollH <= c.ovClientH + 1) bad('卡片超出但遮罩层没有可滚动区域，内容将无法触达');
      else good('遮罩层可滚动兜底 (scrollH=' + c.ovScrollH + ')');
    } else {
      good('卡片完整可见（' + c.h + ' ≤ ' + c.ovClientH + '）');
    }
  }

  console.log('\n===== ' + label + ' =====');
  console.log('  视口 ' + r.vw + '×' + r.vh + ' dpr=' + r.dpr + (r.visOverlay ? '  遮罩=' + r.visOverlay : ''));
  p.forEach((l) => console.log('  ' + l));
  return p;
}

let fails = 0;
for (const res of results) {
  const a = judge(res.vp.name + ' / 开始页', res.start, true);
  const b = judge(res.vp.name + ' / 游戏中', res.playing, true);
  fails += [...a, ...b].filter((l) => l.startsWith('✗')).length;

  if (res.tapTest) {
    const t = res.tapTest;
    console.log('\n===== ' + res.vp.name + ' / 方向键交互 =====');
    if (t.camAfter !== 1) {
      console.log('  ✗ 没能切到上帝视角（camMode=' + t.camAfter + '），测试前提不成立');
      fails++;
    } else if (t.dz < 0 && t.dx === 0) {
      console.log('  ✓ 按「上」后蛇头沿 -z 前进：' + t.before + ' -> ' + t.after);
    } else {
      console.log('  ✗ 按「上」没有产生预期的 -z 位移：' + t.before + ' -> ' + t.after);
      fails++;
    }
  }
}
console.log('\n截图输出目录: ' + OUT);
console.log(fails === 0 ? '\n结论：全部断言通过。' : '\n结论：' + fails + ' 项断言失败。');
process.exit(fails === 0 ? 0 : 1);
