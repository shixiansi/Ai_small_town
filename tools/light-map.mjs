#!/usr/bin/env node
/**
 * 第 3 层光照验收（tools/light-map.mjs）
 *   node tools/light-map.mjs                     → logs/light-map.png + 每地块统计
 *   node tools/light-map.mjs --time=night        → 夜间 ambient（更深、对比更强）
 *   node tools/light-map.mjs --room=office       → 只看一间
 *
 * 依据 placement.js 里的 poolDefs（每个灯池：x, y, r 半径, a 强度, tint 色温, room 归属）：
 *   - 画布底色 = 该时间段的环境光（day 0.62 / dusk 0.42 / night 0.20）
 *   - 每个灯池按 1-(d/r)² 衰减叠加，色温用 tint 的 RGB
 *   - 房间矩形描边；每间房统计：灯池数、覆盖面积占比、平均亮度（用于判断"这块该亮的地方够不够亮"）
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("="); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const TIME = String(arg.time || "day");
const AMB = { day: 0.62, dusk: 0.42, night: 0.20 }[TIME];
if (AMB === undefined) { console.error("--time 只支持 day|dusk|night"); process.exit(1); }

const map = JSON.parse(fs.readFileSync(path.join(WEB, "map.json"), "utf8"));
const src = fs.readFileSync(path.join(WEB, "src", "placement.js"), "utf8");
const P = map.room.tile, COLS = map.room.cols, ROWS = map.room.rows;
const furnSrc = fs.readFileSync(path.join(WEB, "src", "furniture.js"), "utf8");
/* 房间名单从 furniture.js 现解析，别再写死 —— map-model 之前就是这份硬编码漏了
 * parkCourt/brickHall 的教训（加房间只改渲染层、工具还按旧名单跑，于是新房间"没有灯池"）。
 * 这里同样的 bug 又出现一次：placement.js 里有 4 盏新灯，本工具只认得 7 间房，把它们全丢了。 */
const ROOM_KEYS = (() => {
  const keys = [], re = /^\s*([A-Za-z]\w*)\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/gm;
  let m; while ((m = re.exec(furnSrc))) if (!keys.includes(m[1])) keys.push(m[1]);
  return keys.length ? keys : ["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"];
})();
const rooms = {};
ROOM_KEYS.forEach(k => {
  const m = new RegExp("\\b" + k + ":\\s*\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]").exec(furnSrc);
  if (m) rooms[k] = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
});

// 解析 poolDefs
const pools = [];
const re = /\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*r:\s*([\d.]+),\s*a:\s*([\d.]+),\s*tint:\s*(0x[0-9a-fA-F]+),\s*room:\s*"(\w+)"/g;
let m;
while ((m = re.exec(src))) pools.push({ x: +m[1], y: +m[2], r: +m[3], a: +m[4], tint: parseInt(m[5], 16), room: m[6] });
if (!pools.length) { console.error("没解析到 poolDefs"); process.exit(1); }

// 采样网格：每格 4×4 采样
const SUB = 4, S = Number(arg.scale || 18);
const W = COLS * S, H = ROWS * S;
const light = new Float32Array(COLS * SUB * ROWS * SUB);      // 采样点亮度
const SW = COLS * SUB;
for (let sy = 0; sy < ROWS * SUB; sy++) {
  for (let sx = 0; sx < SW; sx++) {
    const wx = (sx + 0.5) / SUB, wy = (sy + 0.5) / SUB;
    let v = AMB;
    for (const p of pools) {
      const d = Math.hypot(wx - p.x, wy - p.y) / p.r;
      if (d < 1) v += p.a * (1 - d * d);
    }
    light[sy * SW + sx] = Math.min(1, v);
  }
}
// 每间房的统计
const stats = {};
ROOM_KEYS.forEach(k => {
  const r = rooms[k]; if (!r) return;
  let sum = 0, n = 0, minV = 1, maxV = 0, lit = 0;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    for (let dy = 0; dy < SUB; dy++) for (let dx = 0; dx < SUB; dx++) {
      const v = light[((y * SUB + dy) * SW) + (x * SUB + dx)];
      if (v === undefined) continue;
      sum += v; n++; if (v < minV) minV = v; if (v > maxV) maxV = v;
      if (v > AMB + 0.05) lit++;
    }
  }
  // 平均亮度在"房间大、灯池小"时天然接近 ambient，判别力差；补一个"被照亮面积占比"
  stats[k] = { avg: n ? sum / n : 0, min: minV, max: maxV, cover: n ? lit / n : 0, pools: pools.filter(p => p.room === k).length };
});

