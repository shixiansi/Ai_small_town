#!/usr/bin/env node
/* debug 全事件走查：逐个 emit STATE_MAP 的状态，等鱼走完 + 气泡稳定后截图。
 * 输出 logs/walk/<state>.png + walk-report.json（状态/落点/气泡文本） */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("=");
  return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const URL_ = String(arg.url || "http://127.0.0.1:4322/?debug=1&ws=ws://127.0.0.1:9/")   // ws 指向死端口：断开 hub，防真实状态打断走查
const ONLY = arg.only ? String(arg.only).split(",") : null;
const BIN = process.env.CHROME_BIN || "/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell";
const OUT = path.join(ROOT, "logs", "walk");
fs.mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
function cdp(ws, method, params) {
  return new Promise((res, rej) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = e => {
      const d = JSON.parse(e.data);
      if (d.id === id) { ws.removeEventListener("message", onMsg); d.error ? rej(new Error(d.error.message)) : res(d.result); }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}

;(async () => {
  const port = 9222 + Math.floor(Math.random() * 200);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "town-walk-"));
  const child = spawn(BIN, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-sandbox",
    "--mute-audio", "--window-size=1500,1000", "--remote-debugging-port=" + port,
    "--user-data-dir=" + profile, URL_
  ], { stdio: "ignore" });
  let targets = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const r = await fetch("http://127.0.0.1:" + port + "/json/list");
      const list = await r.json();
      const page = list.find(t => t.type === "page" && /^https?:/.test(t.url));
      if (page) { targets = page; break; }
    } catch {}
  }
  if (!targets) { console.error("浏览器没起来"); process.exit(1); }
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  await cdp(ws, "Page.enable");
  await cdp(ws, "Runtime.enable");
  await cdp(ws, "Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 等场景就绪
  for (let i = 0; i < 90; i++) {
    await sleep(500);
    const r = await cdp(ws, "Runtime.evaluate", { expression: "!!(window.__office && window.__office.sceneRef && window.__office.sceneRef.mapdata)", returnByValue: true });
    if (r.result && r.result.value) break;
  }
  await sleep(2000);

  // 取状态列表 + 本地事件列表
  const states = await cdp(ws, "Runtime.evaluate", { expression: "window.__officeCtl.states().map(s=>s.id)", returnByValue: true });
  const locals = await cdp(ws, "Runtime.evaluate", { expression: "window.__officeCtl.localEvents().map(e=>e.key)", returnByValue: true });
  const list = states.result.value;
  const localKeys = locals.result.value;
  const runList = ONLY ? list.filter(s => ONLY.includes(s)) : list;
  const runLocals = ONLY ? localKeys.filter(s => ONLY.includes(s)) : localKeys;
  console.log(`走查 ${runList.length}/${list.length} 个真实状态 + ${runLocals.length}/${localKeys.length} 个本地事件`);

  const report = [];
  /* 判稳：fishState 是 IIFE 闭包变量，CDP evaluate 拿不到（恒 '?'）。
   * 改用"位置连续两次采样相同"判定走位结束。 */
  async function readPos() {
    const r = await cdp(ws, "Runtime.evaluate", {
      expression: `(()=>{const S=window.__office.sceneRef;const f=S&&S.props&&S.props.find(p=>p.isFish);
        return f?{x:Math.round((f.spr.x-24)/48),y:Math.round((f.spr.y-48-24)/48),px:Math.round(f.spr.x),py:Math.round(f.spr.y)}:null;})()`,
      returnByValue: true
    });
    return r.result.value;
  }
  async function walkOne(st, kind, triggerExpr) {
    let final = null;
    if (kind === "local") {
      // instant=true：就地播放（调试台模式），落位到锚点看动作帧——走查看"位置对不对"（路通由 state 走查覆盖）
      await cdp(ws, "Runtime.evaluate", { expression: `window.__officeCtl.localAct(${JSON.stringify(st)}, true)` });
      await sleep(650);   // 在 9s 闲逛恢复前截图
      final = await readPos();
      const shot = await cdp(ws, "Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(OUT, "L_" + st + ".png"), Buffer.from(shot.data, "base64"));
      report.push({ state: st, kind, ...final });
      console.log(`  ✓ L:${st}  落点(${final.x},${final.y})`);
      return;
    }
    await cdp(ws, "Runtime.evaluate", { expression: triggerExpr });
    let stable = 0, lastPx = null, lastPy = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      final = await readPos();
      if (!final) continue;
      if (final.px === lastPx && final.py === lastPy) { stable++; if (stable >= 3) break; }
      else stable = 0;
      lastPx = final.px; lastPy = final.py;
    }
    const shot = await cdp(ws, "Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, st + ".png"), Buffer.from(shot.data, "base64"));
    report.push({ state: st, kind, ...final });
    console.log(`  ✓ ${st}  落点(${final.x},${final.y})`);
  }
  // 结束时解冻（最后一轮后统一恢复）
  await cdp(ws, "Runtime.evaluate", { expression: `window.__officeCtl.freezeIdle && window.__officeCtl.freezeIdle(false)` });
  for (const st of runList) {
    await walkOne(st, "state", `window.__officeCtl.emit(${JSON.stringify(st)}, "", "", null)`);
    // 等鱼走完：轮询 fishState 直到 idle/acting 且稳定 1.2s（最多 25s）
    let final = null;
    for (let i = 0; i < 50; i++) {
      await sleep(500);
      const r = await cdp(ws, "Runtime.evaluate", {
        expression: `(()=>{const S=window.__office.sceneRef;const f=S&&S.props&&S.props.find(p=>p.isFish);
          return {fs:(typeof fishState!=="undefined")?fishState:"?", x:f?Math.round((f.spr.x-24)/48):null, y:f?Math.round((f.spr.y-48-24)/48):null,
          bubble:(document.querySelector(".bubble, #bubble")||{}).textContent||null};})()`,
        returnByValue: true
      });
      final = r.result.value;
      if (final && (final.fs === "idle" || final.fs === "acting")) {
        // 再等 1.2s 确认没有立刻又开始走
        const prev = final;
        await sleep(1200);
        const r2 = await cdp(ws, "Runtime.evaluate", { expression: `(typeof fishState!=="undefined")?fishState:"?"`, returnByValue: true });
        if (r2.result.value === prev.fs) break;
      }
    }
    // 截 canvas
    const shot = await cdp(ws, "Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(OUT, st + ".png"), Buffer.from(shot.data, "base64"));
    report.push({ state: st, ...final });
    console.log(`  ✓ ${st}  落点(${final.x},${final.y}) fishState=${final.fs}`);
  }
  for (const key of runLocals) {
    await walkOne(key, "local", `window.__officeCtl.localAct(${JSON.stringify(key)})`);
  }
  fs.writeFileSync(path.join(OUT, "walk-report.json"), JSON.stringify(report, null, 1));
  console.log("报告 → " + path.join(OUT, "walk-report.json"));
  child.kill();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
