#!/usr/bin/env node
/**
 * 朝向审计（tools/facing-audit.mjs）—— 第 4 维：摆放方向
 *
 * 现状（已查证）：家具条目里没有 flip/rot/dir/face 任何朝向字段，所有东西都用素材自带的唯一朝向。
 * 本工具不改数据，只做两件事：
 *   ① 由几何关系推导每件家具"应该朝哪"（椅子→桌心、沙发→茶几、书桌→墙、床→头顶墙…）
 *   ② 输出需要的朝向统计（左朝向/右朝向/朝上/朝下各多少件），给渲染层加 flip/rot 提供确切清单
 *
 *   node tools/facing-audit.mjs              全图
 *   node tools/facing-audit.mjs --room=office
 */
import { loadModel } from "./map-model.mjs";

const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("="); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const model = loadModel();
const { items, solid, rooms, roomOf, map, COLS } = model;

// 需要一个"服务对象"的家具 → 它该朝谁
const FACES = {
  "chair": { target: "table", need: "face-table" },
  "office-chair": { target: "desk", need: "face-desk" },
  "armchair": { target: "sofa|round-table|table", need: "face-seat-group" },
  "sofa": { target: "round-table|table", need: "face-table" },
  "office-desk": { target: "wall", need: "face-wall" },
  "desk-wood": { target: "wall", need: "face-wall" },
  "school-desk": { target: "wall", need: "face-wall" },
  "double-bed": { target: "wall", need: "head-to-wall" },
  "bed": { target: "wall", need: "head-to-wall" },
  "bookshelf-office": { target: "wall", need: "back-to-wall" },
  "wardrobe": { target: "wall", need: "back-to-wall" },
  "filing-cabinet": { target: "wall", need: "back-to-wall" },
  "cabinet": { target: "wall", need: "back-to-wall" },
  "toilet": { target: "wall", need: "back-to-wall" },
  "sink": { target: "wall", need: "back-to-wall" },
  "stove-kitchen": { target: "wall", need: "back-to-wall" },
  "kitchen-counter": { target: "wall", need: "back-to-wall" }
};

// 墙格
const wall = new Set();
for (let x = 0; x < COLS; x++) wall.add(x + ",0");
(map.walls || []).forEach(wl => {
  if (wl.x0 !== undefined) { for (let x = wl.x0; x <= wl.x1; x++) if (!(wl.gap && x >= wl.gap[0] && x <= wl.gap[1])) wall.add(x + "," + wl.y); }
  else { for (let y = wl.y; y < wl.y + wl.h; y++) if (!(wl.gap && y >= wl.gap[0] && y <= wl.gap[1])) wall.add(wl.x + "," + y); }
});
model.customTerrain.forEach((t, k) => { if (t === "wall") wall.add(k); });
// v2.8-i：加上 room.js 画的外墙裙（西 x=0 整列、南 y=29 的 x<26 段），否则朝向判不出
for (let y = 1; y <= 29; y++) wall.add("0," + y);
for (let x = 0; x <= 25; x++) wall.add(x + ",29");

const dirFrom = (fx, fy, tx, ty) => {
  const dx = tx - fx, dy = ty - fy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "E" : "W";     // 目标在右边 → 朝东
  return dy >= 0 ? "S" : "N";
};
const nearestWallDir = (fx, fy) => {
  let best = null, bd = Infinity;
  for (let d = 1; d <= 3; d++) {
    const probe = [[fx, fy - d, "N"], [fx, fy + d, "S"], [fx - d, fy, "W"], [fx + d, fy, "E"]];
    for (const [x, y, dir] of probe) {
      if (wall.has(Math.round(x) + "," + Math.round(y)) && d < bd) { bd = d; best = dir; }
    }
    if (best) break;
  }
  return best;
};

const roomFilter = arg.room ? String(arg.room) : null;
const rows = [];
const tally = { E: 0, W: 0, N: 0, S: 0, unknown: 0 };
items.filter(f => solid(f)).forEach(f => {
  const rule = FACES[f.a];
  if (!rule) return;
  const rk = roomOf(f.x, f.y);
  if (roomFilter && rk !== roomFilter) return;
  let need = "?";
  if (rule.target === "wall") {
    need = nearestWallDir(Math.round(f.x), Math.round(f.y)) || "?";
  } else {
    const names = rule.target.split("|");
    let best = null, bd = Infinity;
    items.forEach(g => {
      if (g === f || !names.includes(g.a)) return;
      const d = Math.hypot(g.x - f.x, g.y - f.y);
      if (d < bd) { bd = d; best = g; }
    });
    if (best && bd <= 4) need = dirFrom(f.x, f.y, best.x, best.y);
  }
  if (tally[need] !== undefined) tally[need]++; else tally.unknown++;
  rows.push({ rk, a: f.a, x: f.x, y: f.y, need, rule: rule.need });
});

console.log("\n朝向审计（第 4 维：摆放方向）");
console.log("─".repeat(78));
console.log("需要朝向的家具 " + rows.length + " 件 → 朝东 " + tally.E + " · 朝西 " + tally.W +
  " · 朝北 " + tally.N + " · 朝南 " + tally.S + " · 判不出 " + tally.unknown);
console.log("─".repeat(78));
const byRoom = {};
rows.forEach(r => { byRoom[r.rk || "户外"] = byRoom[r.rk || "户外"] || []; byRoom[r.rk || "户外"].push(r); });
Object.entries(byRoom).forEach(([rk, list]) => {
  console.log(rk + "（" + list.length + " 件）");
  list.slice(0, 8).forEach(r => console.log("  " + r.a.padEnd(16) + "@" + (r.x + "," + r.y).padEnd(12) + "应朝 " + r.need + "  · " + r.rule));
  if (list.length > 8) console.log("  … 另 " + (list.length - 8) + " 件");
});
console.log("─".repeat(78));
console.log("重要：当前数据层**没有任何朝向字段**（无 flip/rot/dir/face），");
console.log("     所以这 " + rows.length + " 件全部在用素材自带的那一个朝向 —— 上面只是\"应该朝哪\"的清单。\n");
