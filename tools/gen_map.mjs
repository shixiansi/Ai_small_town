#!/usr/bin/env node
/**
 * 地图重建（v43）：office/tools/gen_map.mjs → web/map.json
 *
 * 只改数据，不动代码逻辑；针对现有布局的"不合理"逐项修：
 *  1. 三户邻居的**房屋外观原来在 y≈9（路北），室内在 rows20-28（路南）**，靠 10 格门径硬连
 *     → 房屋挪到各自室内的正上方（y≈19.6），门洞正对门前的路
 *  2. 道路只有一条 y8.6 的横街贴着房顶、门径 10 格长
 *     → 改成 y16-18 的**主街**（紧贴房前），门径 1 格迎宾垫；加花园纵向小径 + 办公室东门石板小院
 *  3. 路灯 5 盏散在四处、其中两盏几乎重叠 → 沿主街等距 5 盏 + 花园小径 1 盏 + 塘边 1 盏
 *  4. 光源位置（原来是内置光池 + 编辑器手加）→ 新增 mapdata.lights，一盏灯一个光源，位置跟着灯走
 *  5. 家具压墙/压水/压田/压路 → 自动剔除（脚本会打印清单）
 *  6. 邻居家的隔墙按"每户 5 格 + 1 格隔墙"重新对齐（39/45/51 三道竖墙）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP = path.join(ROOT, "web", "map.json");
const map = JSON.parse(fs.readFileSync(MAP, "utf8"));

/* ---------- 1) 隔墙：三户邻居重新对齐 + 保留西屋原有隔墙 ---------- */
const westWalls = map.walls.filter(w => w.x0 !== undefined ? w.y === 15 : (w.x === 10 || w.x === 16 || w.x === 25));
const townWalls = [
  // 每户北墙（y19）+ 门洞；竖隔墙放在 39 / 45 / 51
  { y: 19, x0: 40, x1: 44, gap: [42, 43] },
  { y: 19, x0: 46, x1: 50, gap: [48, 49] },
  { y: 19, x0: 52, x1: 55, gap: [53, 54] },
  { x: 39, y: 19, h: 10 },
  { x: 45, y: 19, h: 10 },
  { x: 51, y: 19, h: 10 }
];
map.walls = westWalls.concat(townWalls);

/* ---------- 2) 道路（新增数据字段，代码里 paintRoads 读它） ---------- */
map.roads = [
  { x: 26, y: 16, w: 30, h: 3, note: "主街：花园东缘 → 地图东边界，紧贴三户房前" },
  { x: 42, y: 19, w: 2, h: 1, note: "喵酱家迎宾垫" },
  { x: 48, y: 19, w: 2, h: 1, note: "村长家迎宾垫" },
  { x: 53, y: 19, w: 2, h: 1, note: "博士家迎宾垫" },
  { x: 33, y: 19, w: 2, h: 7, note: "花园纵向小径：主街 → 塘边栈道" },
  { x: 26, y: 20, w: 2, h: 3, note: "办公室东门外的石板小院" }
];

/* ---------- 3) 路灯位置（沿主街 + 花园小径 + 塘边） ---------- */
const LAMPS = [
  { x: 30.5, y: 15.2 }, // 花园口
  { x: 38.5, y: 15.2 }, // 街口
  { x: 44.5, y: 15.2 },
  { x: 50.5, y: 15.2 },
  { x: 55.0, y: 15.2 },
  { x: 34.2, y: 20.5 }, // 花园小径
  { x: 34.4, y: 25.4 }  // 塘边栈道
];

/* ---------- 4) 光源（跟着灯走；一盏灯一个光斑） ---------- */
map.lights = LAMPS.map((l, i) => ({
  id: "bl_" + (i + 1),
  x: Math.round(l.x * 10) / 10,
  y: Math.round((l.y + 0.6) * 10) / 10,
  r: 1.8,
  a: 0.45,
  tint: 0xffd9a0
}));

/* ---------- 5) 三户房屋外观：挪到各自室内的正上方 ---------- */

const HOUSE_POS = { homeCat: { x: 42.2, y: 19.6 }, homeChief: { x: 48.2, y: 19.6 }, homeDoc: { x: 53.4, y: 19.6 } };
/* 个别家具给一个"重新设计后的固定位置"（比自动挪更整齐）：镇长街那张长椅落在人行道上 */
const PREFER = { townBench: { x: 47.6, y: 15.1 } };

/* ---------- 5.5) 区域锚点：市集/长椅的落点跟着家具走，别落在新马路上 ---------- */
const ZONE_FIX = {
  market:     { anchor: [49.6, 14.2] },   // 市集：人行道上，正对两个摊位
  town_bench: { anchor: [47.4, 14.1] }    // 长椅：椅背正上方一格，坐下不瞬移
};

