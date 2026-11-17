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

// ---------- 机位表：world = [格 x, 格 y]（y 需要 +1 行墙带），zoom 越大越近 ----------
const SHOTS = [
  { id: "1-office-desk",  world: [9, 23.5],   zoom: 2.2, note: "办公室工位/书架/白板" },
  { id: "2-office-south", world: [6, 28.5],   zoom: 2.2, note: "沙发/街机/茶水台（南墙裙）" },
  { id: "3-bedroom",      world: [5.5, 7],    zoom: 2.4, note: "卧室床/衣柜" },
  { id: "4-bath-kitchen", world: [13.5, 6],   zoom: 2.2, note: "卫浴+厨房交界（瓷砖/木地板接缝）" },
  { id: "5-garden-pond",  world: [34, 22],    zoom: 2.2, note: "农田/池塘/花园小径" },
  { id: "6-street",       world: [46, 17],    zoom: 2.2, note: "主街/集市/三户门脸" },
  { id: "7-nbcat-inside", world: [42, 23],    zoom: 2.6, note: "喵酱家室内（床/桌/墙）" },
  { id: "8-park",         world: [46, 8],     zoom: 2.2, note: "公园（树/长椅/小径）" }
];
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
    const wx = s.world[0] * TILE, wy = WALL_H + s.world[1] * TILE;
    // 停跟随 → 定 zoom → centerOn；然后**冻结场景 update**，
    // 否则 states.js 那个 1.8s 的延时 beginFollow 会把镜头抢回鱼身上（第一次拍就吃了这个亏）
    await cdp(ws, "Runtime.evaluate", {
      expression: `(() => {
        const sc = window.__office.sceneRef, c = sc.cameras.main;
        sc.scene.resume();
        ["minimap", "room-tabs", "debug-toggle"].forEach(id => {
          const el = document.getElementById(id); if (el) el.style.visibility = "hidden";
        });
        c.stopFollow(); c.setLerp(1, 1); c.setZoom(${s.zoom}); c.centerOn(${wx}, ${wy});
        sc.scene.pause();
        c.centerOn(${wx}, ${wy});
        return true;
      })()`, returnByValue: true
    });
    await sleep(900);
    const shot = await cdp(ws, "Page.captureScreenshot", {
      format: "png",
      clip: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.w), height: Math.round(rect.h), scale: 1 },
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
