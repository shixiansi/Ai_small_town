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
// 编号点阵的块边长：S=30 → 2px/块（一个数字 6×10px），S≥48 → 3px/块
const DIG = Math.max(1, Math.min(3, Math.round(S / 16)));

// ---------- 房间矩形 ----------
/* 房间名单从 furniture.js 现解析，**别再写死 7 间**。
 * 旧版把 office..nbDoc 七个 key 硬编码在 ROOM_COLORS 里，于是：
 *   1) 新增的 parkCourt/brickHall 永远不出描边；
 *   2) `--only=parkCourt` 找不到矩形 → 静默退化成"整张图"，还打不开报错
 *      （实测 map-annotate-parkCourt.png 与 -brickHall.png 字节数完全相同，就是整图 fallback 的铁证）；
 *   3) 制表符对齐的 `parkCourt:\t[41, 1, ...]` 用 `k + ":"` 拼正则也匹配不到。
 * 现在：key 一律现扫描，坐标允许任意空白，配色按 key 稳定散列，漏房间不再静默。 */
const PALETTE = [[255, 99, 71], [255, 165, 0], [64, 224, 208], [186, 85, 211], [30, 144, 255],
                 [50, 205, 50], [255, 20, 147], [210, 180, 60], [150, 120, 220], [70, 200, 140]];
const ROOM_KEYS = (() => {
  const keys = [], re = /^\s*([A-Za-z]\w*)\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/gm;
  let m; while ((m = re.exec(furnSrc))) if (!keys.includes(m[1])) keys.push(m[1]);
  return keys;
})();
const ROOM_COLORS = {};
ROOM_KEYS.forEach(k => {
  let h = 0; for (const ch of k) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  ROOM_COLORS[k] = PALETTE[h % PALETTE.length];
});
const rects = {};
ROOM_KEYS.forEach(k => {
  const m = new RegExp("\\b" + k + ":\\s*\\[\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*\\]").exec(furnSrc);
  if (m) rects[k] = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
});
if (!ROOM_KEYS.length) { console.error("没从 furniture.js 解析到房间矩形"); process.exit(1); }
const only = arg.only ? String(arg.only) : null;
if (only && !rects[only]) {
  console.error("找不到房间矩形: " + only + "（已识别：" + Object.keys(rects).join(", ") + "）");
  process.exit(1);
}
/* --rect=x,y,w,h：任意区域。房间之外的地方（花园/主街/公园）以前只能出整图，
 * 一个 56×30 的整图里花园只占一小块，13 处户外重叠根本看不清 —— 而这正是第 2 维
 * "素材/碰撞"要逐条判豁免的地方。 */
let rectView = null;
if (arg.rect) {
  const p = String(arg.rect).split(",").map(Number);
  if (p.length !== 4 || p.some(v => !Number.isFinite(v)) || p[2] <= 0 || p[3] <= 0) {
    console.error("--rect 需要 x,y,w,h（正整数）"); process.exit(1);
  }
  rectView = { x: p[0], y: p[1], w: p[2], h: p[3] };
}
const view = rectView || (only && rects[only] ? rects[only] : { x: 0, y: 0, w: COLS, h: ROWS });
/* 坐标尺：左边+上边各留一条 GUT，按 5 格标一次行列号。
 * 没有尺子的分层图没法做"材质逐格核对"——旧版谁也说不清图上某块地板是第几列，
 * 于是"第 1 层地板"这一维事实上没被验收过（本次补齐）。 */
const GUT = Math.max(26, Math.round(S * 0.9));
const W = view.w * S + GUT, H = view.h * S + GUT;
const px = Buffer.alloc(W * H * 4, 255);
/* 视图裁剪：**画布只等于视图**，视图外面的格子一律不画。
 * 旧版在房间视图里还会把 (±1 格) 之外的边角家具、以及下方 40px 留白里的格子一起画出来，
 * 于是每张房间图底部都挂着半截"不属于这间房"的家具，看图时无法判断它到底在不在房间里
 * （这也是"层 2 碰撞"验收最容易读错的地方）。 */
