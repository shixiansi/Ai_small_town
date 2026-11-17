#!/usr/bin/env node
/**
 * 俯视示意图（tools/map-render.mjs）：把 map.json 画成一张 PNG，用来"看"地图而不是猜地图。
 *
 *   node tools/map-render.mjs                 # → logs/map-preview.png
 *   node tools/map-render.mjs out.png 28      # 自定义输出与每格像素
 *
 * 画什么（自下而上）：
 *   1 地板材质（镜像 room.js 的 baseMaterialAt，四色）
 *   2 道路 / 池塘 / 农田
 *   3 墙（黑）与门洞（黄，会留缺口的都标出来）
 *   4 房间矩形（七种描边色，对应下方图例；图例顺序也打在控制台）
 *   5 家具占地（bbox 底部投影成深灰；墙饰/叠加物画成细边不占格）
 *   6 zone 锚点（红十字）+ decorative 区域（黄圈）
 *   7 网格（每 5 格一条淡线）
 * 文字一律不画（中文没法用内置字形渲染）—— 房间/区域用颜色 + 控制台清单对照。
 *
 * 零依赖：自己写 PNG（zlib deflate + CRC32），与 tools/gen_tiles.mjs 同一条路子。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const read = f => fs.readFileSync(f, "utf8");
const map = JSON.parse(read(path.join(WEB, "map.json")));
const man = JSON.parse(read(path.join(WEB, "assets", "manifest.json")));
const furnSrc = read(path.join(WEB, "src", "furniture.js"));

const S = Number(process.argv[3] || 24);            // 每格像素
const COLS = map.room.cols, ROWS = map.room.rows, T = map.room.tile;
const W = COLS * S, H = ROWS * S + 96;              // 底部留 96px 图例
const px = Buffer.alloc(W * H * 4, 255);

function setPx(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  const al = a / 255;
  px[i] = Math.round(px[i] * (1 - al) + r * al);
  px[i + 1] = Math.round(px[i + 1] * (1 - al) + g * al);
  px[i + 2] = Math.round(px[i + 2] * (1 - al) + b * al);
  px[i + 3] = 255;
}
function rect(x0, y0, w, h, c, a = 255) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(x, y, c[0], c[1], c[2], a);
}
function frame(x0, y0, w, h, c, a = 255) {
  for (let x = x0; x < x0 + w; x++) { setPx(x, y0, ...c, a); setPx(x, y0 + h - 1, ...c, a); }
  for (let y = y0; y < y0 + h; y++) { setPx(x0, y, ...c, a); setPx(x0 + w - 1, y, ...c, a); }
}
function line(x0, y0, x1, y1, c, a = 255) {
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), n = Math.max(dx, dy) || 1;
  for (let i = 0; i <= n; i++) setPx(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c[0], c[1], c[2], a);
}
function dot(cx, cy, r, c, a = 255) {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) setPx(cx + x, cy + y, c[0], c[1], c[2], a);
}

// ---------- 1 地板材质（与 room.js 一致）----------
const FLOOR = {
  wood: [176, 138, 94], tile: [159, 176, 184], grass: [126, 168, 106], stone: [169, 164, 154]
};
/* 地板规则直接取 room.js（唯一事实源）—— 之前这里手抄了一份镜像，
 * v2.8-d 把广场改成草坪时就漂了（渲染图还是灰石板）。现在 eval 真实函数，杜绝漂移。 */
const roomSrcForMat = read(path.join(WEB, "src", "room.js"));
const _fnStart = roomSrcForMat.indexOf("function baseMaterialAt");
const _fnEnd = roomSrcForMat.indexOf("\n  }", _fnStart) + 4;
const _fnText = roomSrcForMat.slice(_fnStart, _fnEnd);
const matAt = new Function("tx", "ty", _fnText.slice(_fnText.indexOf("{") + 1, _fnText.lastIndexOf("}")));
for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
  rect(tx * S, ty * S, S, S, FLOOR[matAt(tx, ty)] || [200, 200, 200]);
}

// ---------- 2 道路 / 池塘 / 农田 ----------
(map.roads || []).forEach(r => rect(r.x * S, r.y * S, r.w * S, r.h * S, [214, 206, 188], 210));
(map.blockers || []).filter(b => b.t === "pond").forEach(b => {
  const cx = (b.x0 + b.x1) / 2 * S, cy = (b.y0 + b.y1) / 2 * S;
  const rx = (b.x1 - b.x0) / 2 * S, ry = (b.y1 - b.y0) / 2 * S;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1) setPx(x, y, 76, 143, 214, 235);
  }
});
rect(28 * S, 22 * S, 5 * S, 4 * S, [143, 191, 90], 130);   // 农田

// ---------- 3 墙与门洞 ----------
(map.walls || []).forEach(wl => {
  if (wl.x0 !== undefined) {
    for (let x = wl.x0; x <= wl.x1; x++) {
      const gap = wl.gap && x >= wl.gap[0] && x <= wl.gap[1];
      if (gap) rect(x * S + 2, wl.y * S + 2, S - 4, S - 4, [240, 190, 60]);
      else rect(x * S, wl.y * S, S, S, [40, 40, 48]);
    }
  } else {
    for (let y = wl.y; y < wl.y + wl.h; y++) {
      const gap = wl.gap && y >= wl.gap[0] && y <= wl.gap[1];
      if (gap) rect(wl.x * S + 2, y * S + 2, S - 4, S - 4, [240, 190, 60]);
      else rect(wl.x * S, y * S, S, S, [40, 40, 48]);
    }
  }
});
for (let x = 0; x < COLS; x++) rect(x * S, 0, S, S, [40, 40, 48]);   // 第 0 行墙根
// 主屋西/南外轮廓（room.js 的 paintOuterWalls：渲染层墙裙，不加碰撞）
for (let y = 1; y < ROWS; y++) rect(0, y * S, S, S, [40, 40, 48], 235);
for (let x = 0; x < 26; x++) rect(x * S, (ROWS - 1) * S, S, S, [40, 40, 48], 235);

