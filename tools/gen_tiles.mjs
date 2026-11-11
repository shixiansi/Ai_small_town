#!/usr/bin/env node
/**
 * 生成地图贴图（v39）：地板 / 墙 / 道路 / 水面 / 农田 / 天空 / 窗
 *   node office/tools/gen_tiles.mjs
 *
 * 为什么用脚本生成 PNG 而不是运行时用 Graphics 画：
 *   地图底图（地板、墙、水、路）以前是 buildRoom() 里几百行 fillRect 画的，
 *   一是没法当素材管理、二是每改一点配色就得动代码。现在全部落成 48×48 的 PNG 贴图，
 *   运行时只做 `renderTexture.draw(key, x, y)`，图改了直接换文件。
 * 依赖：只用 node 内置 zlib（自己写 PNG 编码），不引第三方包。
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "web", "assets", "tiles");
const S = 48;   // 一格 48px

/* ---------- 最小 PNG 编码器（RGBA / filter 0） ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- 画布小工具 ---------- */
function canvas() {
  const buf = Buffer.alloc(S * S * 4);
  const api = {
    buf,
    px(x, y, hex, a = 255) {
      if (x < 0 || y < 0 || x >= S || y >= S) return;
      const i = (y * S + x) * 4;
      buf[i] = (hex >> 16) & 255; buf[i + 1] = (hex >> 8) & 255; buf[i + 2] = hex & 255; buf[i + 3] = a;
    },
    rect(x, y, w, h, hex, a) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) api.px(x + i, y + j, hex, a); },
    hline(x, y, w, hex, a) { api.rect(x, y, w, 1, hex, a); },
    vline(x, y, h, hex, a) { api.rect(x, y, 1, h, hex, a); },
    noise(hex, ratio, rnd) { for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) if (rnd() < ratio) api.px(i, j, hex); },
    save(name) { fs.writeFileSync(path.join(OUT, name + ".png"), encodePNG(S, S, buf)); console.log("  " + name + ".png"); }
  };
  return api;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* 48×48 壁灯：墙座 + 支架 + 灯罩；亮起时灯罩暖黄 + 外圈光晕 */
function drawLamp(c, on) {
  c.rect(21, 8, 6, 5, 0x2f3547);              // 墙座
  c.rect(22, 9, 4, 3, 0x3c4358);
  c.rect(23, 13, 2, 4, 0x4a5266);             // 支架
  c.rect(18, 17, 12, 3, 0x6b7385);            // 灯罩顶
  if (on) {
    c.rect(17, 20, 14, 8, 0xffe9b0);          // 灯罩亮
    c.rect(18, 20, 12, 2, 0xfff6d8);
    c.rect(15, 28, 18, 2, 0xffd27a, 150);     // 下方光晕
    c.rect(13, 30, 22, 3, 0xffd27a, 90);
    c.rect(11, 33, 26, 4, 0xffd27a, 45);
    c.px(24, 21, 0xffffff); c.px(23, 22, 0xffffff);
  } else {
    c.rect(17, 20, 14, 8, 0x3a4152);          // 灯罩灭
    c.rect(18, 20, 12, 2, 0x4a5266);
    c.rect(15, 28, 18, 2, 0x2a2f3d, 120);     // 淡淡的底座投影
  }
}

/* 48×48 的墙挂开关：面板 + 拨杆；开启时拨杆朝上并亮一颗绿灯 */
function drawSwitch(c, on) {
  c.rect(13, 12, 22, 26, 0x2f3547);          // 面板底
  c.rect(14, 13, 20, 24, 0x3c4358);          // 面板面
  c.rect(13, 12, 22, 1, 0x8b93a7);           // 顶部高光
  c.rect(13, 37, 22, 1, 0x1b1f2b);           // 底部阴影
  c.rect(16, 16, 16, 12, 0x2a2f3d);          // 开关凹槽
  if (on) {
    c.rect(20, 17, 8, 5, 0x8ce99a);          // 拨杆朝上 = 开
    c.rect(20, 17, 8, 1, 0xc9f7d0);
    c.px(23, 30, 0x51cf66); c.px(24, 30, 0x51cf66);   // 指示灯
    c.px(23, 31, 0x8ce99a); c.px(24, 31, 0x8ce99a);
  } else {
    c.rect(20, 22, 8, 5, 0x6b7385);          // 拨杆朝下 = 关
    c.rect(20, 22, 8, 1, 0x8b93a7);
    c.px(23, 30, 0x3a4152); c.px(24, 30, 0x3a4152);
  }
  c.rect(20, 33, 8, 1, 0x2a2f3d);            // 螺丝槽
}