const inV = (x, y) => x >= view.x && x < view.x + view.w && y >= view.y && y < view.y + view.h;
const set = (x, y, c, a = 255) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4, k = a / 255;
  px[i] = Math.round(px[i] * (1 - k) + c[0] * k); px[i + 1] = Math.round(px[i + 1] * (1 - k) + c[1] * k); px[i + 2] = Math.round(px[i + 2] * (1 - k) + c[2] * k);
};
const rect = (x0, y0, w, h, c, a = 255) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, c, a); };
const frame = (x0, y0, w, h, c, a = 255) => { for (let x = x0; x < x0 + w; x++) { set(x, y0, c, a); set(x, y0 + h - 1, c, a); } for (let y = y0; y < y0 + h; y++) { set(x0, y, c, a); set(x0 + w - 1, y, c, a); } };
const X = tx => Math.round(GUT + (tx - view.x) * S), Y = ty => Math.round(GUT + (ty - view.y) * S);

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
/* 道路格先算出来，**只作为"底色之上的独立图层"涂一次**。
 * 旧版的顺序是：先铺地板 → 再给 roads 盖一层 alpha 200 的浅色 → 最后又把 customTerrain
 * 盖一遍，于是同一格可能出现"草地 + 路 + 草"三层叠加，图上一半浅一半深，
 * 看着像"地板材质一格一格不统一"，实际是同一个格子被涂了两次（本图就是这么误导读者的）。 */
