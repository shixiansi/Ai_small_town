#!/usr/bin/env node
/**
 * 台面高度标尺图（tools/host-surface.mjs）
 *
 *   node tools/host-surface.mjs dining-table round-table kitchen-counter
 *   → logs/host-surfaces.png
 *
 * 用来**量一次美术**：把可承载物品的家具放大，每 4 像素画一条水平标尺，
 * 黄字标注"距内容顶边多少像素"。肉眼读出"台面那条横线"的数值，
 * 填进 tools/asset-rules.mjs 的 SURFACE 表。
 *
 * 为什么不能自动测：试过用"最宽行"推断台面，结果 kitchen-counter 被量成 1px
 * （柜体后沿比台面更宽）。台面是**美术语义**，必须看。
 *
 * 这一步每个素材只需做一次；之后所有摆放位置都由 SURFACE 推导（见 surface-fit.mjs）。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function decodePNG(buf) {
  let p = 8, W = 0, H = 0, ct = 6, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === "IHDR") { W = data.readUInt32BE(0); H = data.readUInt32BE(4); ct = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : 3, bpp = ch, stride = W * bpp;
  const out = Buffer.alloc(W * H * 4, 0), prev = Buffer.alloc(stride, 0);
  let off = 0;
  for (let y = 0; y < H; y++) {
    const ft = raw[off++], line = Buffer.from(raw.slice(off, off + stride)); off += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      line[i] = v & 255;
    }
    line.copy(prev);
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2];
      out[o + 3] = ch === 4 ? line[x * bpp + 3] : 255;
    }
  }
  return { W, H, px: out };
}

function savePNG(file, W, H, px) {
  const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return b => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
  const chunk = (ty, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const t = Buffer.from(ty, "ascii"); const c = Buffer.alloc(4); c.writeUInt32BE(CRC(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 6;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
}

const man = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "assets", "manifest.json"), "utf8"));
const HOSTS = process.argv.slice(2);
if (!HOSTS.length) {
  console.log("用法: node tools/host-surface.mjs <素材名...>");
  console.log("例:   node tools/host-surface.mjs dining-table round-table kitchen-counter office-desk");
  process.exit(1);
}

const Z = 6, cellW = 128 * Z / 2, cellH = 128 * Z / 2, PAD = 16, LABEL = 20;
const cols = Math.min(4, HOSTS.length), rows = Math.ceil(HOSTS.length / cols);
const W = cols * (cellW + PAD) + PAD, H = rows * (cellH + PAD + LABEL) + PAD;
const px = Buffer.alloc(W * H * 4, 0);
// 背景必须不透明：Buffer.alloc 会把 alpha 也填成 0，PNG 存出来全透明，看图被白底冲掉
for (let i = 0; i < W * H; i++) { px[i * 4] = 22; px[i * 4 + 1] = 26; px[i * 4 + 2] = 34; px[i * 4 + 3] = 255; }
const set = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4, k = a / 255;
  px[i] = Math.round(px[i] * (1 - k) + r * k);
  px[i + 1] = Math.round(px[i + 1] * (1 - k) + g * k);
  px[i + 2] = Math.round(px[i + 2] * (1 - k) + b * k);
  px[i + 3] = 255;
};
const DIGIT = { "0": ["111","101","101","101","111"], "1": ["010","110","010","010","111"], "2": ["111","001","111","100","111"], "3": ["111","001","111","001","111"], "4": ["101","101","111","001","001"], "5": ["111","100","111","001","111"], "6": ["111","100","111","101","111"], "7": ["111","001","010","010","010"], "8": ["111","101","111","101","111"], "9": ["111","101","111","001","111"] };
function label(x, y, str, col) { let cx = x; for (const ch of str) { const g = DIGIT[ch]; if (g) g.forEach((row, dy) => row.split("").forEach((b, dx) => { if (b === "1") set(cx + dx, y + dy, col[0], col[1], col[2]); })); cx += 4; } }

HOSTS.forEach((name, idx) => {
  const file = path.join(ROOT, "web", "assets", name + ".png");
  if (!fs.existsSync(file)) { console.log("缺文件 " + name); return; }
  const m = man[name];
  if (!m) { console.log("manifest 里没有 " + name); return; }
  const img = decodePNG(fs.readFileSync(file));
  const fw = m.frameW, fh = m.frameH, bb = m.bbox;
  const ox = PAD + (idx % cols) * (cellW + PAD);
  const oy = PAD + Math.floor(idx / cols) * (cellH + PAD + LABEL) + LABEL;
  const sc = Math.min(cellW / fw, cellH / fh);
  for (let y = 0; y < Math.floor(fh * sc); y++) for (let x = 0; x < Math.floor(fw * sc); x++) {
    const sx = Math.floor(x / sc), sy = Math.floor(y / sc), o = (sy * img.W + sx) * 4;
    if (img.px[o + 3] > 8) set(ox + x, oy + y, img.px[o], img.px[o + 1], img.px[o + 2]);
  }
  const topY = oy + Math.floor(bb[1] * sc);
  const botY = oy + Math.floor((bb[1] + bb[3]) * sc);
  for (let x = ox + Math.floor(bb[0] * sc); x < ox + Math.floor((bb[0] + bb[2]) * sc); x += 4) { set(x, topY, 80, 160, 255); set(x, botY, 80, 160, 255); }
  for (let dy = 0; dy <= bb[3]; dy += 4) {
    const y = oy + Math.floor((bb[1] + dy) * sc);
    const major = dy % 8 === 0;
    for (let x = ox + Math.floor(bb[0] * sc); x < ox + Math.floor((bb[0] + bb[2]) * sc); x++) set(x, y, major ? 255 : 120, major ? 210 : 120, major ? 90 : 120, major ? 220 : 120);
    if (major) label(ox + Math.floor((bb[0] + bb[2]) * sc) + 3, y - 2, String(dy), [255, 210, 90]);
  }
  label(ox, oy - LABEL + 2, name.slice(0, 16), [200, 220, 255]);
  console.log("  " + name.padEnd(18) + "frame " + fw + "x" + fh + "  bbox[" + bb.join(",") + "]  内容高 " + bb[3]);
});

savePNG(path.join(ROOT, "logs", "host-surfaces.png"), W, H, px);
console.log("\n→ logs/host-surfaces.png（每格 = 4 源像素；黄字 = 距内容顶边的像素数）");
console.log("读出「桌面那条横线」的数值，填进 tools/asset-rules.mjs 的 SURFACE 表。");
