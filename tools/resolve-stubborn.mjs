// 顽固 8 件的逐件定点：在自己的房间里按 0.5 格网格穷举所有空位（而不是只试环形偏移）
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel, parityWithCheck } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const WRITE = process.argv.includes("--write");
const model = loadModel();
const { items, cellsOf, solid, rooms, roomOf, anchorCells, roadCells, anchors, ROWS, COLS } = model;

const DECOR = new Set(["plant-office", "book-stack", "floor-lamp", "flowers", "coffee-mug", "bush", "paper-stack"]);
const SIT = new Set(Object.values(anchors).map(a => a.sit).filter(Boolean));
const protectedSet = new Set();
Object.values(anchors).forEach(a => { if (a.sit) protectedSet.add(a.sit); });
Object.values(anchors).forEach(a => items.forEach(f => {
  if (Math.abs(f.x - a.raw[0]) <= 1.2 && Math.abs(f.y - a.raw[1]) <= 1.2) protectedSet.add(f.id);
}));

const occ = except => {
  const m = new Map();
  items.forEach(f => { if (f === except || !solid(f)) return; cellsOf(f).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(f); }); });
  return m;
};
const conflicts = f => {
  const m = occ(f), out = [];
  cellsOf(f).forEach(k => (m.get(k) || []).forEach(g => { if (g.a !== f.a && !out.includes(g)) out.push(g); }));
  return out;
};

let stubborn = items.filter(f => solid(f) && conflicts(f).length);
console.log("\n顽固件 " + stubborn.length + " 件：");
stubborn.forEach(f => console.log("  " + (f.id || f.a).padEnd(16) + f.x + "," + f.y + "  ← " + conflicts(f).map(g => g.id || g.a).join("/")));

const moves = [], dels = [], manual = [];
for (const f of stubborn) {
  const home = roomOf(f.x, f.y);
  const r = rooms[home] || { x: 0, y: 0, w: COLS, h: ROWS };
  let best = null;
  // 0.5 格网格穷举，按"离原位距离"排序
  const cands = [];
  for (let y = r.y + 0.5; y <= r.y + r.h - 0.5; y += 0.5) {
    for (let x = r.x + 0.5; x <= r.x + r.w - 0.5; x += 0.5) {
      cands.push([x, y, Math.hypot(x - f.x, y - f.y)]);
    }
  }
  cands.sort((a, b) => a[2] - b[2]);
  for (const [x, y] of cands) {
    // 必须有肉眼可见的位移（≥1 格），否则就是把坐标蹭进另一格"骗过模型"，画面仍然重叠
    if (Math.hypot(x - f.x, y - f.y) < 1.0) continue;
    const probe = { ...f, x, y };
    const pc = cellsOf(probe);
    if (pc.some(k => anchorCells.has(k) || roadCells.has(k))) continue;
    if (conflicts(probe).length) continue;
    best = [x, y]; break;
  }
  if (best) { moves.push([f.id || f.a, f.x, f.y, best[0], best[1]]); f.x = best[0]; f.y = best[1]; }
  else if (DECOR.has(f.a)) { dels.push([f.id || f.a, f.x, f.y]); const i = items.indexOf(f); if (i >= 0) items.splice(i, 1); }
  else manual.push((f.id || f.a) + "@" + f.x + "," + f.y);
}
console.log("\n结果：挪 " + moves.length + " · 删 " + dels.length + " · 人工 " + manual.length + (manual.length ? "：" + manual.join(" | ") : ""));
moves.forEach(m => console.log("  挪 " + String(m[0]).padEnd(15) + m[1] + "," + m[2] + " → " + m[3] + "," + m[4]));
dels.forEach(m => console.log("  删 " + String(m[0]).padEnd(15) + m[1] + "," + m[2]));
const left = items.filter(f => solid(f) && conflicts(f).length);
console.log("仍有真重叠 " + left.length + " 件" + (left.length ? "：" + left.map(f => f.id || f.a).join(" | ") : " ✓"));

if (WRITE && (moves.length || dels.length)) {
  const mapPath = path.join(ROOT, "web", "map.json");
  const customPath = path.join(ROOT, "hub", "map.custom.json");
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const custom = JSON.parse(fs.readFileSync(customPath, "utf8"));
  const all = map.furniture.concat(custom.furniture);
  const locate = (id, x, y) => all.find(f => f.id === id && Math.abs(f.x - x) < 0.06 && Math.abs(f.y - y) < 0.06) || all.find(f => f.id === id);
  moves.forEach(([id, ox, oy, nx, ny]) => { const f = locate(id, ox, oy); if (f) { f.x = nx; f.y = ny; } });
  dels.forEach(([id, x, y]) => { const f = locate(id, x, y); if (!f) return; if (map.furniture.includes(f)) map.furniture = map.furniture.filter(v => v !== f); else custom.furniture = custom.furniture.filter(v => v !== f); });
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 1));
  fs.writeFileSync(customPath, JSON.stringify(custom, null, 1));
  const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
  rebuild();
  let gates = "";
  try { gates = execFileSync(process.execPath, [path.join(ROOT, "tools", "check.mjs")], { encoding: "utf8" }); } catch (e) { gates = String(e.stdout || ""); }
  const ok = /0 个错误/.test(gates);
  const p = parityWithCheck(loadModel());
  console.log("门禁：" + (ok ? "31/31 ✓" : "✗ 未过") + " · 对账：" + (p.mismatches.length ? "⚠ " + p.mismatches.length : "✓ 全一致"));
  if (!ok || p.mismatches.length) {
    try { execFileSync("git", ["checkout", "--", "web/map.json", "hub/map.custom.json"], { cwd: ROOT }); } catch {}
    rebuild(); console.log("→ 已回滚");
  } else console.log("→ 已保留");
}
