#!/usr/bin/env node
/**
 * 朝向门禁（tools/facing-check.mjs）—— 只断言"能判定"的规则，判不出的一律不算错
 *
 *   node tools/facing-check.mjs           打印违规清单；有违规退出码 1
 *   node tools/facing-check.mjs --room=office
 *   node tools/facing-check.mjs --json    机器可读（check.mjs 第 32 项用这个）
 *
 * 断言的规则（都是几何可判定的）：
 *   R1 背靠墙：cabinet / bookshelf-office / filing-cabinet / wardrobe / toilet / sink /
 *              stove-kitchen / kitchen-counter / locker
 *   R2 头靠墙：double-bed / bed（床头必须贴墙，否则看起来"悬在房里"）
 *   R3 面桌：  chair / office-chair → 2 格内必须有桌（table/round-table/dining-table/office-desk/desk-wood）
 *   R4 面茶几：sofa / armchair → 2.5 格内必须有 round-table / dining-table
 *
 * §5.1 口径（v2.9 修正，之前是错的）：贴墙 = 与墙相邻 **且本格不是墙**。
 * 判定与墙格都走 map-model，本文件不再自己拼墙（那是 4 份副本漂移的根源）。
 */
import { loadModel } from "./map-model.mjs";

const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("="); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const model = loadModel();
const { items, solid, roomOf, wallTouch, cellsOf } = model;

const BACK_TO_WALL = new Set(["cabinet", "bookshelf-office", "filing-cabinet", "wardrobe", "toilet", "sink", "stove-kitchen", "kitchen-counter", "locker"]);
const HEAD_TO_WALL = new Set(["double-bed", "bed"]);
const FACE_TABLE = new Set(["chair", "office-chair"]);
const FACE_COFFEE = new Set(["sofa", "armchair"]);
const TABLES = new Set(["table", "round-table", "dining-table", "office-desk", "desk-wood"]);
const COFFEE = new Set(["round-table", "dining-table"]);

const nearAny = (f, set, r) => items.some(g => g !== f && set.has(g.a) && Math.hypot(g.x - f.x, g.y - f.y) <= r);

const only = arg.room ? String(arg.room) : null;
const bad = [];
items.filter(f => solid(f)).forEach(f => {
  const rk = roomOf(f.x, f.y);
  if (only && rk !== only) return;
  const wt = backToWallOf(f.a) ? wallTouch(f) : null;
  if ((BACK_TO_WALL.has(f.a) || HEAD_TO_WALL.has(f.a)) && wt === "on-wall") {
    // 压在墙格上：家具被推进墙里。旧实现会把这种也算"贴墙"而放过，是 §5.1 的 bug。
    bad.push([rk, f, (BACK_TO_WALL.has(f.a) ? "R1" : "R2") + " 背靠墙：家具自己压在墙格上 " + cellsOf(f).filter(k => model.wallCells.has(k)).join("|"), "on-wall"]);
  } else if (BACK_TO_WALL.has(f.a) && wt === "none") {
    bad.push([rk, f, "R1 背靠墙：1 格内没有墙", "no-wall"]);
  } else if (HEAD_TO_WALL.has(f.a) && wt === "none") {
    bad.push([rk, f, "R2 头靠墙：1 格内没有墙", "no-wall"]);
  } else if (FACE_TABLE.has(f.a) && !nearAny(f, TABLES, 2)) {
    bad.push([rk, f, "R3 面桌：2 格内没有桌子", "no-table"]);
  } else if (FACE_COFFEE.has(f.a) && !nearAny(f, COFFEE, 2.5)) {
    bad.push([rk, f, "R4 面茶几：2.5 格内没有茶几", "no-coffee"]);
  }
});

function backToWallOf(a) { return BACK_TO_WALL.has(a) || HEAD_TO_WALL.has(a); }

if (arg.json) {
  console.log(JSON.stringify({
    violations: bad.map(([rk, f, why, code]) => ({ room: rk, id: f.id || null, a: f.a, x: f.x, y: f.y, rule: why.slice(0, 2), code, msg: why })),
    checked: items.filter(f => solid(f) && (BACK_TO_WALL.has(f.a) || HEAD_TO_WALL.has(f.a) || FACE_TABLE.has(f.a) || FACE_COFFEE.has(f.a))).length,
    wallCells: model.wallCells.size
  }, null, 2));
  process.exit(bad.length ? 1 : 0);
}

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
