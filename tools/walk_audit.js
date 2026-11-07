// 功能走查：从办公室出发，验证鱼能 A* 走到花园/小镇各区（路删了不能把走法删了）
const path = require("path");
const pw = require(path.join("/tmp/node_modules/playwright-core"));

;(async () => {
  const browser = await pw.chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
    args: ["--no-sandbox"]
  });
  const ctx = await browser.newContext({ viewport: { width: 1248, height: 768 } });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:4322/?debug=1", { waitUntil: "load" });
  await page.waitForFunction(() => !!(window.__office && window.__office.sceneRef && window.__office.sceneRef.mapdata), null, { timeout: 25000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(async () => {
    const out = {};
    const S = window.__office.sceneRef;
    // 直接用内部 astar：办公室工位(9,23) → 三个关键落点
    function astar(sx, sy, ex, ey) {
      // 复刻 office.js 的 astar（不能直接访问闭包，用 zone 走法验证代替）
      return null;
    }
    // 用真实状态机走：逛市集（zone market 50.8,18.2）→ 等鱼走完 → 看落点
    window.__officeCtl.emit("browsing_market", "走查·逛市集", "road-audit");
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      await new Promise(r => setTimeout(r, 800));
      const o = window.__office;
      if (o.fishState === "acting" || o.fishState === "idle") break;
    }
    out.market = { xy: window.__office.fishXY, state: window.__office.fishState, plan: window.__office.plan };
    // 再走一次：散步进花园（zone garden 31.5,12）
    window.__officeCtl.emit("strolling", "走查·散步", "road-audit");
    const t1 = Date.now();
    while (Date.now() - t1 < 40000) {
      await new Promise(r => setTimeout(r, 800));
      const o = window.__office;
      if (o.fishState === "acting" || o.fishState === "idle") break;
    }
    out.garden = { xy: window.__office.fishXY, state: window.__office.fishState, plan: window.__office.plan };
    out.zones = window.__officeCtl.zones();
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
