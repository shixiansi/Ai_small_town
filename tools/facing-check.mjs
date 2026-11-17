#!/usr/bin/env node
/**
 * 朝向门禁（tools/facing-check.mjs）—— 只断言"能判定"的规则，判不出的一律不算错
 *
 *   node tools/facing-check.mjs           打印违规清单；有违规退出码 1
 *   node tools/facing-check.mjs --room=office
 *
 * 断言的规则（都是几何可判定的）：
 *   R1 背靠墙：cabinet / bookshelf-office / filing-cabinet / wardrobe / toilet / sink /
 *              stove-kitchen / kitchen-counter / locker → 上下左右 1 格内必须有墙
 *   R2 头靠墙：double-bed / bed → 同上（床头必须贴墙，否则看起来"悬在房里"）
 *   R3 面桌：  chair / office-chair → 2 格内必须有桌（table/round-table/dining-table/office-desk/desk-wood）
 *   R4 面茶几：sofa / armchair → 2.5 格内必须有 round-table / dining-table
 */
import { loadModel } from "./map-model.mjs";

const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("="); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const model = loadModel();
const { items, solid, roomOf, map, COLS } = model;

const wall = new Set();
for (let x = 0; x < COLS; x++) wall.add(x + ",0");
(map.walls || []).forEach(wl => {
  if (wl.x0 !== undefined) { for (let x = wl.x0; x <= wl.x1; x++) if (!(wl.gap && x >= wl.gap[0] && x <= wl.gap[1])) wall.add(x + "," + wl.y); }
  else { for (let y = wl.y; y < wl.y + wl.h; y++) if (!(wl.gap && y >= wl.gap[0] && y <= wl.gap[1])) wall.add(wl.x + "," + y); }
});
model.customTerrain.forEach((t, k) => { if (t === "wall") wall.add(k); });
for (let y = 1; y <= 29; y++) wall.add("0," + y);          // room.js 外墙裙
for (let x = 0; x <= 25; x++) wall.add(x + ",29");

const BACK_TO_WALL = new Set(["cabinet", "bookshelf-office", "filing-cabinet", "wardrobe", "toilet", "sink", "stove-kitchen", "kitchen-counter", "locker"]);
const HEAD_TO_WALL = new Set(["double-bed", "bed"]);
const FACE_TABLE = new Set(["chair", "office-chair"]);
const FACE_COFFEE = new Set(["sofa", "armchair"]);
const TABLES = new Set(["table", "round-table", "dining-table", "office-desk", "desk-wood"]);
const COFFEE = new Set(["round-table", "dining-table"]);

const touchesWall = f => {
  const tx = Math.round(f.x), ty = Math.round(f.y);
  return wall.has((tx + 1) + "," + ty) || wall.has((tx - 1) + "," + ty) || wall.has(tx + "," + (ty + 1)) || wall.has(tx + "," + (ty - 1));
};
const nearAny = (f, set, r) => items.some(g => g !== f && set.has(g.a) && Math.hypot(g.x - f.x, g.y - f.y) <= r);

const only = arg.room ? String(arg.room) : null;
const bad = [];
items.filter(f => solid(f)).forEach(f => {
  const rk = roomOf(f.x, f.y);
  if (only && rk !== only) return;
  if (BACK_TO_WALL.has(f.a) && !touchesWall(f)) bad.push([rk, f, "R1 背靠墙：1 格内没有墙"]);
  else if (HEAD_TO_WALL.has(f.a) && !touchesWall(f)) bad.push([rk, f, "R2 头靠墙：1 格内没有墙"]);
  else if (FACE_TABLE.has(f.a) && !nearAny(f, TABLES, 2)) bad.push([rk, f, "R3 面桌：2 格内没有桌子"]);
  else if (FACE_COFFEE.has(f.a) && !nearAny(f, COFFEE, 2.5)) bad.push([rk, f, "R4 面茶几：2.5 格内没有茶几"]);
});

console.log("\n朝向门禁");
console.log("─".repeat(70));
if (!bad.length) console.log("  ✓ 全部通过（只断言可判定件）");
else {
  console.log("  ✗ " + bad.length + " 处违规：");
  bad.slice(0, 25).forEach(([rk, f, why]) => console.log("    " + (rk || "户外").padEnd(9) + (f.a + "@" + f.x + "," + f.y).padEnd(28) + why));
  if (bad.length > 25) console.log("    … 另 " + (bad.length - 25) + " 处");
}
console.log("─".repeat(70) + "\n");
if (bad.length) process.exitCode = 1;
