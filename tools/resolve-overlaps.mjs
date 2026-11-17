#!/usr/bin/env node
/**
 * 消重叠执行器（tools/resolve-overlaps.mjs）—— 只读 tools/map-model.mjs 的占格模型
 *
 *   node tools/resolve-overlaps.mjs            # 试运行（只打印）
 *   node tools/resolve-overlaps.mjs --write    # 真的写盘
 *
 * 规则（三次失败换来的）：
 *   ① 保护集：任何 zone 的 sit.host、以及距锚点 ≤1.2 格的家具 —— 永不移动
 *   ② 锚点格 + 四邻 = 硬占位（不许落到那里）
 *   ③ 只挪"未被保护"的一方；两边都被保护就报人工
 *   ④ 只处理"不同素材"的碰撞重叠；同素材（密林）豁免
 *   ⑤ 候选位必须在同一房间 + 地图内；本轮只做单步 ±1.5 格，避免把东西搬到房间另一头
 */
import fs from "node:fs";
import path from "node:path";
import { loadModel, parityWithCheck } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const WRITE = process.argv.includes("--write");
const model = loadModel();
const { man, items, cellsOf, solid, rooms, roomOf, anchorCells, anchors } = model;
const T = model.T, COLS = model.COLS, ROWS = model.ROWS;

// ① 保护集
const protectedSet = new Set();
Object.values(anchors).forEach(a => {
  if (a.sit) protectedSet.add(a.sit);
  items.forEach(f => { if (Math.abs(f.x - a.raw[0]) <= 1.2 && Math.abs(f.y - a.raw[1]) <= 1.2) protectedSet.add(f.id); });
});
const occ = (except) => {
  const m = new Map();
  items.forEach(f => {
    if (f === except || !solid(f)) return;
    cellsOf(f).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(f); });
  });
  return m;
};
const conflicts = f => {
  const m = occ(f);
  const out = [];
  cellsOf(f).forEach(k => (m.get(k) || []).forEach(g => { if (g.a !== f.a && !out.includes(g)) out.push(g); }));
  return out;
};

const OFFS = [[0, -1.5], [0, 1.5], [-1.5, 0], [1.5, 0], [1.5, -1.5], [-1.5, -1.5], [1.5, 1.5], [-1.5, 1.5], [0, 3], [0, -3], [3, 0], [-3, 0]];
let moves = [], manual = [];
let work = items.map(f => ({ f, x: f.x, y: f.y }));   // 试运行副本

for (let pass = 0; pass < 3; pass++) {
  let n = 0;
  for (const w of work) {
    const f = w.f;
    if (!solid(f)) continue;
    const proxy = { ...f, x: w.x, y: w.y };
    if (!conflicts(proxy).length) continue;
    const partners = conflicts(proxy).filter(g => !protectedSet.has(g.id));
    const victim = protectedSet.has(f.id) ? (partners[0] && work.find(q => q.f === partners[0]) ? { ...partners[0], x: partners[0].x, y: partners[0].y } : null) : proxy;
    if (!victim) { manual.push((f.id || f.a) + " 与受保护件重叠，需人工"); continue; }
    const target = protectedSet.has(f.id) ? work.find(q => q.f === partners[0]) : w;
    const home = roomOf(target.x, target.y);
    let done = false;
    for (const [dx, dy] of OFFS) {
      const nx = Math.round((target.x + dx) * 10) / 10, ny = Math.round((target.y + dy) * 10) / 10;
      if (ny < 1.5 || ny > ROWS - 1.5 || nx < 0.5 || nx > COLS - 0.5) continue;
      if (home && roomOf(nx, ny) !== home) continue;
      const probe = { ...target.f, x: nx, y: ny };
      const probeCells = cellsOf(probe);
      if (probeCells.some(k => anchorCells.has(k))) continue;          // ② 锚点格 + 四邻
      if (probeCells.some(k => model.roadCells.has(k))) continue;      // ⑥ 道路格也是禁落区
      const ox = target.x, oy = target.y;
      target.x = nx; target.y = ny;
      const probe2 = { ...target.f, x: nx, y: ny };
      if (!conflicts(probe2).length) { moves.push([target.f.id || target.f.a, ox, oy, nx, ny]); n++; done = true; break; }
      target.x = ox; target.y = oy;
    }
    if (!done) manual.push((target.f.id || target.f.a) + " 无处可挪");
  }
  if (!n) break;
}

console.log("\n消重叠" + (WRITE ? "（写盘）" : "（试运行）"));
console.log("─".repeat(64));
moves.forEach(([id, ox, oy, nx, ny]) => console.log("  挪 " + id.padEnd(16) + ox + "," + oy + " → " + nx + "," + ny));
console.log("  共 " + moves.length + " 步 · 需人工 " + manual.length + " 处" + (manual.length ? "：" + manual.slice(0, 6).join(" | ") : ""));
const left = work.filter(w => solid(w.f) && conflicts({ ...w.f, x: w.x, y: w.y }).length);
console.log("  仍有真重叠 " + left.length + " 件" + (left.length ? "：" + left.map(w => (w.f.id || w.f.a)).join(" | ") : " ✓"));

if (WRITE && moves.length) {
  const mapPath = path.join(ROOT, "web", "map.json");
  const customPath = path.join(ROOT, "hub", "map.custom.json");
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const custom = JSON.parse(fs.readFileSync(customPath, "utf8"));
  const findIn = (id, ox, oy) => {
    const pool = map.furniture.concat(custom.furniture);
    return pool.find(f => f.id === id && Math.abs(f.x - ox) < 0.05 && Math.abs(f.y - oy) < 0.05)
        || pool.find(f => f.id === id);
  };
  moves.forEach(([id, ox, oy, nx, ny]) => { const f = findIn(id, ox, oy); if (f) { f.x = nx; f.y = ny; } });
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 1));
  fs.writeFileSync(customPath, JSON.stringify(custom, null, 1));
  console.log("  已写盘");
  const m2 = loadModel();
  const p = parityWithCheck(m2);
  console.log("  写盘后与门禁对账：" + (p.mismatches.length ? "⚠ " + p.mismatches.length + " 处不一致" : "✓ 锚点全部一致"));
}
console.log("─".repeat(64) + "\n");
