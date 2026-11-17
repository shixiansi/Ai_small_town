#!/usr/bin/env node
/**
 * 分层验收图（tools/map-annotate.mjs）—— 第 1 层地板 + 第 2 层素材
 *
 *   node tools/map-annotate.mjs                 # → logs/map-annotate.png + 控制台图例
 *   node tools/map-annotate.mjs --only=bath     # 只看某间房
 *   node tools/map-annotate.mjs --scale=28
 *
 * 画什么（按用户给的分层验收协议）：
 *   第 1 层 地板：材质四色 + 道路（浅色带十字纹）+ 墙（黑）+ 门洞（黄）+ 房间矩形描边
 *   第 2 层 素材：每件家具画成"方块 + 编号"，碰撞体积（bbox 底部投影）用红框标出；
 *                两件家具的碰撞格相交时把两者都标成洋红 —— on: 叠加关系除外
 *   编号与名字的对应打在控制台（图里只画数字，避免中文渲染问题）
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadModel } from "./map-model.mjs";   // v2.8-h：重叠统计与门禁同源

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const read = f => fs.readFileSync(f, "utf8");
const map = JSON.parse(read(path.join(WEB, "map.json")));
const man = JSON.parse(read(path.join(WEB, "assets", "manifest.json")));
const furnSrc = read(path.join(WEB, "src", "furniture.js"));
const roomSrc = read(path.join(WEB, "src", "room.js"));

const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("=");
  return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const S = Number(arg.scale || 26);
const T = map.room.tile, COLS = map.room.cols, ROWS = map.room.rows;

// ---------- 房间矩形 ----------
const ROOM_COLORS = { office: [255, 99, 71], bedroom: [255, 165, 0], bath: [64, 224, 208], kitchen: [186, 85, 211], nbCat: [30, 144, 255], nbChief: [50, 205, 50], nbDoc: [255, 20, 147] };
const rects = {};
Object.keys(ROOM_COLORS).forEach(k => {
  const m = new RegExp(k + ":\\s*\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]").exec(furnSrc);
  if (m) rects[k] = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
});
const only = arg.only ? String(arg.only) : null;
const view = only && rects[only] ? rects[only] : { x: 0, y: 0, w: COLS, h: ROWS };
const W = view.w * S, H = view.h * S + 40;
const px = Buffer.alloc(W * H * 4, 255);
const set = (x, y, c, a = 255) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4, k = a / 255;
  px[i] = Math.round(px[i] * (1 - k) + c[0] * k); px[i + 1] = Math.round(px[i + 1] * (1 - k) + c[1] * k); px[i + 2] = Math.round(px[i + 2] * (1 - k) + c[2] * k);
};
const rect = (x0, y0, w, h, c, a = 255) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c, a); };
const frame = (x0, y0, w, h, c, a = 255) => { for (let x = x0; x < x0 + w; x++) { set(x, y0, c, a); set(x, y0 + h - 1, c, a); } for (let y = y0; y < y0 + h; y++) { set(x0, y, c, a); set(x0 + w - 1, y, c, a); } };
const X = tx => Math.round((tx - view.x) * S), Y = ty => Math.round((ty - view.y) * S);

// ---------- 第 1 层：地板（直接 eval room.js 的规则，避免镜像漂移）----------
const fnStart = roomSrc.indexOf("function baseMaterialAt");
const fnEnd = roomSrc.indexOf("\n  }", fnStart) + 4;
const fnText = roomSrc.slice(fnStart, fnEnd);
const baseMat = new Function("tx", "ty", fnText.slice(fnText.indexOf("{") + 1, fnText.lastIndexOf("}")));
const customFloor = new Map(), customTerrain = new Map();
let customFurn = [];
try {
  const cj = JSON.parse(read(path.join(ROOT, "hub", "map.custom.json")));
  (cj.furniture || []).forEach(f => {
    if (typeof f.x !== "number" || typeof f.y !== "number") return;
    if (f.a === "floor") customFloor.set(f.x + "," + f.y, f.t);
    else if (f.a === "terrain") customTerrain.set(f.x + "," + f.y, f.t);
    else if (man[f.a]) customFurn.push(f);
  });
} catch {}
const material = (tx, ty) => customFloor.get(tx + "," + ty) || customTerrain.get(tx + "," + ty) || baseMat(tx, ty);
const FLOOR = { wood: [176, 138, 94], tile: [159, 176, 184], grass: [126, 168, 106], stone: [169, 164, 154], road: [214, 206, 188], wall: [52, 56, 70], water: [76, 143, 214], farm: [120, 96, 60] };
for (let ty = view.y; ty < view.y + view.h; ty++) for (let tx = view.x; tx < view.x + view.w; tx++) {
  const mat = material(tx, ty);
  rect(X(tx), Y(ty), S, S, FLOOR[mat] || [200, 200, 200]);
}
// 道路（第 1 层要审核通路）
(map.roads || []).forEach(r => {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (x < view.x || y < view.y || x >= view.x + view.w || y >= view.y + view.h) continue;
    rect(X(x) + 1, Y(y) + 1, S - 2, S - 2, FLOOR.road, 200);
  }
});
// 墙 + 门洞（第 1 层要审核墙的范围）
(map.walls || []).forEach(wl => {
  const put = (x, y, gap) => {
    if (x < view.x || y < view.y || x >= view.x + view.w || y >= view.y + view.h) return;
    if (gap) frame(X(x) + 1, Y(y) + 1, S - 2, S - 2, [240, 190, 60], 255);
    else rect(X(x), Y(y), S, S, FLOOR.wall);
  };
  if (wl.x0 !== undefined) for (let x = wl.x0; x <= wl.x1; x++) put(x, wl.y, wl.gap && x >= wl.gap[0] && x <= wl.gap[1]);
  else for (let y = wl.y; y < wl.y + wl.h; y++) put(wl.x, y, wl.gap && y >= wl.gap[0] && y <= wl.gap[1]);
});
customTerrain.forEach((t, k) => { const p = k.split(",").map(Number); if (FLOOR[t]) rect(X(p[0]), Y(p[1]), S, S, FLOOR[t], 220); });
for (let x = view.x; x < view.x + view.w; x++) rect(X(x), Y(0), S, S, FLOOR.wall);
Object.keys(rects).forEach(k => {
  const r = rects[k];
  frame(X(r.x), Y(r.y), r.w * S, r.h * S, ROOM_COLORS[k], 255);
  frame(X(r.x) + 1, Y(r.y) + 1, r.w * S - 2, r.h * S - 2, ROOM_COLORS[k], 110);
});

// ---------- 第 2 层：素材（方块 + 编号）与碰撞体积 ----------
const items = (map.furniture || []).concat(customFurn).filter(f => typeof f.x === "number" && typeof f.y === "number" && man[f.a] && f.a !== "move");
const LEGEND = [];
const cellsOf = f => {
  const m = man[f.a], bb = m.bbox || [0, 0, 48, 48];
  const wT = Math.max(1, bb[2] / T), fh = Math.min(12, bb[3]) / T;
  const ty = Math.floor(f.y - fh + 0.001), xs = [];
  for (let i = 0; i < wT; i++) xs.push(Math.floor(f.x - wT / 2 + i));
  return { xs, ty, wT, fh };
};
const occupancy = new Map();     // "x,y" -> [index...]
items.forEach((f, i) => {
  const solid = !(f.o || f.wall || f.on);      // on: 叠加物不占碰撞
  LEGEND.push(i + 1, f);
  // 方块：占位框（含叠加物，画成细边）
  const c = cellsOf(f);
  if (solid) c.xs.forEach(x => { const k = x + "," + c.ty; if (!occupancy.has(k)) occupancy.set(k, []); occupancy.get(k).push(i + 1); });
  if (f.x < view.x - 1 || f.y < view.y - 1 || f.x > view.x + view.w + 1 || f.y > view.y + view.h + 1) return;
  const x0 = X(Math.min(...c.xs)), y0 = Y(c.ty), w0 = Math.max(3, Math.round(c.xs.length * S)), h0 = Math.max(4, Math.round(S * 0.6));
  if (solid) {
    frame(x0, y0, w0, h0, [220, 40, 40], 255);
    rect(x0, y0, w0, h0, [220, 40, 40], 40);
  } else {
    frame(x0, y0, w0, Math.max(3, Math.round(S * 0.35)), [120, 90, 160], 220);
  }
  // 编号（左下角，3×5 点阵）
  const n = String(i + 1);
  let cx = x0 + 1, cy = y0 + Math.max(2, h0 - 7);
  for (const ch of n) { drawDigit(cx, cy, ch, [255, 255, 255]); cx += 4; }
});
// 重叠检测：改用 tools/map-model.mjs 的唯一实现（与 check/审计/修复脚本同一个判定），
// 并且只统计"当前视图范围内"的家具 —— 之前这里是自己一份旧实现 + 全局统计，
// 结果每间房都报"147 对"，与统一模型的 0 件自相矛盾。
const um = loadModel();
const inView = f => f.x >= view.x - 1 && f.x <= view.x + view.w + 1 && f.y >= view.y - 1 && f.y <= view.y + view.h + 1;
const pairList = um.items
  .filter(f => um.solid(f) && inView(f))
  .flatMap(f => um.conflictsOf(f).map(g => (f.id || f.a) + " × " + (g.id || g.a)))
  .filter((v, i, a) => a.indexOf(v) === i);
// 3×5 点阵数字
function drawDigit(x0, y0, ch, col) {
  const G = {
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"]
  }[ch];
  if (!G) return;
  G.forEach((row, dy) => row.split("").forEach((bit, dx) => { if (bit === "1") set(x0 + dx, y0 + dy, col, 255); }));
}

// ---------- 写 PNG ----------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return b => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
const out = path.resolve(ROOT, arg.out || path.join("logs", "map-annotate" + (only ? "-" + only : "") + ".png"));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);

// ---------- 控制台：图例 + 重叠告警 ----------
console.log("\n分层验收图 → " + out + "（第 1 层地板/道路/墙 + 第 2 层素材方块与碰撞）");
console.log("─".repeat(72));
console.log("素材图例（编号 → 素材 @坐标 · 类型）：");
let line = "";
items.forEach((f, i) => {
  const tag = f.on ? "叠加" : (f.o || f.wall) ? "装饰" : "落地";
  line += String(i + 1).padStart(3) + " " + (f.id || f.a).padEnd(16) + f.a.padEnd(16) + ("@" + f.x + "," + f.y).padEnd(12) + tag + "   ";
  if ((i + 1) % 2 === 0) { console.log("  " + line.trimEnd()); line = ""; }
});
if (line.trim()) console.log("  " + line.trimEnd());
console.log("─".repeat(72));
if (pairList.length) {
  console.log("⚠ 碰撞重叠 " + pairList.length + " 对（洋红未画，先看清单）：");
  pairList.slice(0, 20).forEach(p => console.log("  " + p));
} else console.log("✓ 没有碰撞重叠（on: 叠加关系已排除）");
console.log("落地家具 " + items.filter(f => !(f.o || f.wall || f.on)).length + " 件 · 装饰/叠加 " + items.filter(f => f.o || f.wall || f.on).length + " 件\n");