// ---------- 4 房间矩形 ----------
const ROOM_COLORS = {
  office: [255, 99, 71], bedroom: [255, 165, 0], bath: [64, 224, 208],
  kitchen: [186, 85, 211], nbCat: [30, 144, 255], nbChief: [50, 205, 50], nbDoc: [255, 20, 147]
};
const rects = {};
Object.keys(ROOM_COLORS).forEach(k => {
  const m = new RegExp(k + ":\\s*\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]").exec(furnSrc);
  if (m) rects[k] = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
});
Object.keys(rects).forEach(k => {
  const r = rects[k];
  frame(r.x * S, r.y * S, r.w * S, r.h * S, ROOM_COLORS[k], 255);
  frame(r.x * S + 1, r.y * S + 1, r.w * S - 2, r.h * S - 2, ROOM_COLORS[k], 120);
});

// ---------- 5 家具占地 ----------
const skipped = [];
(map.furniture || []).forEach(f => {
  if (typeof f.x !== "number" || typeof f.y !== "number") return;
  const m = man[f.a];
  if (!m) return;
  const bb = m.bbox || [0, 0, m.frameW || 48, m.frameH || 48];
  const wT = Math.max(1, bb[2] / T), footH = Math.min(12, bb[3]) / T;
  const x0 = Math.round((f.x - wT / 2) * S), y0 = Math.round((f.y - footH) * S);
  if (f.o || f.wall || f.on) {                    // 装饰/贴墙/叠加：细边
    frame(x0, y0, Math.round(wT * S), Math.max(2, Math.round(footH * S)), [120, 90, 140], 170);
    skipped.push(f.id || f.a);
    return;
  }
  rect(x0, y0, Math.max(3, Math.round(wT * S)), Math.max(3, Math.round(footH * S)), [70, 70, 80], 190);
});

// ---------- 6 zone 锚点 ----------
const zoneNames = Object.keys(map.zones || {});
zoneNames.forEach(k => {
  const z = map.zones[k], a = z && z.anchor;
  if (!Array.isArray(a)) return;
  const cx = Math.round(a[0] * S), cy = Math.round(a[1] * S);
  if (z.decorative) { dot(cx, cy, 4, [240, 200, 60], 220); return; }
  line(cx - 5, cy, cx + 5, cy, [220, 30, 30], 235);
  line(cx, cy - 5, cx, cy + 5, [220, 30, 30], 235);
});

// ---------- 7 网格 ----------
for (let x = 0; x <= COLS; x += 5) line(x * S, 0, x * S, ROWS * S, [255, 255, 255], 60);
for (let y = 0; y <= ROWS; y += 5) line(0, y * S, W, y * S, [255, 255, 255], 60);

// ---------- 图例（底部色块，顺序见控制台）----------
let lx = 8, ly = ROWS * S + 14;
rect(0, ROWS * S, W, 96, [24, 26, 34], 255);
Object.keys(ROOM_COLORS).forEach(k => {
  rect(lx, ly, 16, 16, ROOM_COLORS[k]); lx += 22;
  rect(lx, ly + 3, 34, 10, [90, 90, 100], 255); lx += 44;   // 名称占位（不画字）
});
const legend2 = [
  { c: [40, 40, 48], t: "墙" }, { c: [240, 190, 60], t: "门洞" }, { c: [214, 206, 188], t: "道路" },
  { c: [76, 143, 214], t: "池塘" }, { c: [143, 191, 90], t: "农田" }, { c: [70, 70, 80], t: "家具占地" },
  { c: [120, 90, 140], t: "墙饰/叠加" }, { c: [220, 30, 30], t: "zone 锚点" }, { c: [240, 200, 60], t: "装饰区" }
];
lx = 8; ly += 30;
legend2.forEach(it => { rect(lx, ly, 14, 14, it.c); lx += 20; rect(lx, ly + 3, 50, 9, [90, 90, 100], 255); lx += 56; });

// ---------- 写 PNG ----------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return b => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);
const out = path.resolve(ROOT, process.argv[2] || path.join("logs", "map-preview.png"));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);

// ---------- 控制台图例 ----------
console.log("\n地图示意图 → " + out + "  (" + W + "×" + H + "px · 每格 " + S + "px)");
console.log("─".repeat(64));
console.log("房间描边色（自上而下顺序）：");
Object.keys(ROOM_COLORS).forEach((k, i) => {
  const r = rects[k];
  console.log("  " + (i + 1) + ". " + k.padEnd(8) + "  矩形 [" + [r.x, r.y, r.w, r.h].join(",") + "]");
});
console.log("其他图例：" + legend2.map(l => l.t).join(" / "));
console.log("家具 " + (map.furniture || []).length + " 件（其中墙饰/叠加 " + skipped.length + " 件只画细边）· zone " + zoneNames.length + " 个");
console.log("─".repeat(64) + "\n");