const roadCells = new Set();
(map.roads || []).forEach(r => {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roadCells.add(x + "," + y);
});
for (let ty = view.y; ty < view.y + view.h; ty++) for (let tx = view.x; tx < view.x + view.w; tx++) {
  const mat = material(tx, ty);
  rect(X(tx), Y(ty), S, S, FLOOR[mat] || [200, 200, 200]);
}
/* 道路：整格实色 + 格内十字纹（"是路"和"是别的浅色地板"要能一眼分开） */
roadCells.forEach(k => {
  const [x, y] = k.split(",").map(Number);
  if (x < view.x || y < view.y || x >= view.x + view.w || y >= view.y + view.h) return;
  rect(X(x), Y(y), S, S, FLOOR.road, 255);
  const mid = Math.floor(S / 2);
  rect(X(x) + mid, Y(y), Math.max(1, Math.round(S / 12)), S, [196, 186, 166], 160);
  rect(X(x), Y(y) + mid, S, Math.max(1, Math.round(S / 12)), [196, 186, 166], 160);
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
/* customTerrain 已经在 material() 里参与底色（优先级 floor > terrain > base），
 * 这里**不能再涂一遍**：叠加会让同一格出现两种深度，误读成"材质不统一"。
 * 只保留一个"地形加密边框"提示：地形（墙/水/农田）是独立图层，得能看见它在哪。 */
customTerrain.forEach((t, k) => {
  const [x, y] = k.split(",").map(Number);
  if (x < view.x || y < view.y || x >= view.x + view.w || y >= view.y + view.h) return;
  if (t === "water" || t === "farm") frame(X(x) + 1, Y(y) + 1, S - 2, S - 2, [20, 60, 120], 200);
});
/* 第 0 行是整幅地图的顶部墙带。**只有它真的落在视图里才画** ——
 * 旧版无条件 `rect(X(x), Y(0), ...)`，房间视图（view.y=1 或 15）里 Y(0) 是负值，
 * 于是画到画布外面的坐标尺条带上，每张房间图顶部都多一条说不清的深色噪带。 */
if (view.y <= 0 && 0 < view.y + view.h) for (let x = view.x; x < view.x + view.w; x++) rect(X(x), Y(0), S, S, FLOOR.wall);
Object.keys(rects).forEach(k => {
  const r = rects[k];
  /* 与视图求交再画：房间矩形可能有一部分在视图外（--rect 花园视图就切到了三户北墙），
   * 直接按整矩形画会把描边甩到画布外面、在坐标尺上留下一条莫名奇妙的彩线。 */
  const ix0 = Math.max(r.x, view.x), iy0 = Math.max(r.y, view.y);
  const ix1 = Math.min(r.x + r.w, view.x + view.w), iy1 = Math.min(r.y + r.h, view.y + view.h);
  if (ix1 <= ix0 || iy1 <= iy0) return;
  frame(X(ix0), Y(iy0), (ix1 - ix0) * S, (iy1 - iy0) * S, ROOM_COLORS[k], 255);
});
/* 格线 + 刻度：材质逐格核对的前提。细线=每格，粗线=每 5 格；上/左标列行号。
 * 层 1 的验收就靠这套尺子说"第几列第几行"，没有它就只能说"左上角那块"。 */
for (let tx = view.x; tx <= view.x + view.w; tx++) {
  const px0 = Math.min(W - 1, X(tx)), major = tx % 5 === 0;
  for (let y = GUT; y < GUT + view.h * S; y++) set(px0, y, major ? [30, 34, 44] : [90, 84, 74], major ? 210 : 70);
}
for (let ty = view.y; ty <= view.y + view.h; ty++) {
  const py0 = Math.min(H - 1, Y(ty)), major = ty % 5 === 0;
  for (let x = GUT; x < GUT + view.w * S; x++) set(x, py0, major ? [30, 34, 44] : [90, 84, 74], major ? 210 : 70);
}
// 刻度条：先铺深底，再写黄字（顺序反了会被自己的底色盖掉）
rect(0, 0, W, GUT - 9 * DIG, [18, 22, 32], 255);
rect(0, GUT - 9 * DIG, GUT - 2, H, [18, 22, 32], 255);
for (let tx = view.x; tx < view.x + view.w; tx++) {
  if (tx % 5 !== 0) continue;
  const n = String(tx); let cx = X(tx) + 2;
  for (const ch of n) { drawDigit(cx, GUT - 5 * DIG - 6, ch, [255, 235, 160]); cx += 4 * DIG; }
}
for (let ty = view.y; ty < view.y + view.h; ty++) {
  if (ty % 5 !== 0) continue;
  const n = String(ty); let cy = Y(ty) + 2;
  for (const ch of n) { drawDigit(2, cy, ch, [255, 235, 160]); cy += 6 * DIG; }
}

// ---------- 第 2 层：素材（方块 + 编号）与碰撞体积 ----------
/* v2.8-h：占格与重叠一律走 tools/map-model.mjs（唯一实现）。
 * 旧版本这里自己复刻了一份 cellsOf，与运行时的 buildBlockedGrid 差半格；
 * 于是图上画的碰撞框和门禁判的碰撞框**不是同一个东西**，靠看图验收等于白看。
 * 现在：碰撞框 = 模型算出来的真实格，重叠格 = 模型 conflictsOf 的并集，直接涂洋红。 */
const um = loadModel();
const inView = f => f.x >= view.x - 1 && f.x <= view.x + view.w + 1 && f.y >= view.y - 1 && f.y <= view.y + view.h + 1;
const modelByKey = new Map();
um.items.forEach(f => modelByKey.set((f.id || f.a) + "@" + f.x + "," + f.y, f));
/* 重叠格：把每对冲突的相交格全收集起来（同素材互叠也标，图上才能看出"密林"长什么样） */
/* 重叠标记必须**与门禁同一个判据**（v2.9：引擎约束落地后这里同步改）。
 * 旧写法用 um.conflictsOf()，那还是"同素材互换也报"的老口径，
 * 于是图上画着一片洋红、而 check.mjs 说"违规 0 处" —— 图和门禁互相打脸。
 * 现在：
 *   洋红 = layoutViolations() 里 E-OVERLAP 指出的格子（真错，门禁会拦）
 *   玫红 = 植被之间的互叠（用户拍板的豁免项，图上看得出但不报错）
 */
const conflictSet = new Set(), sameAssetSet = new Set();
um.layoutViolations().filter(v => v.code === "E-OVERLAP").forEach(v => {
  if (v.cell) conflictSet.add(v.cell);
});
// 植被互叠：画成玫红做"豁免"提示（不进门禁）
const vegSet = new Set();
um.items.filter(f => um.solid(f) && inView(f) && um.hasBody(f)).forEach(f => {
  const mine = new Map();
  um.bodyCellsOf(f).forEach(k => mine.set(k, f));
  um.items.forEach(g => {
    if (g === f || !um.hasBody(g)) return;
    if (!(um.bodyCellsOf(g).length && um.bodyCellsOf(f).length)) return;
    const gs = um.bodyCellsOf(g);
    mine.forEach((owner, k) => {
      if (!gs.includes(k)) return;
      if (owner.a === g.a) sameAssetSet.add(k);
    });
  });
});
const items = (map.furniture || []).concat(customFurn).filter(f => typeof f.x === "number" && typeof f.y === "number" && man[f.a] && f.a !== "move");
const LEGEND = [];
items.forEach((f, i) => {
  /* 有没有碰撞、占哪些格，一律听引擎的（asset-rules 的 body 口径）：
   * body=none（挂墙/桌上/纯装饰）→ 紫框细边，不占格；
   * body=cell（树/灌木/花）→ 只占主干 1 格；
   * body=full（家具/设施）→ 整块 bbox 投影。
   * 旧版是 `!(f.o||f.wall||f.on)`，把带 o 标记的落地件也当成"无碰撞"，
   * 与引擎对不上。 */
  const solid = mf => false;
  LEGEND.push(i + 1, f);
  if (f.x < view.x - 1 || f.y < view.y - 1 || f.x > view.x + view.w + 1 || f.y > view.y + view.h + 1) return;
  const mf2 = modelByKey.get((f.id || f.a) + "@" + f.x + "," + f.y);
  const bodyOn = mf2 && um.hasBody(mf2);
  let x0, y0, w0, h0;
  if (bodyOn) {
    const cs = um.bodyCellsOf(mf2).map(k => k.split(",").map(Number)).filter(([cx2, cy2]) => inV(cx2, cy2));
    if (!cs.length) return;
    const xs = cs.map(c => c[0]), ys = cs.map(c => c[1]);
    x0 = X(Math.min(...xs)); y0 = Y(Math.min(...ys));
    w0 = Math.max(3, (Math.max(...xs) - Math.min(...xs) + 1) * S);
    h0 = Math.max(4, (Math.max(...ys) - Math.min(...ys) + 1) * S);
    cs.forEach(([cx2, cy2]) => {
      const key = cx2 + "," + cy2;
      const isVegCell = um.bodyCellsOf(mf2).length === 1 && (f.a === "oak-tree" || f.a === "bush" || f.a === "flowers");
      const col = conflictSet.has(key) ? [255, 0, 255] : sameAssetSet.has(key) ? [255, 60, 200] : isVegCell ? [70, 150, 70] : [220, 40, 40];
      rect(X(cx2), Y(cy2), S, S, col, conflictSet.has(key) ? 150 : 60);
    });
  } else {
    const bb = (man[f.a] && man[f.a].bbox) || [0, 0, 48, 48];
    const wT = Math.max(1, bb[2] / T), fh = Math.min(12, bb[3]) / T;
    const ty = Math.floor(f.y - fh + 0.001), xs = [];
    for (let k = 0; k < wT; k++) xs.push(Math.floor(f.x - wT / 2 + k));
    if (!inV(xs[0], ty)) return;
    x0 = X(Math.min(...xs)); y0 = Y(ty);
    w0 = Math.max(3, Math.round(xs.length * S)); h0 = Math.max(4, Math.round(S * 0.6));
  }
  if (bodyOn) {
    frame(x0, y0, w0, h0, [220, 40, 40], 255);
  } else {
    frame(x0, y0, w0, Math.max(3, Math.round(S * 0.35)), [120, 90, 160], 220);
  }
  /* 编号：原来固定 3×5 点阵、1px 线宽，在 S=18~26 时一个数字只有 3px 宽，
   * 缩略看一眼全是噪点（层 3 的验收等于走过场）。改成按 S 自适应的整数倍块状字，
   * 并且先铺一层深色底再写字，保证在木地板/草地/砖地三种底色上都读得出来。 */
  const n = String(i + 1);
  const dh = 5 * DIG;
  const tx0 = x0 + 1, ty0 = y0 + Math.max(2, h0 - dh - 2);
  rect(tx0 - 1, ty0 - 1, n.length * 4 * DIG + 1, dh + 2, [16, 20, 32], 210);
  let cx = tx0;
  for (const ch of n) { drawDigit(cx, ty0, ch, [255, 255, 255]); cx += 4 * DIG; }
});
/* 重叠清单：**直接用引擎的违规清单**，别再自己算一遍。
 * 旧版走 um.conflictsOf()（老口径：同素材互换也报），于是图报 30 对、门禁报 0 处 —— 
 * 两个判据互相打脸，看图的人不知道该信哪个。现在图上画什么、控制台报什么、门禁拦什么，
 * 全部来自同一份 layoutViolations()。 */
const pairList = um.layoutViolations()
  .filter(v => v.code === "E-OVERLAP" && inView({ x: v.x, y: v.y }))
  .map(v => (v.id || v.asset) + " × " + v.other);
// 3×5 点阵数字（DIG = 每个点阵像素放大的块边长，按 S 自适应）
function drawDigit(x0, y0, ch, col) {
  const G = {
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"]
  }[ch];
  if (!G) return;
  G.forEach((row, dy) => row.split("").forEach((bit, dx) => {
    if (bit === "1") rect(x0 + dx * DIG, y0 + dy * DIG, DIG, DIG, col, 255);
  }));
}

// ---------- 写 PNG ----------
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return b => { let c = -1; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }; })();
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type, "ascii"); const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
const out = path.resolve(ROOT, arg.out || path.join("logs", "map-annotate" + (only ? "-" + only : "") + (rectView ? "-r" + rectView.x + "_" + rectView.y + "_" + rectView.w + "x" + rectView.h : "") + ".png"));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);

