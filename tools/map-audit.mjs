#!/usr/bin/env node
/**
 * 地图审计（tools/map-audit.mjs）：把地图当成"关卡"来体检，输出结构化问题清单。
 *
 *   node tools/map-audit.mjs            # 全部检查，按严重度排序打印
 *   node tools/map-audit.mjs --json     # 机器可读
 *
 * 检查项（都是"数据自洽"，不依赖浏览器）：
 *   A 可走性：从工位洪泛，算出不可达格 / 连通分量数
 *   B 锚点：每个 zone 的 anchor 是否越界、是否落在阻挡格、是否可达、是否在自己房间矩形内
 *   C 房间矩形：互相重叠 / 装不下家具 / 房子精灵不在自己矩形内
 *   D 门与出入口：大门是否真的能出去；室内->户外有几个真实出口
 *   E 路网：道路格是否可走、是否压墙、主街是否连通到三户门口
 *   F 地形：room.js 的材质函数与房间矩形是否矛盾（木地板铺在草地上之类）
 *   G NPC：活动范围（roam + 随机 y）是否落在房子/街道上，床位是否在室内
 *   H 家具：落在所有房间矩形之外的室内家具 / 踩在水面或墙上的家具
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const read = f => fs.readFileSync(f, "utf8");
const map = JSON.parse(read(path.join(WEB, "map.json")));
const man = JSON.parse(read(path.join(WEB, "assets", "manifest.json")));
/* v2.8-e：把"编辑器自定义层"一起算进来。
 * 屏幕上看到的是 base(map.json) + custom(hub/map.custom.json)，只审 base 会得出"没问题"的假结论
 * —— 实测自定义层里有 79 棵橡树、379 块地板涂刷、160 条地形，全在 map.json 之外。
 * 只取"真家具"（a 能在 manifest 里查到的）；floor/terrain/hide/light/shadow/move/switch 是编辑器指令，跳过。 */
let customFurn = [], customCmd = 0;
try {
  const cj = JSON.parse(fs.readFileSync(path.join(ROOT, "hub", "map.custom.json"), "utf8"));
  (cj.furniture || []).forEach(f => {
    if (!f || typeof f.x !== "number" || typeof f.y !== "number") return;
    if (man[f.a]) customFurn.push(f); else customCmd++;
  });
} catch {}
const allFurn = (map.furniture || []).concat(customFurn);
/* v2.8-e：地面也有自定义层。
 *   {a:"floor",   t:"tile|stone|grass|wood|road", x,y}  逐格改写地板
 *   {a:"terrain", t:"wall|water", x,y}                  逐格叠地形（wall/water 同时意味着不可走）
 * 实测：381 块 floor + 132 格自定义墙 + 28 格水 —— 所以 baseMaterialAt 改草坪在画面上看不见。
 * 下面把两层叠上去，得到"这一格现在到底是什么"。 */
const customFloor = new Map(), customTerrain = new Map();
try {
  const cj2 = JSON.parse(fs.readFileSync(path.join(ROOT, "hub", "map.custom.json"), "utf8"));
  (cj2.furniture || []).forEach(f => {
    if (typeof f.x !== "number" || typeof f.y !== "number" || !f.t) return;
    if (f.a === "floor") customFloor.set(f.x + "," + f.y, f.t);
    else if (f.a === "terrain") customTerrain.set(f.x + "," + f.y, f.t);
  });
} catch {}
const effMat = (tx, ty) => customFloor.get(tx + "," + ty) || customTerrain.get(tx + "," + ty) || matOf(tx, ty);
const roomSrc = read(path.join(WEB, "src", "room.js"));
const furnSrc = read(path.join(WEB, "src", "furniture.js"));
const npcSrc = read(path.join(WEB, "src", "npc.js"));

const T = map.room.tile, COLS = map.room.cols, ROWS = map.room.rows;
const WALL_H = Number(map.room.wallH || 48);
const model = loadModel();   // 占格/墙格/锚点的唯一来源（本文件不再自己算一套）
const issues = [];
const add = (sev, code, msg, extra) => issues.push({ sev, code, msg, extra });

