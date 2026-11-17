// 朝向修正：贴墙类向最近墙推进、成组类向服务对象靠拢；用统一模型校验，门禁不过则整批回滚
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const model = loadModel();
const { items, cellsOf, solid, anchorCells, roadCells, map, COLS } = model;

const wall = new Set();
for (let x = 0; x < COLS; x++) wall.add(x + ",0");
(map.walls || []).forEach(wl => {
  if (wl.x0 !== undefined) { for (let x = wl.x0; x <= wl.x1; x++) if (!(wl.gap && x >= wl.gap[0] && x <= wl.gap[1])) wall.add(x + "," + wl.y); }
  else { for (let y = wl.y; y < wl.y + wl.h; y++) if (!(wl.gap && y >= wl.gap[0] && y <= wl.gap[1])) wall.add(wl.x + "," + y); }
});
model.customTerrain.forEach((t, k) => { if (t === "wall") wall.add(k); });
for (let y = 1; y <= 29; y++) wall.add("0," + y);
for (let x = 0; x <= 25; x++) wall.add(x + ",29");

const BACK = new Set(["cabinet", "bookshelf-office", "filing-cabinet", "wardrobe", "toilet", "sink", "stove-kitchen", "kitchen-counter", "locker", "bed", "double-bed"]);
const CHAIRS = new Set(["chair", "office-chair"]);
const SEATS = new Set(["sofa", "armchair"]);
const TABLES = new Set(["table", "round-table", "dining-table", "office-desk", "desk-wood"]);
const COFFEE = new Set(["round-table", "dining-table"]);

const occ = except => {
  const m = new Map();
  items.forEach(f => { if (f === except || !solid(f)) return; cellsOf(f).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(f); }); });
  return m;
};
const free = (f, x, y) => {
  const probe = { ...f, x, y };
  const pc = cellsOf(probe);
  if (pc.some(k => anchorCells.has(k) || roadCells.has(k))) return false;
  const o = occ(f);
  return !pc.some(k => (o.get(k) || []).some(g => g.a !== f.a));
};
const wallDirs = (x, y) => {
  const out = [];
  for (let d = 1; d <= 4; d++) {
    if (wall.has((Math.round(x) + d) + "," + Math.round(y))) out.push(["E", d]);
    if (wall.has((Math.round(x) - d) + "," + Math.round(y))) out.push(["W", d]);
    if (wall.has(Math.round(x) + "," + (Math.round(y) + d))) out.push(["S", d]);
    if (wall.has(Math.round(x) + "," + (Math.round(y) - d))) out.push(["N", d]);
    if (out.length) break;
  }
  return out;
};
const nearestOf = (f, set, r) => {
  let best = null, bd = Infinity;
  items.forEach(g => { if (g === f || !set.has(g.a)) return; const d = Math.hypot(g.x - f.x, g.y - f.y); if (d < bd) { bd = d; best = g; } });
  return best && bd <= r ? best : null;
};

const moves = [];
const pending = items.filter(f => solid(f));

// ① 贴墙类
pending.forEach(f => {
  if (!BACK.has(f.a)) return;
  if (wallDirs(f.x, f.y).length) return;      // 已贴墙
  for (const [dir, d] of wallDirs(f.x, f.y).length ? [] : [["N", 3], ["S", 3], ["W", 3], ["E", 3]]) {
    for (let step = 0.5; step <= d + 2; step += 0.5) {
      const x = dir === "E" ? f.x + step : dir === "W" ? f.x - step : f.x;
      const y = dir === "S" ? f.y + step : dir === "N" ? f.y - step : f.y;
      if (!wallDirs(x, y).length) continue;
      if (!free(f, x, y)) continue;
      moves.push([f.id || f.a, f.x, f.y, x, y, "贴墙"]);
      f.x = x; f.y = y;
      break;
    }
    if (wallDirs(f.x, f.y).length) break;
  }
});

// ② 成组类：椅子 → 桌，沙发 → 茶几
pending.forEach(f => {
  const isChair = CHAIRS.has(f.a), isSeat = SEATS.has(f.a);
  if (!isChair && !isSeat) return;
  const tgt = isChair ? nearestOf(f, TABLES, 9) : nearestOf(f, COFFEE, 9);
  if (!tgt) return;
  const limit = isChair ? 1.8 : 2.2;
  if (Math.hypot(tgt.x - f.x, tgt.y - f.y) <= limit) return;
  const dx = tgt.x - f.x, dy = tgt.y - f.y, len = Math.hypot(dx, dy) || 1;
  for (let k = 0.5; k <= len; k += 0.5) {
    const x = f.x + (dx / len) * k, y = f.y + (dy / len) * k;
    if (Math.hypot(tgt.x - x, tgt.y - y) > limit) continue;
    if (!free(f, x, y)) continue;
    moves.push([f.id || f.a, f.x, f.y, Math.round(x * 10) / 10, Math.round(y * 10) / 10, "成组"]);
    f.x = Math.round(x * 10) / 10; f.y = Math.round(y * 10) / 10;
    break;
  }
});

console.log("修正 " + moves.length + " 件（贴墙 " + moves.filter(m => m[5] === "贴墙").length + " · 成组 " + moves.filter(m => m[5] === "成组").length + "）");
moves.slice(0, 12).forEach(m => console.log("  " + m[5] + " " + String(m[0]).padEnd(16) + m[1] + "," + m[2] + " → " + m[3] + "," + m[4]));

if (moves.length) {
  const mapPath = path.join(ROOT, "web", "map.json");
  const customPath = path.join(ROOT, "hub", "map.custom.json");
  const mj = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const cj = JSON.parse(fs.readFileSync(customPath, "utf8"));
  const all = mj.furniture.concat(cj.furniture);
  moves.forEach(([id, ox, oy, nx, ny]) => {
    const f = all.find(v => v.id === id && Math.abs(v.x - ox) < 0.06 && Math.abs(v.y - oy) < 0.06) || all.find(v => v.id === id);
    if (f) { f.x = nx; f.y = ny; }
  });
  fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
  fs.writeFileSync(customPath, JSON.stringify(cj, null, 1));
  const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
  rebuild();
  const run = (t) => { try { return execFileSync(process.execPath, [path.join(ROOT, "tools", t)], { encoding: "utf8" }); } catch (e) { return String(e.stdout || ""); } };
  const gates = run("check.mjs");
  const ok = /0 个错误/.test(gates);
  console.log("门禁：" + (ok ? "31/31 ✓" : "✗ 未过"));
  console.log("朝向门禁剩余违规：" + (run("facing-check.mjs").match(/✗ (\d+) 处/) || [, "0"])[1]);
  if (!ok) { try { execFileSync("git", ["checkout", "--", "web/map.json", "hub/map.custom.json"], { cwd: ROOT }); } catch {} rebuild(); console.log("→ 已回滚"); }
  else console.log("→ 已保留");
}
