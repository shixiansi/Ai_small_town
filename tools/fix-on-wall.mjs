// 把"踩在墙上"的家具挪进屋内：用唯一占格模型的 blocked（含墙/水/家具）做候选过滤
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel, parityWithCheck } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const WRITE = process.argv.includes("--write");
const model = loadModel();
const { items, cellsOf, solid, rooms, roomOf, anchorCells, roadCells, blocked, ROWS, COLS } = model;

const onWall = f => cellsOf(f).some(k => {
  const [x, y] = k.split(",").map(Number);
  return !(blocked[y] && blocked[y][x] === false) && !roadCells.has(k);   // 该格被墙/水占用
});
// 更准：只看"墙/水"造成的阻挡（排除家具自己压出来的阻挡，否则永远为真）
const wallBlocked = (x, y) => {
  if (y === 0) return true;
  for (const wl of model.map.walls || []) {
    if (wl.x0 !== undefined) {
      if (y === wl.y && x >= wl.x0 && x <= wl.x1) { if (!(wl.gap && x >= wl.gap[0] && x <= wl.gap[1])) return true; }
    } else if (x === wl.x && y >= wl.y && y < wl.y + wl.h) { if (!(wl.gap && y >= wl.gap[0] && y <= wl.gap[1])) return true; }
  }
  let terr = false;
  model.customTerrain.forEach((t, k) => { if (k === x + "," + y && (t === "wall" || t === "water")) terr = true; });
  return terr;
};
const bad = items.filter(f => solid(f) && cellsOf(f).some(k => { const [x, y] = k.split(",").map(Number); return wallBlocked(x, y); }));
console.log("\n踩墙/踩水的家具 " + bad.length + " 件：" + bad.map(f => (f.id || f.a) + "@" + f.x + "," + f.y).join(" | "));

const occ = except => {
  const m = new Map();
  items.forEach(f => { if (f === except || !solid(f)) return; cellsOf(f).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(f); }); });
  return m;
};
const moves = [], manual = [];
for (const f of bad) {
  const home = roomOf(f.x, f.y);
  const r = rooms[home] || { x: 0, y: 0, w: COLS, h: ROWS };
  const cands = [];
  for (let y = r.y + 0.5; y <= r.y + r.h - 0.5; y += 0.5)
    for (let x = r.x + 0.5; x <= r.x + r.w - 0.5; x += 0.5)
      if (Math.hypot(x - f.x, y - f.y) >= 1.0) cands.push([x, y, Math.hypot(x - f.x, y - f.y)]);
  cands.sort((a, b) => a[2] - b[2]);
  let done = false;
  for (const [x, y] of cands) {
    const probe = { ...f, x, y };
    const pc = cellsOf(probe);
    if (pc.some(k => { const [px, py] = k.split(",").map(Number); return wallBlocked(px, py); })) continue;
    if (pc.some(k => anchorCells.has(k) || roadCells.has(k))) continue;
    const o = occ(f);
    if (pc.some(k => (o.get(k) || []).some(g => g.a !== f.a))) continue;
    moves.push([f.id || f.a, f.x, f.y, x, y]); f.x = x; f.y = y; done = true; break;
  }
  if (!done) manual.push((f.id || f.a) + "@" + f.x + "," + f.y);
}
console.log("挪 " + moves.length + " 件 · 人工 " + manual.length + (manual.length ? "：" + manual.join(" | ") : ""));
moves.forEach(m => console.log("  " + String(m[0]).padEnd(16) + m[1] + "," + m[2] + " → " + m[3] + "," + m[4]));

if (WRITE && moves.length) {
  const mapPath = path.join(ROOT, "web", "map.json");
  const customPath = path.join(ROOT, "hub", "map.custom.json");
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const custom = JSON.parse(fs.readFileSync(customPath, "utf8"));
  const all = map.furniture.concat(custom.furniture);
  moves.forEach(([id, ox, oy, nx, ny]) => {
    const f = all.find(v => v.id === id && Math.abs(v.x - ox) < 0.06 && Math.abs(v.y - oy) < 0.06) || all.find(v => v.id === id);
    if (f) { f.x = nx; f.y = ny; }
  });
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 1));
  fs.writeFileSync(customPath, JSON.stringify(custom, null, 1));
  const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
  rebuild();
  let gates = ""; try { gates = execFileSync(process.execPath, [path.join(ROOT, "tools", "check.mjs")], { encoding: "utf8" }); } catch (e) { gates = String(e.stdout || ""); }
  const ok = /0 个错误/.test(gates);
  const p = parityWithCheck(loadModel());
  console.log("门禁：" + (ok ? "31/31 ✓" : "✗") + " · 对账：" + (p.mismatches.length ? "⚠" : "✓ 全一致"));
  if (!ok || p.mismatches.length) { try { execFileSync("git", ["checkout", "--", "web/map.json", "hub/map.custom.json"], { cwd: ROOT }); } catch {} rebuild(); console.log("→ 已回滚"); }
  else console.log("→ 已保留");
}
