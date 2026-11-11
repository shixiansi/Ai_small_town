// 小镇多屏截图走查（headless chromium）
// 用法: node office/tools/shot_rooms.js [outDir] [tag]
// 依赖 playwright-core（默认从 PLAYWRIGHT_DIR 或 /tmp/node_modules 解析）+ chromium_headless_shell
const path = require("path");
const fs = require("fs");
const os = require("os");
const pw = require(path.join(process.env.PLAYWRIGHT_DIR || "/tmp/node_modules/playwright-core"));

const BASE = process.env.SHOT_BASE || "http://127.0.0.1:4322";
const OUT = process.argv[2] || process.env.OFFICE_SHOT_DIR || path.join(os.tmpdir(), "office-shots");
const TAG = process.argv[3] || "";
fs.mkdirSync(OUT, { recursive: true });

;(async () => {
  const browser = await pw.chromium.launch({
    executablePath: "/root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell",
    args: ["--no-sandbox"]
  });
  const ctx = await browser.newContext({ viewport: { width: 1248, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(BASE.replace(/\/$/, "") + "/office/?debug=1", { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => !!(window.__office && window.__office.sceneRef && window.__office.sceneRef.mapdata), null, { timeout: 110000 });
  await page.waitForTimeout(2600);

  async function shoot(name, fn) {
    if (fn) await page.evaluate(fn);
    await page.waitForTimeout(950);
    await page.screenshot({ path: path.join(OUT, TAG + name + ".png") });
    console.log("shot", name);
  }

  await shoot("1-office");
  await shoot("2-garden", () => { window.__officeCtl.gotoRoom("garden"); });
  await shoot("3-town", () => { window.__officeCtl.gotoRoom("town"); });
  // 特写：x25 门洞两侧（办公室右缘 + 花园左缘）
  await shoot("4-gap-closeup", () => {
    const c = window.__office.sceneRef.cameras.main;
    c.setZoom(1.9); c.centerOn(25.6 * 48, 48 + 18 * 48);
  });
  // 特写：街道三户门洞带（cols 40-55, rows 13-21）
  await shoot("5-street-closeup", () => {
    const c = window.__office.sceneRef.cameras.main;
    c.setZoom(1.9); c.centerOn(47.5 * 48, 48 + 17.5 * 48);
  });
  await shoot("6-back-office", () => { window.__officeCtl.gotoRoom("office"); });

  if (errors.length) { console.log("PAGE_ERRORS:\n" + errors.join("\n")); }
  await browser.close();
})().catch(e => { console.error("FATAL", e); process.exit(1); });
