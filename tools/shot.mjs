#!/usr/bin/env node
/**
 * 分块截图（tools/shot.mjs）：驱动无头 Edge/Chrome，把小镇"一块一块"拍下来。
 *
 *   node tools/shot.mjs                 # 默认 7 个机位 → logs/shots/*.png
 *   node tools/shot.mjs --url=http://127.0.0.1:4322/ --only=office,bedroom
 *   node tools/shot.mjs --scale=2       # 设备像素比（更清晰，文件更大）
 *
 * 为什么是零依赖：Node 22+ 自带 WebSocket，Windows 自带 Edge —— 直接走 CDP（Chrome DevTools
 * Protocol），不需要 playwright/puppeteer，也不需要下载 chromium。
 *
 * 每个"机位"三件事：① 停跟随 + 设 zoom + centerOn 到目标世界坐标；② 等 tween 稳定；
 * ③ 只截 canvas 那块（不是整页），所以能看清精灵细节。
 *
 * 找不到浏览器时用环境变量指定：CHROME_BIN="C:\\...\\msedge.exe"
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TILE = 48, WALL_H = 48;
const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("=");
  return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const URL_ = String(arg.url || "http://127.0.0.1:4322/");
const SCALE = Number(arg.scale || 1);
const OUT = path.resolve(ROOT, arg.out || path.join("logs", "shots"));

// ---------- 机位：整图切成 4 列 × 2 行 = 8 块，每块 1/8 ----------
// 地图 56×30 格 → 每块 14 格宽 × 15 格高（14*48=672 / 15*48=720 世界像素）。
// 相机 zoom 取 768/720 ≈ 1.0667，让这块正好填满画布高度；宽度 672*1.0667≈717 < 1248，
// 所以左右各留一点余量（相邻块会有一点点重叠，看图时不至于"缺一条"）。
const COLS_MAP = 56, ROWS_MAP = 30;
const TILE_W = COLS_MAP / 4, TILE_H = ROWS_MAP / 2;   // 14 / 15
const SHOTS = [];
for (let row = 0; row < 2; row++) {
  for (let col = 0; col < 4; col++) {
    SHOTS.push({
      id: "c" + col + "r" + row,
      col, row,
      x0: col * TILE_W, y0: row * TILE_H, w: TILE_W, h: TILE_H,
      note: "第 " + (row + 1) + " 行 第 " + (col + 1) + " 列（格 " + (col * TILE_W) + "~" + (col * TILE_W + TILE_W - 1) + " × " + (row * TILE_H) + "~" + (row * TILE_H + TILE_H - 1) + "）"
    });
  }
}
const only = arg.only ? String(arg.only).split(",") : null;

function findBrowser() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const cands = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"
  ];
  return cands.find(p => { try { return fs.existsSync(p); } catch { return false; } }) || null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function cdp(ws, method, params = {}, sessionId) {
  const id = cdp._id = (cdp._id || 0) + 1;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("CDP 超时: " + method)), 30000);
    const onMsg = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id !== id) return;
      clearTimeout(t); ws.removeEventListener("message", onMsg);
      m.error ? rej(new Error(method + ": " + m.error.message)) : res(m.result);
    };
// --room=<office|bedroom|bath|kitchen|nbCat|nbChief|nbDoc>：只拍这一间房（房间矩形与家具层同源）
if (arg.room) {
  const furnSrc = fs.readFileSync(path.join(ROOT, "web", "src", "furniture.js"), "utf8");
  const mm = new RegExp("\\b" + String(arg.room) + ":\\s*\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]").exec(furnSrc);
  if (!mm) { console.error("找不到房间矩形: " + arg.room); process.exit(1); }
  SHOTS.length = 0;
  SHOTS.push({ id: "room-" + arg.room, col: 0, row: 0, x0: +mm[1], y0: +mm[2], w: +mm[3], h: +mm[4], note: "房间 " + arg.room + "（" + mm[3] + "×" + mm[4] + " 格）" });
}
    ws.addEventListener("message", onMsg);
  });
}

async function main() {
  const bin = findBrowser();
  if (!bin) { console.error("找不到 Edge/Chrome，请用 CHROME_BIN 指定路径"); process.exit(1); }
  const port = 9222 + Math.floor(Math.random() * 200);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "town-shot-"));
  console.log("浏览器: " + bin);
  const child = spawn(bin, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--mute-audio", "--window-size=1500,1000",
    "--remote-debugging-port=" + port, "--user-data-dir=" + profile, URL_
  ], { stdio: "ignore", detached: false });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/json/list");
      const list = await r.json();
      const page = list.find(t => t.type === "page" && /^https?:/.test(t.url));
      if (page && page.webSocketDebuggerUrl) { targets = page; break; }
    } catch {}
  }
  if (!targets) { console.error("连不上调试端口（浏览器没起来？）"); try { child.kill(); } catch {} process.exit(1); }

  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });

  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");
  await cdp(ws, "Emulation.setDeviceMetricsOverride", {
    width: 1500, height: 1000, deviceScaleFactor: SCALE, mobile: false
  });

  // 等场景就绪（跟 walk_audit 用同一个判据）
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    const r = await cdp(ws, "Runtime.evaluate", {
      expression: "!!(window.__office && window.__office.sceneRef && window.__office.sceneRef.mapdata)",
      returnByValue: true
    });
    if (r.result && r.result.value) { ready = true; break; }
  }
  if (!ready) { console.error("场景没就绪（dev 服务器没起？）"); try { child.kill(); } catch {} process.exit(1); }
  await sleep(1500);   // 让预载的 tween / 首帧稳定

  // canvas 在页面里的位置（只截游戏画面，不带侧栏）
  const rectRes = await cdp(ws, "Runtime.evaluate", {
    // 注意：页面上有两个 canvas —— #mm-canvas（小地图，静态写死）与 Phaser 主画布（运行期插入）。
    // 按面积取最大的那个，别用 querySelector("#office-parent canvas")（会拿到小地图，截出来 166×88）。
    expression: `(() => { const cs=[...document.querySelectorAll("canvas")].sort((a,b)=>(b.width*b.height)-(a.width*a.height)); const c=cs[0]; if (!c) return null; const r=c.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,tag:(c.id||"")+":"+c.width+"x"+c.height}; })()`,
    returnByValue: true
  });
  const rect = rectRes.result && rectRes.result.value;
  if (!rect) { console.error("找不到 canvas"); try { child.kill(); } catch {} process.exit(1); }

  fs.mkdirSync(OUT, { recursive: true });
  const saved = [];
  for (const s of SHOTS) {
    if (only && !only.includes(s.id)) continue;
    // 这块棋盘的几何：世界像素矩形 → zoom 让高度正好填满画布 → 裁剪居中那条带
    // 每块四周再留 M 像素余量：地图最外圈的墙（北墙带/west 墙裙/y=29 墙裙）正好压在
    // 块的边界上，不留余量就会被切掉一半（用户反馈"边缘的墙看不到"）。
    const M = Number(arg.margin || 1.5) * TILE;               // 默认 1.5 格 = 72px
    const zx = s.w * TILE + 2 * M, zy = s.h * TILE + 2 * M;
    const zoom = 768 / zy;
    const cx = s.x0 * TILE + (s.w * TILE) / 2;             // 用**原始格范围**的中心
    const cy = WALL_H + s.y0 * TILE + (s.h * TILE) / 2;    // 之前误用了 zy/2（含余量）→ 整幅被推下/推右 72px
    const drawnW = zx * zoom;                                // 画布里实际占用宽度
    const clipCanvasX = (1248 - drawnW) / 2;
    const cssK = rect.w / 1248;                              // 世界(画布内部)→CSS 的缩放
    // 停跟随 → 定 zoom → centerOn；然后**冻结场景 update**，
    // 否则 states.js 那个 1.8s 的延时 beginFollow 会把镜头抢回鱼身上（第一次拍就吃了这个亏）
    await cdp(ws, "Runtime.evaluate", {
      expression: `(() => {
        const sc = window.__office.sceneRef, c = sc.cameras.main;
        sc.scene.resume();
        ["minimap", "room-tabs", "debug-toggle"].forEach(id => {
          const el = document.getElementById(id); if (el) el.style.visibility = "hidden";
        });
        c.stopFollow(); c.setLerp(1, 1);
        // 关键：先把相机边界放到世界外面。默认 setBounds(0,0,W,H) 会把边缘机位的 scrollX 钳住，
        // 于是"这块居中"的假设不成立（c0r0 就偏了约 265 画布像素，根本没到地图左边缘）。
        c.setBounds(-10000, -10000, 20000, 20000);
        c.setZoom(${zoom}); c.centerOn(${cx}, ${cy});
        sc.scene.pause();
        c.centerOn(${cx}, ${cy});
        return true;
      })()`, returnByValue: true
    });
    await sleep(900);
    const shot = await cdp(ws, "Page.captureScreenshot", {
      format: "png",
      clip: {
        x: Math.round(rect.x + clipCanvasX * cssK),
        y: Math.round(rect.y),
        width: Math.round(drawnW * cssK),
        height: Math.round(768 * cssK),
        scale: Number(arg.scale || 2)     // 默认 2 倍超采样：每块约 1400×1560，细节够看
      },
      captureBeyondViewport: false
    });
    const file = path.join(OUT, s.id + ".png");
    fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
    saved.push(file);
    console.log("  ✓ " + s.id + "  " + s.note);
  }

  console.log("\n共 " + saved.length + " 张 → " + OUT);
  try { ws.close(); } catch {}
  try { child.kill(); } catch {}
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}

main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