const TILES = {
  /* v50：墙上的灯开关（assets 里当"物品"摆，可拖动/可单独控制某个房间的灯） */
  "switch-off"(c) { drawSwitch(c, false); },
  "switch-on"(c) { drawSwitch(c, true); },
  /* v52：墙上壁灯（灭 / 亮）—— 又一个"会变化"的素材 */
  "lamp-off"(c) { drawLamp(c, false); },
  "lamp-on"(c) { drawLamp(c, true); },
  wood(c) {
    const r = rng(11);
    c.rect(0, 0, S, S, 0x9c7750);
    for (let plank = 0; plank < 4; plank++) {           // 四条横板
      const y = plank * 12;
      c.rect(0, y, S, 11, plank % 2 ? 0x98734c : 0x9c7750);
      c.hline(0, y + 11, S, 0x6f5233);                   // 板缝
      c.hline(0, y, S, 0xa9855c);                        // 高光
      for (let i = 0; i < 3; i++) c.hline(4 + Math.floor(r() * 36), y + 3 + Math.floor(r() * 6), 6 + Math.floor(r() * 8), 0x8a6742);
    }
  },
  tile(c) {
    c.rect(0, 0, S, S, 0x8e9ca6);
    c.rect(1, 1, 22, 22, 0x93a1ab); c.rect(25, 1, 22, 22, 0x8b99a4);
    c.rect(1, 25, 22, 22, 0x8b99a4); c.rect(25, 25, 22, 22, 0x93a1ab);
    c.rect(23, 0, 2, S, 0x6f7d88); c.rect(0, 23, S, 2, 0x6f7d88);   // 砖缝
    c.hline(2, 2, 20, 0xa9b6be); c.hline(26, 2, 20, 0xa4b1b9);
    c.hline(2, 26, 20, 0xa4b1b9);
  },
  stone(c) {
    const r = rng(23);
    c.rect(0, 0, S, S, 0x7c7e8c);
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(r() * 40), y = Math.floor(r() * 40);
      c.rect(x, y, 6 + Math.floor(r() * 6), 5 + Math.floor(r() * 5), r() < 0.5 ? 0x83858f : 0x757783);
    }
    c.rect(0, 0, S, 1, 0x8f919c); c.rect(0, S - 1, S, 1, 0x6a6c78);
    c.rect(0, 0, 1, S, 0x8f919c); c.rect(S - 1, 0, 1, S, 0x6a6c78);
  },
  grass(c) {
    const r = rng(37);
    c.rect(0, 0, S, S, 0x6e9453);
    for (let i = 0; i < 70; i++) {
      const x = Math.floor(r() * S), y = Math.floor(r() * S);
      c.px(x, y, r() < 0.5 ? 0x7ba35c : 0x63854a);
      if (r() < 0.35) c.px(x, y - 1, 0x86ae67);
    }
    for (let i = 0; i < 6; i++) {
      const x = 4 + Math.floor(r() * 40), y = 6 + Math.floor(r() * 36);
      c.vline(x, y, 3, 0x5d7d45); c.px(x - 1, y + 1, 0x5d7d45); c.px(x + 1, y + 1, 0x5d7d45);
    }
  },
  road(c) {
    const r = rng(53);
    c.rect(0, 0, S, S, 0xb3a184);
    for (let i = 0; i < 40; i++) {
      const x = Math.floor(r() * 44), y = Math.floor(r() * 44);
      c.rect(x, y, 4 + Math.floor(r() * 5), 4 + Math.floor(r() * 4), r() < 0.5 ? 0xbcab8e : 0xa8977c);
    }
    c.rect(0, 0, S, 1, 0xc2b195); c.rect(0, S - 1, S, 1, 0xa08f76);
  },
  wall(c) {
    c.rect(0, 0, S, S, 0x3b4459);
    c.rect(0, 0, S, 4, 0x8492ac);                     // 顶线亮
    c.rect(0, S - 4, S, 4, 0x22283a);                 // 脚线暗
    for (let row = 0; row < 4; row++) {               // 砖缝
      const y = 6 + row * 11;
      c.hline(0, y, S, 0x333c50);
      const off = row % 2 ? 0 : 12;
      for (let x = off; x < S; x += 24) c.vline(x, y, 11, 0x333c50);
    }
  },
  window(c) {
    const r = rng(71);
    c.rect(0, 0, S, S, 0x3b4459);
    c.rect(0, 0, S, 4, 0x8492ac);
    c.rect(0, S - 4, S, 4, 0x22283a);
    c.rect(6, 8, S - 12, 32, 0x8fc3e8);               // 玻璃
    c.rect(6, 8, S - 12, 3, 0xb9dcf2);
    c.rect(6, 37, S - 12, 3, 0x6ea3c8);
    for (let i = 0; i < 10; i++) c.rect(8 + Math.floor(r() * 26), 12 + Math.floor(r() * 22), 2, 2, 0xdfefff);
    c.rect(23, 8, 2, 32, 0x5c6a80); c.rect(6, 23, S - 12, 2, 0x5c6a80);   // 窗棂
    c.rect(5, 7, S - 10, 1, 0x4a5670); c.rect(5, 40, S - 10, 1, 0x4a5670);
  },
  "window-night"(c) {
    const r = rng(71);
    c.rect(0, 0, S, S, 0x3b4459);
    c.rect(0, 0, S, 4, 0x8492ac);
    c.rect(0, S - 4, S, 4, 0x22283a);
    c.rect(6, 8, S - 12, 32, 0x1d2a44);               // 夜色玻璃
    c.rect(6, 8, S - 12, 3, 0x2b3e60);
    for (let i = 0; i < 9; i++) c.px(9 + Math.floor(r() * 28), 12 + Math.floor(r() * 24), 0xdfe9ff, 220);
    c.rect(23, 8, 2, 32, 0x4a5670); c.rect(6, 23, S - 12, 2, 0x4a5670);
    c.rect(5, 7, S - 10, 1, 0x3c4a64); c.rect(5, 40, S - 10, 1, 0x3c4a64);
  },
  sky(c) {
    c.rect(0, 0, S, S, 0x1d2438);
    for (let y = 0; y < S; y++) {                      // 竖向渐变
      const t = y / S;
      const col = [Math.round(0x1d + t * 0x12), Math.round(0x24 + t * 0x14), Math.round(0x38 + t * 0x16)];
      c.rect(0, y, S, 1, (col[0] << 16) | (col[1] << 8) | col[2]);
    }
    const r = rng(97);
    for (let i = 0; i < 12; i++) c.px(Math.floor(r() * S), Math.floor(r() * S * 0.7), 0xdfe9ff, 180);
  },
  water(c) {
    c.rect(0, 0, S, S, 0x2f6f9e);
    for (let y = 0; y < S; y += 8) {
      c.rect(0, y, S, 4, 0x357aa9);
      for (let x = (y % 16 ? 6 : 0); x < S; x += 18) c.rect(x, y + 1, 8, 2, 0x58a0cc);
    }
    c.rect(0, 0, S, 2, 0x3d86bb);
  },
  bank(c) {
    const r = rng(113);
    c.rect(0, 0, S, S, 0xc9b184);
    for (let i = 0; i < 46; i++) c.rect(Math.floor(r() * 44), Math.floor(r() * 44), 3 + Math.floor(r() * 4), 3 + Math.floor(r() * 3), r() < 0.5 ? 0xd2bb8f : 0xbfa77a);
    c.rect(0, 0, S, 1, 0xd8c298);
  },
  farm(c) {
    c.rect(0, 0, S, S, 0x7a5334);
    for (let i = 0; i < 4; i++) {
      const y = 5 + i * 11;
      c.rect(2, y, S - 4, 5, 0x6b4629);                // 垄沟
      c.rect(2, y - 2, S - 4, 2, 0x8a5f3c);            // 垄背
    }
    c.rect(0, 0, S, 1, 0x5a3a22); c.rect(0, S - 1, S, 1, 0x5a3a22);
    c.rect(0, 0, 1, S, 0x5a3a22); c.rect(S - 1, 0, 1, S, 0x5a3a22);
  }
};

fs.mkdirSync(OUT, { recursive: true });
console.log("生成地图贴图 → web/assets/tiles/");
for (const [name, draw] of Object.entries(TILES)) {
  const c = canvas();
  draw(c);
  c.save(name);
}
console.log(`完成：${Object.keys(TILES).length} 张 ${S}×${S} PNG`);