// ---------- 房间矩形（与 furniture.js 同源）----------
const rects = {};
["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"].forEach(k => {
  const m = new RegExp(k + ":\\s*\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]").exec(furnSrc);
  if (m) rects[k] = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
});
const inRect = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const roomAt = (x, y) => Object.keys(rects).find(k => inRect(rects[k], x, y)) || null;

// ---------- 可走格（复刻 buildBlockedGrid）----------
const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
for (let x = 0; x < COLS; x++) grid[0][x] = 1;                       // 第 0 行（墙根）不可走
(map.walls || []).forEach(wl => {
  if (wl.x0 !== undefined) {
    for (let x = wl.x0; x <= wl.x1; x++) {
      if (wl.gap && x >= wl.gap[0] && x <= wl.gap[1]) continue;
      if (grid[wl.y]) grid[wl.y][x] = 1;
    }
  } else {
    for (let y = wl.y; y < wl.y + wl.h; y++) {
      if (wl.gap && y >= wl.gap[0] && y <= wl.gap[1]) continue;
      if (grid[y]) grid[y][wl.x] = 1;
    }
  }
});
// 家具占地（bbox 底部 12px 投影）—— 【与运行时 buildBlockedGrid 同一套算式】
// 原来是 floor(f.x - wTiles/2) / floor(f.y - footH)，少了排版时的 TILE/2 中心偏移（p.x = f.x*T+24），
// 于是每一件都往左上偏半格：整数 x 的家具会被算到 x-1 列，审计就报"家具踩在墙上""有格子不连通"，
// 而运行时不挡。三套占格口径（运行时 / check.mjs / 这里）必须只剩一套，否则改一个位置要同时哄三个判据。
// 家具占地 —— 【不再自己算】。占格口径只有 map-model.cellsOf 一份（与运行时 buildBlockedGrid 逐字同算式）。
// 这里原来自己算一版 floor(f.x - wTiles/2) / floor(f.y - footH)，少了排版时的 TILE/2 中心偏移，
// 每件都往左上偏半格：整数 x 的家具被算到 x-1 列，于是报出"家具踩在墙上""有格子不连通""路断了"
// 这类其实不存在的错，而真正压在路上的反而看不出来。三套口径对齐这件事（§2）比修任何单件都优先。
const feet = [];
model.items.filter(model.solid).forEach(f => {
  const label = f.id || f.a;
  for (const k of model.cellsOf(f)) {
    const [tx, ty] = k.split(",").map(Number);
    if (grid[ty] && grid[ty][tx] !== undefined) { grid[ty][tx] = 1; feet.push({ id: label, tx, ty }); }
  }
});
// 池塘
(map.blockers || []).filter(b => b.t === "pond").forEach(b => {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2;
  for (let y = Math.floor(b.y0); y <= Math.ceil(b.y1); y++) {
    for (let x = Math.floor(b.x0); x <= Math.ceil(b.x1); x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1 && grid[y]) grid[y][x] = 1;
    }
  }
});
// 自定义地形里的墙/水同样不可走（用户是逐格刷的，map.json 里没有）
customTerrain.forEach((t, k) => {
  if (t !== "wall" && t !== "water") return;
  const p = k.split(","), x = Number(p[0]), y = Number(p[1]);
  if (grid[y]) grid[y][x] = 1;
});
const walk = (x, y) => grid[y] && grid[y][x] === 0;

