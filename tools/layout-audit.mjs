#!/usr/bin/env node
/**
 * 布局审计（tools/layout-audit.mjs）—— 补上"结构门禁查不出来、但一眼就看得出难看"的部分
 *
 * 起因：用户贴了办公室实拍，家具在整片空地上均匀散点 —— 而我的门禁（重叠 0 / 光照 ≥15% /
 * 锚点对账 35 全一致）全部是绿的。说明这些指标是"必要但不充分"，缺的是**布局**度量。
 *
 * 本工具量四件事（都能量化"像不像人摆的"）：
 *   ① 贴墙率：大件（柜/床/沙发/书架/桌/浴缸/马桶）是否靠墙（§5.1：与墙相邻且本格不是墙）
 *   ② 成组度：每件家具到"最近同类/相关件"的距离中位数（散点式摆放会显著偏大）
 *   ③ 空段：房间内沿长轴最长的连续空地板（格）
 *   ④ 对齐率：同一行/列上成对出现的家具占比（靠墙成排的屋子这值高）
 *
 *   node tools/layout-audit.mjs              全图逐房间
 *   node tools/layout-audit.mjs --room=office
 */
import { loadModel } from "./map-model.mjs";

const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("="); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const model = loadModel();
const { items, solid, cellsOf, rooms, roomOf, map, COLS, ROWS, touchesWall } = model;

const BIG = new Set(["cabinet", "bookshelf-office", "wardrobe", "sofa", "double-bed", "bed", "desk-wood", "office-desk",
  "school-desk", "dining-table", "round-table", "filing-cabinet", "locker", "bathtub", "toilet", "sink",
  "kitchen-counter", "fridge", "stove-kitchen", "cottage", "house-modern", "farmhouse", "well", "market-stall", "stall-fruit"]);

/* 墙格与"贴墙"判定一律走 map-model（§5.1：与墙相邻且本格不是墙）。
 * 这里原来自己拼了一份墙集合 + 自己写 nearWall，和 facing-check 各错各的 —— 现在只有一份。 */
const nearWall = touchesWall;

const targets = arg.room ? [String(arg.room)] : Object.keys(rooms);
const rows = [];
for (const rk of targets) {
  const r = rooms[rk]; if (!r) continue;
  const inR = items.filter(f => {
    const rr = roomOf(f.x, f.y);
    return rr === rk && solid(f);
  });
  if (!inR.length) { rows.push({ rk, n: 0 }); continue; }

  // ① 贴墙率（只看大件）
  const bigs = inR.filter(f => BIG.has(f.a));
  const onWall = bigs.filter(nearWall).length;
  const wallRate = bigs.length ? onWall / bigs.length : 1;

  // ② 成组度：最近邻距离中位数
  const dists = inR.map(f => {
    let m = Infinity;
    inR.forEach(g => { if (g === f) return; const d = Math.hypot(g.x - f.x, g.y - f.y); if (d < m) m = d; });
    return m === Infinity ? 0 : m;
  }).sort((a, b) => a - b);
  const nnMedian = dists.length ? dists[Math.floor(dists.length / 2)] : 0;

  // ③ 最长空段（房内每行/每列，连续没有家具占格的地板）
  const occ = new Set();
  inR.forEach(f => cellsOf(f).forEach(k => occ.add(k)));
  let maxRun = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    let run = 0;
    for (let x = r.x; x < r.x + r.w; x++) { if (occ.has(x + "," + y)) run = 0; else { run++; if (run > maxRun) maxRun = run; } }
  }
  for (let x = r.x; x < r.x + r.w; x++) {
    let run = 0;
    for (let y = r.y; y < r.y + r.h; y++) { if (occ.has(x + "," + y)) run = 0; else { run++; if (run > maxRun) maxRun = run; } }
  }

  // ④ 对齐率：同行（|dy|<0.6）或同列（|dx|<0.6）有成对家具的件数占比
  let aligned = 0;
  inR.forEach(f => {
    if (inR.some(g => g !== f && (Math.abs(g.y - f.y) < 0.6 || Math.abs(g.x - f.x) < 0.6))) aligned++;
  });
  const alignRate = aligned / inR.length;

  rows.push({ rk, n: inR.length, bigs: bigs.length, wallRate, nnMedian, maxRun, alignRate });
}

console.log("\n布局审计（像不像人摆的，而不是有没有违规）");
console.log("─".repeat(92));
console.log("房间       落地  大件  贴墙率  最近邻中位  最长空段  对齐率   判定");
rows.forEach(r => {
  if (!r.n) return;
  const flags = [];
  if (r.wallRate < 0.5) flags.push("大件贴墙率低");
  if (r.nnMedian > 3.2) flags.push("散点式摆放");
  if (r.maxRun > 6) flags.push("空段过长");
  if (r.alignRate < 0.35) flags.push("不成排");
  console.log(
    r.rk.padEnd(10) + String(r.n).padStart(4) + String(r.bigs).padStart(6) +
    ("  " + (r.wallRate * 100).toFixed(0) + "%").padStart(8) +
    ("  " + r.nnMedian.toFixed(1)).padStart(11) +
    ("  " + r.maxRun + " 格").padStart(9) +
    ("  " + (r.alignRate * 100).toFixed(0) + "%").padStart(8) +
    "   " + (flags.length ? "⚠ " + flags.join(" / ") : "✓")
  );
});
console.log("─".repeat(92));
console.log("判据：贴墙率 ≥50%（大件靠墙）· 最近邻中位 ≤3.2 格（成组而非散点）· 最长空段 ≤6 格 · 对齐率 ≥35%（成排）\n");