// 画图
const px = Buffer.alloc(W * H * 4, 255);
const set = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; };
for (let py = 0; py < H; py++) {
  for (let pxx = 0; pxx < W; pxx++) {
    const wx = pxx / S, wy = py / S;
    // 取 4×4 采样平均
    let v = 0, n = 0;
    const sx0 = Math.floor(wx * SUB), sy0 = Math.floor(wy * SUB);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const s = light[(sy0 + dy) * SW + (sx0 + dx)];
      if (s !== undefined) { v += s; n++; }
    }
    v = n ? v / n : AMB;
    // 光照上色：暗处偏蓝，亮处偏暖黄
    const warm = Math.min(1, v * 1.25);
    const r = Math.round(20 + warm * 235);
    const g = Math.round(28 + warm * 210);
    const b = Math.round(48 + warm * 150);
    set(pxx, py, r, g, b);
  }
}
// 房间描边 + 灯池标记
ROOM_KEYS.forEach(k => {
  const r = rooms[k]; if (!r) return;
  const x0 = r.x * S, y0 = r.y * S, w0 = r.w * S, h0 = r.h * S;
  /* 旧版把 4 条边各画几条线就完事，但用的是 `for (x = x0; x < x0+w0)`（**不含右边界**）
   * 和 `set(x0+w0-1, ...)`（**含**），两种口径混用；再叠上 S 不是整数时的取整，
   * 新房间（parkCourt/brickHall 紧贴地图右缘）的描边就缺一段，看图会误判成"房间没画完"。
   * 现在统一按"左闭右闭"描：x 取 [x0, x0+w0]，y 取 [y0, y0+h0]。 */
  const xa = Math.round(x0), xb = Math.round(x0 + w0);
  const ya = Math.round(y0), yb = Math.round(y0 + h0);
  for (let x = xa; x <= xb; x++) { set(x, ya, 255, 255, 255); set(x, yb, 255, 255, 255); }
  for (let y = ya; y <= yb; y++) { set(xa, y, 255, 255, 255); set(xb, y, 255, 255, 255); }
});
pools.forEach(p => {
  const cx = Math.round(p.x * S), cy = Math.round(p.y * S), rr = Math.max(2, Math.round(p.r * S));
  for (let a = 0; a < 360; a += 6) {
    const rad = a * Math.PI / 180;
    set(Math.round(cx + Math.cos(rad) * rr), Math.round(cy + Math.sin(rad) * rr), 255, 80, 80);
    set(Math.round(cx + Math.cos(rad) * 2), Math.round(cy + Math.sin(rad) * 2), 255, 255, 255);
  }
});

// PNG
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return b => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const out = path.resolve(ROOT, "logs", "light-map-" + TIME + ".png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));

console.log("\n第 3 层光照验收 → " + out + "（time=" + TIME + " · ambient=" + AMB + "）");
console.log("─".repeat(70));
console.log("灯池 " + pools.length + " 个：");
pools.forEach(p => console.log("  " + p.room.padEnd(9) + "(" + p.x + "," + p.y + ") r=" + p.r + " a=" + p.a + " tint=#" + p.tint.toString(16).padStart(6, "0")));
console.log("─".repeat(70));
console.log("每地块（平均 / 最暗 / 最亮 · 灯池数）：");
ROOM_KEYS.forEach(k => {
  const s = stats[k]; if (!s) return;
  const flag = s.pools === 0 ? "  ⚠ 无灯池" : (s.cover < 0.05 ? "  ⚠ 照亮面积 <5%" : (s.cover < 0.15 ? "  · 照亮面积偏小" : "  ✓"));
  console.log("  " + k.padEnd(9) + "均" + s.avg.toFixed(3) + " 最亮" + s.max.toFixed(3) + " 照亮" + (s.cover * 100).toFixed(0) + "% · 灯池 " + s.pools + flag);
});
console.log("─".repeat(70) + "\n");