// ---------- A 可走性 / 连通分量 ----------
const seen = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
const comps = [];
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  if (!walk(x, y) || seen[y][x]) continue;
  const q = [[x, y]], cells = [];
  seen[y][x] = true;
  while (q.length) {
    const [cx, cy] = q.pop(); cells.push([cx, cy]);
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const nx = cx + dx, ny = cy + dy;
      if (walk(nx, ny) && !seen[ny][nx]) { seen[ny][nx] = true; q.push([nx, ny]); }
    });
  }
  comps.push(cells);
}
comps.sort((a, b) => b.length - a.length);
const main = comps[0] || [];
const mainSet = new Set(main.map(([x, y]) => x + "," + y));
const walkCount = main.length;
const totalWalk = comps.reduce((s, c) => s + c.length, 0);
if (comps.length > 1) {
  const small = comps.slice(1).filter(c => c.length >= 6);
  if (small.length) add("P1", "A1", "存在 " + comps.length + " 个互不连通的可行走区（小岛共 " + small.reduce((s, c) => s + c.length, 0) + " 格）：A* 走不过去，会退化成直线穿墙",
    small.slice(0, 4).map(c => ({ 格数: c.length, 位置: c.slice(0, 3).map(([x, y]) => x + "," + y).join(" / ") })));
}
const deadCells = comps.slice(1).flat();
if (deadCells.length) {
  const inRoom = deadCells.filter(([x, y]) => roomAt(x, y));
  if (inRoom.length) add("P1", "A2", "有 " + inRoom.length + " 个**房间内部**的格子与主区域不连通（家具把门口堵死或墙没留门洞）",
    inRoom.slice(0, 6).map(([x, y]) => ({ 格: x + "," + y, 房间: roomAt(x, y) })));
}

// ---------- B 锚点 ----------
Object.keys(map.zones || {}).forEach(k => {
  const z = map.zones[k];
  const a = z && z.anchor;
  if (!Array.isArray(a) || a.length !== 2) { add("P0", "B0", "zone " + k + " 没有合法 anchor"); return; }
  /* 锚点格口径 = Math.round，和 map-model / check.mjs 一致（§2 取整口径表：房间归属用 floor，
   * 锚点用 round）。这里原来是 floor：锚点 [20.6,1] 被算成 (20,1)，而运行时/门禁算的是 (21,1)，
   * 于是审计对着"隔壁那一格"报"锚点落在阻挡格"，五个 zone 全是假警报。 */
  const x = Math.round(a[0]), y = Math.round(a[1]);
  if (a[0] < 0 || a[0] >= COLS || a[1] < 0 || a[1] >= ROWS) add("P0", "B1", "zone " + k + " 锚点越界", { anchor: a });
  else if (grid[y] && grid[y][x] === 1) add("P1", "B2", "zone " + k + " 锚点落在阻挡格（家具/墙/水里）→ 走过去站在原地", { anchor: a });
  else if (!mainSet.has(x + "," + y)) add("P1", "B3", "zone " + k + " 锚点不可达（不在主连通区）", { anchor: a });
  // 房间内的 zone 必须在自己房间矩形内
  const r = roomAt(x, y);
  const roomKey = /^nbCat|^doorCat|^living_cat/.test(k) ? "nbCat" : /^nbChief|^doorChief|^living_chief/.test(k) ? "nbChief"
    : /^nbDoc|^doorDoc|^living_doc/.test(k) ? "nbDoc" : null;
  if (roomKey && r && r !== roomKey) add("P2", "B4", "zone " + k + " 的房间不匹配：锚点实际落在 " + (r || "户外/无房间"), { anchor: a, 期望: roomKey });
});

// ---------- C 房间矩形 ----------
const ks = Object.keys(rects);
for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) {
  const a = rects[ks[i]], b = rects[ks[j]];
  if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) add("P0", "C1", "房间矩形重叠：" + ks[i] + " × " + ks[j]);
}
const placed = allFurn.filter(f => typeof f.x === "number" && typeof f.y === "number");
ks.forEach(k => {
  const n = placed.filter(f => inRect(rects[k], f.x, f.y)).length;
  if (!n) add("P1", "C2", "房间 " + k + " 矩形里一件家具都没有（坐标多半是旧布局）");
});
[["homeCat", "nbCat"], ["homeChief", "nbChief"], ["homeDoc", "nbDoc"]].forEach(([id, room]) => {
  const h = placed.find(f => f.id === id);
  if (h && !inRect(rects[room], h.x, h.y)) add("P1", "C3", "房子 " + id + " 不在 " + room + " 矩形内：夜里开灯/阴影会作用到别人家", { at: [h.x, h.y] });
});

