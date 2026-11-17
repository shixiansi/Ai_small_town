#!/usr/bin/env node
/**
 * 唯一占格模型（tools/map-model.mjs）—— 地图/家具/锚点/碰撞格的单一事实源
 *
 * 为什么要有这个文件：自动消重叠连崩三次，根因是"两套占格模型各说各话"——
 * 执行器自己按 bbox 底部投影 + floor() 算，check.mjs 用另一套（round() + 自己的 placement 复刻）。
 * 差半格就足以让"算着不压锚点"的位置在门禁里变成压住锚点。现在把模型抽出来，
 * 所有工具（annotate / audit / 消重叠执行器 / check 的对账）都读同一份。
 *
 *   node tools/map-model.mjs            # 打模型摘要 + 与 check.mjs 的对账
 *   node tools/map-model.mjs --json     # 机器可读
 *
 * 导出：
 *   loadModel()            → { map, man, rooms, anchors, items, cellsOf, isBlocked, anchorCells }
 *   parityWithCheck(model) → { mismatches, checkedAnchors }   把模型的判断和门禁的实际判定比一遍
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const read = f => fs.readFileSync(f, "utf8");

export const ROOM_KEYS = ["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"];

export function loadModel(opts = {}) {
  const map = JSON.parse(read(path.join(WEB, "map.json")));
  const man = JSON.parse(read(path.join(WEB, "assets", "manifest.json")));
  const furnSrc = read(path.join(WEB, "src", "furniture.js"));
  const roomSrc = read(path.join(WEB, "src", "room.js"));
  const T = map.room.tile, COLS = map.room.cols, ROWS = map.room.rows;

  // 房间矩形（与家具层同源）
  const rooms = {};
  ROOM_KEYS.forEach(k => {
    const m = new RegExp(k + ":\\s*\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]").exec(furnSrc);
    if (m) rooms[k] = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
  });
  const roomOf = (x, y) => ROOM_KEYS.find(k => {
    const r = rooms[k]; return r && x >= r.x - 0.6 && x <= r.x + r.w + 0.6 && y >= r.y - 0.6 && y <= r.y + r.h + 0.6;
  }) || null;

  // 地板材质：直接 eval room.js（避免镜像漂移）
  const i = roomSrc.indexOf("function baseMaterialAt");
  const j = roomSrc.indexOf("\n  }", i) + 4;
  const fnText = roomSrc.slice(i, j);
  const baseMat = new Function("tx", "ty", fnText.slice(fnText.indexOf("{") + 1, fnText.lastIndexOf("}")));

  // 自定义层：地板 / 地形 / 家具
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

  /* 墙格（唯一实现）—— 之前 facing-check / facing-audit / layout-audit / rework-office 各抄了一份，
   * 改一处忘三处。墙有四个来源，全都得算：
   *   ① 第 0 行墙带（room.js paintTopBand：室内段是墙，只留大门门洞，但整行不可走）
   *   ② mapdata.walls（隔墙，跳过 gap 门洞）
   *   ③ 自定义层 terrain=wall（编辑器刷的墙，map.json 里看不到）
   *   ④ room.js paintOuterWalls 的外墙裙：西边 x=0 整列、南边 y=ROWS-1 的 x<26 段
   *      —— 只画贴图不加碰撞，所以 buildBlockedGrid 里没有它们；不补进来"贴墙率"会系统性偏低。 */
  const wallCells = new Set();
  for (let x = 0; x < COLS; x++) wallCells.add(x + ",0");
  (map.walls || []).forEach(wl => {
    if (wl.x0 !== undefined) {
      for (let x = wl.x0; x <= wl.x1; x++) if (!(wl.gap && x >= wl.gap[0] && x <= wl.gap[1])) wallCells.add(x + "," + wl.y);
    } else {
      for (let y = wl.y; y < wl.y + wl.h; y++) if (!(wl.gap && y >= wl.gap[0] && y <= wl.gap[1])) wallCells.add(wl.x + "," + y);
    }
  });
  customTerrain.forEach((t, k) => { if (t === "wall") wallCells.add(k); });
  /* 外墙裙的南段长度直接读 room.js，避免"渲染改了墙、审计还在用 26"这种漂移 */
  const outer = /function paintOuterWalls[\s\S]{0,400}?for \(var tx = 0; tx < (\d+);/.exec(roomSrc);
  const SOUTH_WALL_RIGHT = outer ? Number(outer[1]) : 26;
  for (let y = 1; y < ROWS; y++) wallCells.add("0," + y);
  for (let x = 0; x < SOUTH_WALL_RIGHT; x++) wallCells.add(x + "," + (ROWS - 1));

  // 每件家具的占格（与 check.mjs 同口径：round + bbox 底部 12px 投影）
  const cellsOf = f => {
    const m = man[f.a];
    if (!m) return [];
    /* 占格要用"真实像素宽度 × sc"，不能只用 bbox[2]/48 —— 宽体家具（office-desk 等）
     * 后者算出来比实际窄，于是"算着不压路"实际压了（E1 残留的原因）。 */
    const sc = Number(f.sc || 1);
    const bb = m.bbox || [0, 0, 48, 48];
    const pxW = Number(m.frameW || m.fw || bb[2] || 48) * sc;
    const pxH = Number(m.frameH || m.fh || bb[3] || 48) * sc;
    const wT = Math.max(1, pxW / T), fh = Math.min(12, pxH) / T;
    const ty = Math.round(f.y - fh);              // round：与门禁一致
    const xs = [];
    for (let i = 0; i < wT; i++) xs.push(Math.round(f.x - wT / 2 + i));
    return xs.map(x => x + "," + ty);
  };
  const solid = f => !(f.o || f.wall || f.on);

  /* §5.1「贴墙」的唯一实现 —— 三种结果，别混成布尔：
   *   "ok"      本件占的格没有一格是墙，且至少一格上下左右 1 格内有墙  → 真的背靠墙
   *   "on-wall" 本件有占格本身就是墙                                    → 被推进墙里了（丑且违规）
   *   "none"    不挨墙                                                  → 悬在房间中间
   * 旧实现只问"上下左右 1 格内有墙"，于是"自己就在墙格上"也被算成贴墙 → 家具被推进墙里还判通过。
   * 旧实现还只看 Math.round(f.x),Math.round(f.y) 一格，宽体家具（office-desk 等占 2~3 格）
   * 靠墙那一格挨着墙也会判失败 → 反向漏判。现在一律走 cellsOf（占格口径与门禁同源）。 */
  const wallTouch = f => {
    const cs = cellsOf(f);
    if (!cs.length) return "none";
    if (cs.some(k => wallCells.has(k))) return "on-wall";
    const near = cs.some(k => {
      const [x, y] = k.split(",").map(Number);
      return wallCells.has((x + 1) + "," + y) || wallCells.has((x - 1) + "," + y) ||
             wallCells.has(x + "," + (y + 1)) || wallCells.has(x + "," + (y - 1));
    });
    return near ? "ok" : "none";
  };
  const touchesWall = f => wallTouch(f) === "ok";

  const items = (map.furniture || []).concat(customFurn)
    .filter(f => typeof f.x === "number" && man[f.a] && f.a !== "move");

  // 阻挡格：第 0 行 + 墙 + 地形墙/水 + 落地家具
  const blocked = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  for (let x = 0; x < COLS; x++) blocked[0][x] = true;
  (map.walls || []).forEach(wl => {
    if (wl.x0 !== undefined) {
      for (let x = wl.x0; x <= wl.x1; x++) {
        if (wl.gap && x >= wl.gap[0] && x <= wl.gap[1]) continue;
        if (blocked[wl.y]) blocked[wl.y][x] = true;
      }
    } else {
      for (let y = wl.y; y < wl.y + wl.h; y++) {
        if (wl.gap && y >= wl.gap[0] && y <= wl.gap[1]) continue;
        if (blocked[y]) blocked[y][wl.x] = true;
      }
    }
  });
  customTerrain.forEach((t, k) => {
    if (t !== "wall" && t !== "water") return;
    const [x, y] = k.split(",").map(Number);
    if (blocked[y]) blocked[y][x] = true;
  });
  items.filter(solid).forEach(f => cellsOf(f).forEach(k => {
    const [x, y] = k.split(",").map(Number);
    if (blocked[y] && blocked[y][x] !== undefined) blocked[y][x] = true;
  }));

  // 锚点：锚点格 + 四邻（执行器不许落在这里）
  const anchors = {};
  const anchorCells = new Set();
  Object.keys(map.zones || {}).forEach(k => {
    const z = map.zones[k], a = z && z.anchor;
    if (!Array.isArray(a)) return;
    const ax = Math.round(a[0]), ay = Math.round(a[1]);
    anchors[k] = { x: ax, y: ay, raw: a, sit: (z.sit && z.sit.host) || null, decorative: !!z.decorative };
    anchorCells.add(ax + "," + ay);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => anchorCells.add((ax + dx) + "," + (ay + dy)));
  });

  // 道路格：执行器不许把家具落到路上（落地家具压路 = 门禁 E1「路断了」）
  const roadCells = new Set();
  (map.roads || []).forEach(r => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roadCells.add(x + "," + y);
  });

  /* v2.8-h：碰撞判定也收敛到这里 —— 之前 resolve-v5/v6 与 resolve-stubborn 各写一份，
   * 结果两个脚本报的"真重叠"件数不一样（一个 2 件、一个 0 件）。现在只此一处。 */
  const occMap = except => {
    const m = new Map();
    items.forEach(f => {
      if (f === except || !solid(f)) return;
      cellsOf(f).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(f); });
    });
    return m;
  };
  const conflictsOf = f => {
    const m = occMap(f), out = [];
    cellsOf(f).forEach(k => (m.get(k) || []).forEach(g => { if (g.a !== f.a && !out.includes(g)) out.push(g); }));
    return out;
  };
  const protectedSet = new Set();
  Object.values(anchors).forEach(a => {
    if (a.sit) protectedSet.add(a.sit);
    items.forEach(f => { if (Math.abs(f.x - a.raw[0]) <= 1.2 && Math.abs(f.y - a.raw[1]) <= 1.2) protectedSet.add(f.id); });
  });

  return {
    map, man, T, COLS, ROWS, rooms, roomOf, material, items, solid, cellsOf, roadCells, conflictsOf, protectedSet,
    customFloor, customTerrain, customFurn, anchors, anchorCells,
    wallCells, wallTouch, touchesWall,
    isBlocked: (x, y) => !blocked[y] || blocked[y][x] === true,
    blocked
  };
}