// ---------- 控制台：图例 + 重叠告警 ----------
console.log("\n分层验收图 → " + out + "（第 1 层地板/道路/墙 + 第 2 层素材方块与碰撞）");
console.log("─".repeat(72));
console.log("读图约定（按这个顺序看，别跳层）：");
console.log("  第 1 层 地板：木=棕 瓷砖=灰蓝 草地=绿 石板=浅灰 水=蓝 农田=深棕");
console.log("          道路：浅米色实格 + 格内十字纹（是路，不是浅色地板）");
console.log("          墙  ：深墨实格； 门洞：黄色描边（走过不去就是错的）");
console.log("          房间矩形：彩色描边； 细线=每格 粗线=每 5 格；上/左有行列号");
console.log("  第 2 层 素材：红框=落地碰撞格（逐格涂） 紫框=装饰/挂墙（不占碰撞）");
console.log("          洋红实格=真重叠（异素材） 玫红实格=同素材互叠（密林豁免候选）");
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
const inViewConflicts = [...conflictSet].filter(k => {
  const [x, y] = k.split(",").map(Number);
  return x >= view.x && y >= view.y && x < view.x + view.w && y < view.y + view.h;
});
console.log("本视图重叠格 " + inViewConflicts.length + " 个（异素材 " + (inViewConflicts.length - [...sameAssetSet].filter(k => inViewConflicts.includes(k)).length) + " · 同素材 " + [...sameAssetSet].filter(k => inViewConflicts.includes(k)).length + "）");
if (pairList.length) {
  console.log("⚠ 碰撞重叠 " + pairList.length + " 对（图上洋红/玫红已标出，照格子核对）：");
  pairList.slice(0, 24).forEach(p => console.log("  " + p));
  if (pairList.length > 24) console.log("  …另有 " + (pairList.length - 24) + " 对");
} else console.log("✓ 没有碰撞重叠（on: 叠加关系已排除）");
console.log("落地家具 " + items.filter(f => !(f.o || f.wall || f.on)).length + " 件 · 装饰/叠加 " + items.filter(f => f.o || f.wall || f.on).length + " 件\n");