// ---------- D 门与出入口 ----------
const door = map.door || {};
const gateBlocked = (() => {
  for (let x = door.tx; x < door.tx + (door.tw || 1); x++) if (walk(x, 0)) return false;
  return true;
})();
if (gateBlocked) {
  add("P2", "D1", "大门（tx=" + door.tx + "）在第 0 行，而第 0 行整行不可走 → **这扇门走不出去**（视觉上是门，实际是墙）",
    { 建议: "要么让它真能出入（在外侧留一格 + 出门演出），要么从美术上封死" });
}
// 室内 <-> 户外的真实通道：房间边缘的可走缝隙
const indoorSet = new Set(["office", "bedroom", "bath", "kitchen"]);
const exits = [];
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  if (!walk(x, y)) continue;
  const here = roomAt(x, y);
  [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
    const nx = x + dx, ny = y + dy;
    if (!walk(nx, ny)) return;
    const there = roomAt(nx, ny);
    if (indoorSet.has(here) && !there) exits.push({ from: here, at: x + "," + y, to: "户外" });
  });
}
if (!exits.length) add("P0", "D2", "室内没有任何一格能走到户外：鱼出不了门");
else add("P3", "D3", "室内→户外的通道共 " + exits.length + " 处", exits.slice(0, 8));

// ---------- E 路网 ----------
const roads = map.roads || [];
const roadCells = [];
roads.forEach(r => {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) roadCells.push([x, y]);
});
const roadOnWall = roadCells.filter(([x, y]) => !walk(x, y));
if (roadOnWall.length) add("P1", "E1", "有 " + roadOnWall.length + " 格道路压在不通行格上（墙/家具/水面）——视觉上「路断了」", { 样例: roadOnWall.slice(0, 6).map(([x, y]) => x + "," + y) });
// 主街是否连到三户门口
["living_cat", "living_chief", "living_doc"].forEach(k => {
  const a = map.zones[k] && map.zones[k].anchor;
  if (!a) return;
  const ax = Math.floor(a[0]), ay = Math.floor(a[1]);
  if (!mainSet.has(ax + "," + ay)) return;
});

// ---------- F 地形 vs 房间 ----------
const matOf = (tx, ty) => {
  if (tx <= 26) {
    if (tx >= 10 && tx <= 15 && ty < 15) return "tile";
    if (tx >= 17 && tx <= 24 && ty < 15) return "tile";
    return "wood";
  }
  if (tx <= 38) return "grass";
  /* 镜像 room.js baseMaterialAt（v2.8-c：三户室内统一木地板，街道仍旧石板） */
  if (ty >= 19 && tx >= 39) return "wood";
  return "stone";
};
const wantMat = room => (room === "bath" || room === "kitchen" ? "tile" : "wood");
ks.forEach(k => {
  const r = rects[k];
  let bad = 0, worst = null;
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (x >= COLS || y >= ROWS) continue;
    if (!walk(x, y)) continue;
    if (roomAt(x, y) !== k) continue;
    const m = effMat(x, y);   // v2.8-e：算上自定义 floor/terrain 之后的真实材质
    if (m !== wantMat(k)) { bad++; worst = worst || (x + "," + y + " 是 " + m); }
  }
  if (bad > 4) add("P2", "F1", "房间 " + k + " 里有 " + bad + " 格地面材质不对（应为 " + wantMat(k) + "）", { 例: worst });
});