/** 与 check.mjs 对账：模型说"锚点可站"的，门禁也必须说可站 —— 不一致就是两套模型又分叉了 */
export function parityWithCheck(model) {
  let out = "";
  try { out = execFileSync(process.execPath, [path.join(ROOT, "tools", "check.mjs")], { encoding: "utf8" }); }
  catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  const reported = new Set();
  out.split("\n").forEach(line => {
    const m = /^(\S+) 锚点 \[(\d+),(\d+)\] 落在阻挡格里/.exec(line.trim());
    if (m) reported.add(m[1]);
  });
  const mismatches = [];
  let checked = 0;
  Object.keys(model.anchors).forEach(k => {
    const a = model.anchors[k];
    if (a.decorative) return;
    checked++;
    const modelSaysBlocked = model.isBlocked(a.x, a.y);
    const checkSaysBlocked = reported.has(k);
    if (modelSaysBlocked !== checkSaysBlocked) {
      mismatches.push({ zone: k, at: a.x + "," + a.y, model: modelSaysBlocked ? "blocked" : "free", check: checkSaysBlocked ? "blocked" : "free" });
    }
  });
  return { mismatches, checkedAnchors: checked };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const model = loadModel();
  const p = parityWithCheck(model);
  const info = {
    rooms: Object.keys(model.rooms).length,
    zones: Object.keys(model.anchors).length,
    items: model.items.length,
    solid: model.items.filter(model.solid).length,
    blockedCells: model.blocked.flat().filter(Boolean).length,
    customFloor: model.customFloor.size,
    customTerrain: model.customTerrain.size,
    parity: { checked: p.checkedAnchors, mismatches: p.mismatches }
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(info, null, 2));
  else {
    console.log("\n地图模型（唯一占格模型）");
    console.log("─".repeat(60));
    console.log("  房间 " + info.rooms + " · zone " + info.zones + " · 家具 " + info.items + "（落地 " + info.solid + "）");
    console.log("  阻挡格 " + info.blockedCells + " · 自定义地板 " + info.customFloor + " 格 · 自定义地形 " + info.customTerrain + " 格");
    console.log("  与 check.mjs 对账：锚点 " + p.checkedAnchors + " 个，" + (p.mismatches.length ? "⚠ " + p.mismatches.length + " 处不一致" : "✓ 全部一致"));
    p.mismatches.forEach(m => console.log("    " + m.zone + " @" + m.at + " → 模型:" + m.model + " / 门禁:" + m.check));
    console.log("─".repeat(60) + "\n");
  }
}
