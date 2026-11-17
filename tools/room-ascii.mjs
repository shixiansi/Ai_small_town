#!/usr/bin/env node
/**
 * 房间 ASCII 坐标图（tools/room-ascii.mjs）—— 改坐标时用的"带标尺的图纸"
 *
 * 截图看"好不好看"，本工具看"到底在第几格"。两者都要：截图看不出 0.5 格的差，
 * 而 0.5 格正是这个项目反复翻车的地方（§8 坑 2）。
 *
 *   node tools/room-ascii.mjs --room=office
 *   node tools/room-ascii.mjs --room=kitchen --pad=1
 *   node tools/room-ascii.mjs --room=bath --all        # 连装饰/挂墙件也画
 *
 * 图例：
 *   #  墙（map-model.wallCells：墙带/隔墙/地形墙/外墙裙）
 *   ~  水（地形）        ·  道路
 *   .  空地板            空格 = 房间外
 *   A-Z 落地家具占格（小写 = 第二圈起的同字母轮换，避免超过 26 件对不上）
 *   *  锚点格（zones[*].anchor）
 *   +  自定义层地板改写过的格
 */
import { loadModel } from "./map-model.mjs";

const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("="); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const model = loadModel();
const { items, solid, cellsOf, rooms, roomOf, wallCells, anchors, map, COLS, ROWS, customFloor, customTerrain, roadCells } = model;

/* 62 个不重样标签：大写 → 小写 → 数字。32 件以上的房间（office 41 件）用 A-Z 会撞标，
 * 撞了就看不出"图上的 A 到底是哪一件"，图纸就废了。 */
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const targets = arg.room ? [String(arg.room)] : Object.keys(rooms);
const pad = arg.pad === undefined ? 1 : Number(arg.pad);
const showAll = !!arg.all;

for (const rk of targets) {
  const r = rooms[rk];
  if (!r) { console.log("没有这个房间：" + rk); continue; }
  const x0 = Math.max(0, r.x - pad), x1 = Math.min(COLS - 1, r.x + r.w + pad - 1);
  const y0 = Math.max(0, r.y - pad), y1 = Math.min(ROWS - 1, r.y + r.h + pad - 1);

  const inR = items.filter(f => roomOf(f.x, f.y) === rk && (showAll || solid(f)));
  const letter = new Map();
  inR.forEach((f, i) => letter.set(f, LETTERS[i % LETTERS.length]));

  const glyph = new Map();   // "x,y" → 字符
  const owner = new Map();   // "x,y" → 家具
  inR.forEach(f => cellsOf(f).forEach(k => {
    if (!glyph.has(k) || !solid(f)) { glyph.set(k, letter.get(f)); owner.set(k, f); }
  }));

  const anchorCells = new Set();
  Object.keys(anchors).forEach(k => anchorCells.add(anchors[k].x + "," + anchors[k].y));

  console.log("\n" + rk + "  x=" + r.x + ".." + (r.x + r.w - 1) + "  y=" + r.y + ".." + (r.y + r.h - 1) +
              "  （" + r.w + "×" + r.h + "）  " + inR.length + " 件");
  const tens = "     " + Array.from({ length: x1 - x0 + 1 }, (_, i) => {
    const x = x0 + i; return x % 10 === 0 ? String(Math.floor(x / 10) % 10) : " ";
  }).join("");
  const ones = "     " + Array.from({ length: x1 - x0 + 1 }, (_, i) => String((x0 + i) % 10)).join("");
  console.log(tens);
  console.log(ones);
  for (let y = y0; y <= y1; y++) {
    let line = String(y).padStart(3) + "  ";
    for (let x = x0; x <= x1; x++) {
      const k = x + "," + y;
      if (x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h) line += " ";
      else if (wallCells.has(k)) line += "#";
      else if (customTerrain.has(k) && customTerrain.get(k) === "water") line += "~";
      else if (glyph.has(k)) line += glyph.get(k);
      else if (anchorCells.has(k)) line += "*";
      else if (roadCells.has(k)) line += "·";
      else if (customFloor.has(k)) line += "+";
      else line += ".";
    }
    console.log(line + "   " + y);
  }
  console.log("");
  inR.forEach(f => {
    const violated = model.wallTouch(f);
    console.log("  " + letter.get(f) + "  " + String(f.id || "-").padEnd(14) + f.a.padEnd(18) +
      ("@" + f.x + "," + f.y).padEnd(15) + " 格=" + cellsOf(f).join(" ") +
      (violated === "none" ? "  贴墙:none" : violated === "on-wall" ? "  ⚠压在墙格" : ""));
  });
}