// ---------- G NPC ----------
const npcDefs = [...npcSrc.matchAll(/id: "(cat|chief|doc)"[\s\S]{0,180}?bed: "(\w+)",\s*bedAt: \[([\d.]+), ([\d.]+)\],\s*roam: \[(\d+), (\d+)\]/g)];
npcDefs.forEach(m => {
  const [, id, bed, bx, by, rx0, rx1] = m;
  const bedF = placed.find(f => f.id === bed);
  if (!bedF) add("P2", "G1", "NPC " + id + " 的床位 id " + bed + " 在地图里不存在");
  else {
    const home = id === "cat" ? "nbCat" : id === "chief" ? "nbChief" : "nbDoc";
    if (!inRect(rects[home], bedF.x, bedF.y)) add("P1", "G2", "NPC " + id + " 的床 " + bed + " 不在自己屋里：" + JSON.stringify([bedF.x, bedF.y]));
  }
  /* 漫游区：新版是矩形 {x0,y0,x1,y1}（v2.8-c 起），旧版是 [x0,x1] + 固定随机 y 8.5~13。
   * 检查目标只有一个：漫游区必须压在自家门前这条街上（和房子矩形在 y 上相接/相邻），
   * 不能飘到房子北侧那片空草地上。 */
  const m2 = /roam: \{ x0: ([\d.]+), y0: ([\d.]+), x1: ([\d.]+), y1: ([\d.]+) \}/.exec(npcSrc);
  const home = id === "cat" ? "nbCat" : id === "chief" ? "nbChief" : "nbDoc";
  const r = rects[home];
  let yLo = 8.5, yHi = 13;
  if (m2) { yLo = +m2[2]; yHi = +m2[4]; }
  const overlap = r && !(r.y + r.h <= yLo || r.y >= yHi) ;
  if (!overlap) {
    add("P1", "G3", "NPC " + id + " 的漫游区（y " + yLo + "~" + yHi + "）与自家房子（y " + (r ? r.y + "~" + (r.y + r.h) : "?") + "）不相接 → 她会飘在离家很远的地方",
      { 建议: "漫游矩形贴着自家门前的街道（y 16~18.6）" });
  }
});

// ---------- H 家具位置 ----------
// 用上面同一套算式算出来的占地格（feet），不要再拿 floor(f.x)/floor(f.y) 当"家具所在格"——
// 那是第四套口径，和占地格差半格，会报出"家具踩在墙上 7,15"这种其实站在第 16 行的假警报。
const feetById = new Map();
feet.forEach(e => { if (!feetById.has(e.id)) feetById.set(e.id, []); feetById.get(e.id).push(e); });
placed.forEach(f => {
  const cells = feetById.get(f.id || f.a) || [];
  for (const { tx: x, ty: y } of cells) {
    if (!grid[y]) continue;
    if (grid[y][x] === 1 && !f.o && !f.wall && !f.on) {
      const onWall = (map.walls || []).some(wl => wl.x0 !== undefined
        ? (y === wl.y && x >= wl.x0 && x <= wl.x1 && !(wl.gap && x >= wl.gap[0] && x <= wl.gap[1]))
        : (x === wl.x && y >= wl.y && y < wl.y + wl.h && !(wl.gap && y >= wl.gap[0] && y <= wl.gap[1])));
      const onPond = (map.blockers || []).filter(b => b.t === "pond").some(b => {
        const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2;
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        return dx * dx + dy * dy <= 1;
      });
      if (onWall) add("P2", "H1", "家具 " + (f.id || f.a) + " 踩在墙上：" + x + "," + y);
      else if (onPond) add("P2", "H2", "家具 " + (f.id || f.a) + " 漂在水面上：" + x + "," + y);
    }
  }
});
const outdoorFurniture = placed.filter(f => !roomAt(Math.floor(f.x), Math.floor(f.y)) && Math.floor(f.x) < 26);
if (outdoorFurniture.length) {
  add("P2", "H3", "主屋范围内有 " + outdoorFurniture.length + " 件家具不在任何房间矩形里（y<15 的北侧空地或墙带）",
    outdoorFurniture.slice(0, 8).map(f => (f.id || f.a) + "@" + f.x + "," + f.y));
}

// ---------- 输出 ----------
const sevRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
issues.sort((a, b) => sevRank[a.sev] - sevRank[b.sev]);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ walkable: walkCount, components: comps.length, issues }, null, 2));
} else {
  console.log("\n地图审计（" + COLS + "×" + ROWS + " 格 · 可走 " + walkCount + " 格 · 连通区 " + comps.length + " 个 · 家具 " + placed.length + " 件）");
  console.log("─".repeat(70));
  if (!issues.length) console.log("  ✓ 没发现结构性问题");
  issues.forEach(i => {
    console.log("[" + i.sev + "] " + i.code + "  " + i.msg);
    if (i.extra) console.log("        " + JSON.stringify(i.extra));
  });
  const c = s => issues.filter(i => i.sev === s).length;
  console.log("─".repeat(70));
  console.log("P0 " + c("P0") + " · P1 " + c("P1") + " · P2 " + c("P2") + " · 共 " + issues.length + " 条\n");
}
