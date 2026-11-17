// 朝向修正 v2：贴墙落点由房间矩形推导、成组只在服务对象周围一圈找、必须"改善 ≥1 格"，同房间约束
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const model = loadModel();
const { items, cellsOf, solid, anchorCells, roadCells, rooms, roomOf, map } = model;

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
const free = (f, x, y, occMap) => {
  const probe = { ...f, x, y };
  const pc = cellsOf(probe);
  if (pc.some(k => anchorCells.has(k) || roadCells.has(k))) return false;
  return !pc.some(k => (occMap.get(k) || []).some(g => g.a !== f.a));
};

const moves = [];
// ① 贴墙：房间矩形四边内侧 0.8 格，沿边扫描最近的合法位置
items.filter(f => solid(f) && BACK.has(f.a)).forEach(f => {
  const rk = roomOf(f.x, f.y); const r = rooms[rk];
  if (!r) return;
  const sides = [
    ["N", r.y + 0.8, () => [r.x + 0.6 + Math.round((f.x - r.x - 0.6)), r.y + 0.8]],
    ["S", r.y + r.h - 0.8, () => [r.x + 0.6 + Math.round((f.x - r.x - 0.6)), r.y + r.h - 0.8]],
    ["W", r.x + 0.8, () => [r.x + 0.8, r.y + 0.6 + Math.round((f.y - r.y - 0.6))]],
    ["E", r.x + r.w - 0.8, () => [r.x + r.w - 0.8, r.y + 0.6 + Math.round((f.y - r.y - 0.6))]]
  ];
  // 已经在某条边 1 格内 → 跳过
  const near = Math.min(Math.abs(f.y - (r.y + 0.8)), Math.abs(f.y - (r.y + r.h - 0.8)), Math.abs(f.x - (r.x + 0.8)), Math.abs(f.x - (r.x + r.w - 0.8)));
  if (near <= 1.0) return;
  const occMap = occ(f);
  let best = null;
  sides.forEach(([side, , mk]) => {
    for (let off = 0; off <= Math.max(r.w, r.h); off += 1) {
      for (const sgn of [1, -1]) {
        let [x, y] = mk();
        const base = side === "N" || side === "S" ? f.x : f.y;
        if (side === "N" || side === "S") x = Math.round(base) + sgn * off; else y = Math.round(base) + sgn * off;
        if (off === 0 && sgn < 0) continue;
        if (x < r.x + 0.5 || x > r.x + r.w + 0.5 || y < r.y + 0.5 || y > r.y + r.h + 0.5) continue;
        if (roomOf(x, y) !== rk) continue;
        if (!free(f, x, y, occMap)) continue;
        const d = Math.hypot(x - f.x, y - f.y);
        if (!best || d < best[2]) best = [x, y, d];
      }
    }
  });
  if (best && best[2] >= 1.0) { moves.push([f.id || f.a, f.x, f.y, best[0], best[1], "贴墙"]); f.x = best[0]; f.y = best[1]; }
});

// ② 成组：在服务对象周围 1.2~2.0 格那一圈找位（同房间）
items.filter(f => solid(f) && (CHAIRS.has(f.a) || SEATS.has(f.a))).forEach(f => {
  const rk = roomOf(f.x, f.y);
  const tgt = items.filter(g => g !== f && (CHAIRS.has(f.a) ? TABLES.has(g.a) : COFFEE.has(g.a)) && roomOf(g.x, g.y) === rk)
    .sort((a, b) => Math.hypot(a.x - f.x, a.y - f.y) - Math.hypot(b.x - f.x, b.y - f.y))[0];
  if (!tgt) return;
  const limit = CHAIRS.has(f.a) ? 1.9 : 2.2;
  if (Math.hypot(tgt.x - f.x, tgt.y - f.y) <= limit) return;
  const occMap = occ(f);
  let best = null;
  for (let a = 0; a < 360; a += 15) {
    for (const rad of [limit - 0.7, limit - 0.2, limit]) {
      const x = Math.round((tgt.x + Math.cos(a * Math.PI / 180) * rad) * 10) / 10;
      const y = Math.round((tgt.y + Math.sin(a * Math.PI / 180) * rad) * 10) / 10;
      if (roomOf(x, y) !== rk) continue;
      if (!free(f, x, y, occMap)) continue;
      const d = Math.hypot(x - f.x, y - f.y);
      if (!best || d < best[2]) best = [x, y, d];
    }
  }
  if (best && best[2] >= 1.0) { moves.push([f.id || f.a, f.x, f.y, best[0], best[1], "成组"]); f.x = best[0]; f.y = best[1]; }
});

console.log("修正 " + moves.length + " 件（贴墙 " + moves.filter(m => m[5] === "贴墙").length + " · 成组 " + moves.filter(m => m[5] === "成组").length + "）");
moves.slice(0, 10).forEach(m => console.log("  " + m[5] + " " + String(m[0]).padEnd(16) + m[1] + "," + m[2] + " → " + m[3] + "," + m[4]));

if (moves.length) {
  const mapPath = path.join(ROOT, "web", "map.json"), customPath = path.join(ROOT, "hub", "map.custom.json");
  const mj = JSON.parse(fs.readFileSync(mapPath, "utf8")), cj = JSON.parse(fs.readFileSync(customPath, "utf8"));
  const all = mj.furniture.concat(cj.furniture);
  moves.forEach(([id, ox, oy, nx, ny]) => {
    const f = all.find(v => v.id === id && Math.abs(v.x - ox) < 0.06 && Math.abs(v.y - oy) < 0.06) || all.find(v => v.id === id);
    if (f) { f.x = nx; f.y = ny; }
  });
  fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
  fs.writeFileSync(customPath, JSON.stringify(cj, null, 1));
  const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
  rebuild();
  const run = t => { try { return execFileSync(process.execPath, [path.join(ROOT, "tools", t)], { encoding: "utf8" }); } catch (e) { return String(e.stdout || ""); } };
  const ok = /0 个错误/.test(run("check.mjs"));
  const fc = run("facing-check.mjs");
  const left = (fc.match(/✗ (\d+) 处/) || [, "0"])[1];
  console.log("门禁：" + (ok ? "31/31 ✓" : "✗ 未过") + " · 朝向剩余违规：" + left);
  if (!ok) { try { execFileSync("git", ["checkout", "--", "web/map.json", "hub/map.custom.json"], { cwd: ROOT }); } catch {} rebuild(); console.log("→ 已回滚"); }
  else console.log("→ 已保留");
}