/* ---------- 6) 家具：重新摆灯、挪房子、剔除压墙/压水/压田/压路的 ---------- */
const FARM = { x0: 28, y0: 22, cols: 5, rows: 4 };
const POND = { x0: 35.2, y0: 22.2, x1: 38.2, y1: 26.2 };

function inRect(x, y, r) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }
function inFarm(x, y) { return x >= FARM.x0 - 0.4 && x < FARM.x0 + FARM.cols + 0.4 && y >= FARM.y0 - 0.6 && y < FARM.y0 + FARM.rows + 0.6; }
function inPond(x, y) {   // 含 1.3 格宽的沙岸带
  const cx = (POND.x0 + POND.x1) / 2, cy = (POND.y0 + POND.y1) / 2;
  const rx = (POND.x1 - POND.x0) / 2 + 1.3, ry = (POND.y1 - POND.y0) / 2 + 1.3;
  return Math.pow((x + 0.5 - cx) / rx, 2) + Math.pow((y + 0.5 - cy) / ry, 2) <= 1;
}
function inWall(x, y) {
  return map.walls.some(w => {
    const tx = Math.floor(x), ty = Math.floor(y);
    if (w.x0 !== undefined) {   // 横墙
      const lo = w.gap ? w.gap[0] : -1e9, hi = w.gap ? w.gap[1] : -1e9;
      return ty === w.y && tx >= w.x0 && tx <= w.x1 && !(tx >= lo && tx <= hi);
    }
    const lo = w.gap ? w.gap[0] : -1e9, hi = w.gap ? w.gap[1] : -1e9;
    return tx === w.x && ty >= w.y && ty < w.y + w.h && !(ty >= lo && ty <= hi);
  });
}

const removed = [];
const moved = [];
const kept = [];
let lampIdx = 0;
map.furniture.forEach(f => {
  // 灯全部重摆
  if (f.a === "street-lamp") {
    const L = LAMPS[lampIdx++];
    if (L) { f.x = L.x; f.y = L.y; kept.push(f); }
    return;
  }
  // 三户房屋外观挪到室内正上方
  if (f.id && PREFER[f.id]) { f.x = PREFER[f.id].x; f.y = PREFER[f.id].y; kept.push(f); return; }
  if (f.id && HOUSE_POS[f.id]) {
    f.x = HOUSE_POS[f.id].x; f.y = HOUSE_POS[f.id].y;
    kept.push(f);
    return;
  }
  if (f.x == null || f.y == null) { kept.push(f); return; }   // on: 叠加物没有 x/y

  const blocked = (x, y) => {
    if (x < 0.4 || y < 0.4 || x > 55.6 || y > 29.9) return "越界";
    if (inFarm(x, y) && f.a !== "farm") return "压农田";
    if (inPond(x, y)) return "压鱼塘/沙岸";
    if (!f.wall && !f.o && inWall(x, y)) return "压在墙上";        // 墙饰（wall）本来就是挂墙上的
    if (map.roads.some(r => inRect(Math.floor(x), Math.floor(y), r))) return "压在路上";
    return null;
  };
  const why = blocked(f.x, f.y);
  if (!why) { kept.push(f); return; }

  // 附近找空位（同一房间内小幅挪动，优先横向、再纵向）
  const OFFS = [[1,0],[-1,0],[2,0],[-2,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[2,1],[-2,1],[2,-1],[-2,-1],[3,0],[-3,0]];
  for (const [dx, dy] of OFFS) {
    const nx = Math.round((f.x + dx) * 10) / 10, ny = Math.round((f.y + dy) * 10) / 10;
    if (!blocked(nx, ny)) {
      moved.push(`${f.a}${f.id ? "#" + f.id : ""} ${f.x},${f.y} → ${nx},${ny}（${why}）`);
      f.x = nx; f.y = ny;
      kept.push(f);
      return;
    }
  }
  removed.push(`${f.a}${f.id ? "#" + f.id : ""}@${f.x},${f.y} → ${why}（附近没空位）`);
});
map.furniture = kept;

/* 区域锚点微调 */
Object.keys(ZONE_FIX).forEach(function (k) {
  if (!map.zones[k]) return;
  Object.assign(map.zones[k], ZONE_FIX[k]);
});

fs.writeFileSync(MAP, JSON.stringify(map, null, 1) + "\n");
console.log(`walls=${map.walls.length} roads=${map.roads.length} lights=${map.lights.length} furniture=${map.furniture.length}`);
console.log("路灯：", LAMPS.map(l => l.x + "," + l.y).join(" | "));
console.log("\n挪动的家具（" + moved.length + "）：\n  " + moved.join("\n  "));
console.log("\n剔除的家具（" + removed.length + "）：\n  " + removed.join("\n  "));


