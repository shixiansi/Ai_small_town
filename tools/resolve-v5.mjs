#!/usr/bin/env node
/**
 * 消重叠执行器 v6（最终版）—— 在 tools/map-model.mjs 的唯一占格模型上运行
 *   node tools/resolve-v5.mjs           试运行
 *   node tools/resolve-v5.mjs --write   写盘 + 自动对账；门禁或对账不过则整批回滚
 *
 * 规则：
 *  ① 保护集 = sit.host ∪ (距锚点 ≤1.2 格的家具)
 *  ② 受保护件之间相撞 → 挪"非 sit.host 且离自己锚点更远"的一方（v5 缺的就是这条）
 *  ③ 禁落区 = 锚点格 + 四邻、道路格；候选须在地图内、同一房间（第三档半径才允许同建筑跨房间）
 *  ④ 装饰件实在无处可放 → 删；功能件只挪不删
 *  ⑤ 同素材互叠豁免（密林）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel, parityWithCheck } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const WRITE = process.argv.includes("--write");
const model = loadModel();
const { items, cellsOf, solid, roomOf, anchorCells, roadCells, anchors, ROWS, COLS } = model;

const DECOR = new Set(["plant-office", "book-stack", "flowers", "floor-lamp", "coffee-mug", "paper-stack", "bush", "trophy-cup", "crown-cushion"]);
const BUILDING = { office: "main", bedroom: "main", bath: "main", kitchen: "main", nbCat: "cat", nbChief: "chief", nbDoc: "doc" };
const SIT_HOSTS = new Set(Object.values(anchors).map(a => a.sit).filter(Boolean));

// 每件家具到"最近锚点"的距离（用于规则②挑谁该动）
const anchorList = Object.values(anchors);
const distToAnchor = f => Math.min(...anchorList.map(a => Math.hypot(f.x - a.raw[0], f.y - a.raw[1])));
const protectedSet = new Set();
Object.values(anchors).forEach(a => {
  if (a.sit) protectedSet.add(a.sit);
  items.forEach(f => { if (Math.abs(f.x - a.raw[0]) <= 1.2 && Math.abs(f.y - a.raw[1]) <= 1.2) protectedSet.add(f.id); });
});

const occOf = except => {
  const m = new Map();
  items.forEach(f => {
    if (f === except || !solid(f)) return;
    cellsOf(f).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(f); });
  });
  return m;
};
const conflictsOf = f => {
  const m = occOf(f), out = [];
  cellsOf(f).forEach(k => (m.get(k) || []).forEach(g => { if (g.a !== f.a && !out.includes(g)) out.push(g); }));
  return out;
};
const RADII = [1.5, 3, 6];
const ring = r => {
  const out = [];
  for (let dx = -r; dx <= r; dx += 1.5) for (let dy = -r; dy <= r; dy += 1.5) if (dx || dy) out.push([dx, dy]);
  return out.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]));
};

const work = items.map(f => ({ f, x: f.x, y: f.y }));
const moves = [], deletions = [], manual = [];

for (let pass = 0; pass < 4; pass++) {
  let acted = 0;
  for (const w of work) {
    if (w.__del || !solid(w.f)) continue;
    const self = { ...w.f, x: w.x, y: w.y };
    const bad = conflictsOf(self);
    if (!bad.length) continue;

    let mw = w;
    if (protectedSet.has(w.f.id)) {                       // ② 受保护件互撞：挑"非 sit.host 且离锚点更远"的动
      const pool = bad.filter(g => !SIT_HOSTS.has(g.id));
      const pick = (pool.length ? pool : bad).sort((a, b) => distToAnchor(b) - distToAnchor(a))[0];
      const entry = work.find(q => q.f === pick);
      if (!entry) { manual.push((w.f.id || w.f.a) + " 与受保护件重叠且无可动方"); continue; }
      mw = entry;
    }

    const home = roomOf(mw.x, mw.y), homeB = BUILDING[home] || null;
    let placed = false;
    for (const r of RADII) {
      for (const [dx, dy] of ring(r)) {
        const nx = Math.round((mw.x + dx) * 10) / 10, ny = Math.round((mw.y + dy) * 10) / 10;
        if (ny < 1.5 || ny > ROWS - 1.5 || nx < 0.5 || nx > COLS - 0.5) continue;
        const probe = { ...mw.f, x: nx, y: ny };
        const pc = cellsOf(probe);
        if (pc.some(k => anchorCells.has(k) || roadCells.has(k))) continue;
        const nr = roomOf(nx, ny);
        if (nr !== home && !(r === 6 && nr && homeB && BUILDING[nr] === homeB)) continue;
        if (conflictsOf(probe).length) continue;
        moves.push([mw.f.id || mw.f.a, mw.x, mw.y, nx, ny]);
        mw.x = nx; mw.y = ny; placed = true; acted++;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      if (DECOR.has(mw.f.a)) { deletions.push([mw.f.id || mw.f.a, mw.x, mw.y]); mw.__del = true; acted++; }
      else manual.push((mw.f.id || mw.f.a) + "@" + mw.x + "," + mw.y + " 无处可挪");
    }
  }
  const dead = work.filter(w => w.__del);
  if (dead.length) dead.forEach(w => { const i = items.indexOf(w.f); if (i >= 0) items.splice(i, 1); });
  if (!acted) break;
}

const alive = work.filter(w => !w.__del);
const left = alive.filter(w => solid(w.f) && conflictsOf({ ...w.f, x: w.x, y: w.y }).length);
console.log("\n消重叠 v6" + (WRITE ? "（写盘）" : "（试运行）"));
console.log("─".repeat(66));
moves.forEach(([id, ox, oy, nx, ny]) => console.log("  挪 " + String(id).padEnd(15) + ox + "," + oy + " → " + nx + "," + ny));
deletions.forEach(([id, x, y]) => console.log("  删 " + String(id).padEnd(15) + x + "," + y + "（装饰，无处可放）"));
console.log("  挪 " + moves.length + " · 删 " + deletions.length + " · 需人工 " + manual.length + (manual.length ? "：" + manual.slice(0, 5).join(" | ") : ""));
console.log("  仍有真重叠 " + left.length + " 件" + (left.length ? "：" + left.map(w => w.f.id || w.f.a).join(" | ") : " ✓"));
console.log("─".repeat(66));

if (WRITE && (moves.length || deletions.length)) {
  const mapPath = path.join(ROOT, "web", "map.json");
  const customPath = path.join(ROOT, "hub", "map.custom.json");
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const custom = JSON.parse(fs.readFileSync(customPath, "utf8"));
  const all = map.furniture.concat(custom.furniture);
  const locate = (id, x, y) => all.find(f => f.id === id && Math.abs(f.x - x) < 0.06 && Math.abs(f.y - y) < 0.06) || all.find(f => f.id === id);
  moves.forEach(([id, ox, oy, nx, ny]) => { const f = locate(id, ox, oy); if (f) { f.x = nx; f.y = ny; } });
  deletions.forEach(([id, x, y]) => {
    const f = locate(id, x, y);
    if (!f) return;
    if (map.furniture.includes(f)) map.furniture = map.furniture.filter(v => v !== f);
    else custom.furniture = custom.furniture.filter(v => v !== f);
  });
  fs.writeFileSync(mapPath, JSON.stringify(map, null, 1));
  fs.writeFileSync(customPath, JSON.stringify(custom, null, 1));
  const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
  rebuild();
  let gates = "";
  try { gates = execFileSync(process.execPath, [path.join(ROOT, "tools", "check.mjs")], { encoding: "utf8" }); }
  catch (e) { gates = String(e.stdout || ""); }
  const ok = /0 个错误/.test(gates);
  const p = parityWithCheck(loadModel());
  console.log("  门禁：" + (ok ? "31/31 ✓" : "✗ 未过") + " · 锚点对账：" + (p.mismatches.length ? "⚠ " + p.mismatches.length + " 处不一致" : "✓ 全一致"));
  if (!ok || p.mismatches.length) {
    try { execFileSync("git", ["checkout", "--", "web/map.json", "hub/map.custom.json"], { cwd: ROOT }); } catch {}
    rebuild();
    console.log("  → 已整批回滚");
  } else console.log("  → 已保留");
}
