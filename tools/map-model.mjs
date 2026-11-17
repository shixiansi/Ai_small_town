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
import { ruleOf, canMount, canPlace, bodyOf, isVegetation, ASSET_RULES } from "./asset-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const read = f => fs.readFileSync(f, "utf8");

/* 房间名不再写死 —— 直接从 furniture.js 的 SWITCH_ROOM_RECTS 解析。
 * 以前这里是 `["office","bedroom",...,"nbDoc"]` 硬编码，加房间（v88 的 parkCourt/brickHall）
 * 就必然漏改：矩形加进了渲染层，工具却还按旧名单判，于是新房间里的家具全算"户外"。
 * 房间名单是数据不是常量，交还给唯一的源头文件。 */
export function roomKeysOf(furnSrc) {
  const keys = [];
  const re = /^\s*([A-Za-z]\w*)\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/gm;
  let m;
  while ((m = re.exec(furnSrc))) if (!keys.includes(m[1])) keys.push(m[1]);
  return keys;
}
export const ROOM_KEYS = (() => {
  try { return roomKeysOf(read(path.join(WEB, "src", "furniture.js"))); }
  catch { return ["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"]; }
})();

export function loadModel(opts = {}) {
  const map = JSON.parse(read(path.join(WEB, "map.json")));
  const man = JSON.parse(read(path.join(WEB, "assets", "manifest.json")));
  const furnSrc = read(path.join(WEB, "src", "furniture.js"));
  const roomSrc = read(path.join(WEB, "src", "room.js"));
  const T = map.room.tile, COLS = map.room.cols, ROWS = map.room.rows;

  // 房间矩形（与家具层同源；房间名单也现解析，别用模块级的旧快照）
  const rooms = {};
  roomKeysOf(furnSrc).forEach(k => {
    const m = new RegExp("\\b" + k + ":\\s*\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]").exec(furnSrc);
    if (m) rooms[k] = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
  });
  const roomOf = (x, y) => Object.keys(rooms).find(k => {
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
  /* v87：自定义层里除了家具，还有两种"覆盖 base"的条目，以前完全没被模型认：
   *   {a:"hide", k:"id:homeChief"}         → 运行时 mapedit.js:518 直接不建精灵，也不进碰撞
   *   {a:"move", k:"id:gardenBench2", x,y} → 把静态家具挪个位置
   * 后果：模型/审计算的是"游戏里并不存在的那张图"——比如三户邻居的房子其实被 hide 掉了，
   * 模型却仍按它们占格，于是凭空得出"房间内部被堵死"的 P1（第 41 轮就踩了这个）。
   * key 规则与运行时一致：有 id 用 "id:<id>"，没有用 "<asset>@<x>,<y>"。 */
  const hiddenKeys = new Set(), moveOverrides = new Map();
  try {
    const cj = JSON.parse(read(path.join(ROOT, "hub", "map.custom.json")));
    (cj.furniture || []).forEach(f => {
      if (f.a === "hide") { if (f.k) hiddenKeys.add(String(f.k)); return; }
      if (f.a === "move") { if (f.k) moveOverrides.set(String(f.k), { x: f.x, y: f.y }); return; }
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

  /* 每件家具的占格 —— 【与运行时 furniture.js buildBlockedGrid 逐字同口径】。
   *
   * 原来是自己的简化版（round(y-footH) 起一行 + round(x-wT/2+i) 一排），看着对，实际和运行时
   * 差一整列：运行时把排版坐标算成 p.x = f.x*TILE + TILE/2（f.x 是"第几列"，中心落在该列中央），
   * 左边缘 left = p.x - frameW/2、右边缘 right = left + bbox[2]，再 floor 到格。
   * 于是 **f.x 必须取整数才占一格**：f.x = 6.5 时 left 正好压在 6/7 之间的格线上，
   * 运行时会同时占 6 和 7 两列，而旧模型只说占 6 列 —— "算着不压锚点，门禁说压了"就是这么来的（§8 坑 2）。
   *
   * 结论（后续所有落位工具都按这个来）：
   *   f.x 取整数   → 横向占位对齐到格
   *   f.y 可带小数 → 只影响纵向贴图偏移，行号由 floor 决定
   */
  const WALL_H = Number(map.room.wallH || 48);
  /* 朝向相关的 bbox：manifest 的 bbox 只是"正面"那一行，转过的件要按当前帧所在行取（v45。
   * 影子/脚点/碰撞一起跟着变，运行时 placement.js 也是这么调的）。 */
  const bboxOf = f => {
    const m = man[f.a];
    if (!m) return null;
    const per = (m.rows && m.rows.South) || 1;
    const row = Math.max(0, Math.floor((f.frame || 0) / per));
    if (m.bboxRows && m.bboxRows[row]) return m.bboxRows[row];
    return m.bbox || [0, 0, m.frameW, m.frameH];
  };
  const cellsOf = f => {
    const m = man[f.a];
    if (!m) return [];
    if (f.on) return [];                       // 叠加物没有自己的坐标，跟着 host 走，不产生碰撞

    /* 【碰撞口径由 asset-rules 的 body 决定，foot 只服务 body="full" 的家具】
     *   body="none" → 无碰撞（挂墙 / 桌上 / 纯装饰）
     *   body="cell" → 只占主干 1 格（树 / 灌木 / 花：foot=[2,2] 是**树冠**，不是根部）
     *   body="full" → 用声明的 foot（整数格），没声明才退回 bbox 投影
     *
     * 踩过的坑：foot 一上来就无差别优先，结果橡树 foot=[2,2] 占了 4 格 ——
     * 一棵树把路压断了两格（E1「路断了」），而它本来只该占树干 1 格。 */
    const rb = ruleOf(f.a);
    const bodyKind = rb ? rb.body : "full";
    if (bodyKind === "none") return [];

    if (bodyKind === "cell") {
      const px2 = f.x * T + T / 2 + (f.ox || 0);
      const py2 = f.band ? WALL_H + (f.oy || 0) : (WALL_H + f.y * T + T / 2 + (f.oy || 0));
      return [Math.floor(px2 / T) + "," + Math.floor((py2 - WALL_H - 1) / T)];
    }

    if (Array.isArray(m.foot)) {
      const [fw, fh] = m.foot;
      const footRow = Math.floor(f.y);                       // y = row + 0.25 → floor 就是那一行
      const left = Math.round(f.x - fw / 2);                 // 以 f.x 为中心横向铺开
      const out = [];
      for (let gy = footRow - fh + 1; gy <= footRow; gy++)
        for (let gx = left; gx < left + fw; gx++) out.push(gx + "," + gy);
      return out;
    }

    // 兜底：没声明 foot 的素材仍按 bbox 投影（新增素材时应该补 foot 而不是依赖这条）
    const bbox = bboxOf(f);
    const px = f.x * T + T / 2 + (f.ox || 0);
    const py = f.band ? WALL_H + (f.oy || 0) : (WALL_H + f.y * T + T / 2 + (f.oy || 0));
    const s = typeof m.artScale === "number" ? m.artScale : 1;
    const footH = Math.min(12, bbox[3]) * s;
    const left = px - (bbox[2] * s) / 2;
    const right = left + bbox[2] * s;
    const top = py - footH;
    const out = [];
    for (let gy = Math.floor((top - WALL_H) / T); gy <= Math.floor((py - WALL_H - 1) / T); gy++)
      for (let gx = Math.floor(left / T); gx <= Math.floor((right - 1) / T); gx++)
        out.push(gx + "," + gy);
    return out;
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

  /* 应用 hide / move —— 运行时是什么样，模型就是什么样（否则后面每个判据都在算另一张图）。
   * 克隆一份再改，避免把坐标写回 map.furniture（那份是"磁盘上写的"，不是"实际显示的"）。 */
  const keyOf = f => (f.id ? "id:" + f.id : f.a + "@" + f.x + "," + f.y);
  /* 关键：**桌上件（on）没有自己的 x/y**，旧过滤条件 `typeof f.x === "number"`
   * 把它们整类排除出了模型 —— 于是针对 on 件的所有校验（E-HOST / E-TOP / host 是否存在）
   * 全部是空转，永远查不到东西。这正是"果盘躺地上、引擎却 33/33 全绿"的根因。
   * 现在 on 件也进模型（它们的坐标由 host 决定，读取时再解析）。 */
  let items = (map.furniture || []).concat(customFurn)
    .filter(f => (typeof f.x === "number" || f.on) && man[f.a] && f.a !== "move")
    .map(f => Object.assign({}, f));
  const hidden = items.filter(f => hiddenKeys.has(keyOf(f)));
  items = items.filter(f => !hiddenKeys.has(keyOf(f)));
  let movedCount = 0;
  items.forEach(f => {
    const mv = moveOverrides.get(keyOf(f));
    if (mv) { f.x = mv.x; f.y = mv.y; movedCount++; }
  });

  /* 给 on 件解析坐标：它们的 x/y 由 host 决定（运行时 makePlacement 也是这么做的）。
   * 不解析的话后面 placeOf / roomStrict / cellsOf 全拿到 undefined，
   * 结果就是"这件东西在哪个房间、是不是户外"永远算成户外 —— 又是一类假绿。 */
  items.forEach(f => {
    if (!f.on) return;
    const host = items.find(g => g.id === f.on);
    if (host && typeof host.x === "number") { f.x = host.x; f.y = host.y; f.hostResolved = true; }
  });

  // 阻挡格：第 0 行 + 墙 + 地形墙/水 + 落地家具
  const blocked = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  for (let x = 0; x < COLS; x++) blocked[0][x] = true;
  /* v2.9 D1 修复同步：北墙正门在第 0 行开成真门洞（与运行时 furniture.js buildBlockedGrid 一致，
   * 编辑层的地形墙也不许把门格焊死）。 */
  const doorCells = new Set();
  if (map.door && map.door.tx !== undefined) {
    for (let x = map.door.tx; x < map.door.tx + (map.door.tw || 1); x++) { blocked[0][x] = false; doorCells.add(x + ",0"); }   // cell 键序 x,y
  }
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
    if (doorCells.has(k)) return;   // 门洞格不放地形墙（D1 复发防线）
    const [x, y] = k.split(",").map(Number);
    if (blocked[y]) blocked[y][x] = true;
  });
  items.filter(solid).forEach(f => cellsOf(f).forEach(k => {
    const [x, y] = k.split(",").map(Number);
    if (blocked[y] && blocked[y][x] !== undefined) blocked[y][x] = true;
  }));
  /* 池塘椭圆阻挡（运行时 buildBlockedGrid 里同款公式）：水面不可走，岸边保持可走。
   * 之前模型里漏了这一段，于是"模型说可走、运行时走不进去"的格子在塘边成片存在。 */
  (map.blockers || []).forEach(b => {
    if (b.t !== "pond") return;
    const bx0 = Math.max(0, Math.floor(b.x0)), bx1 = Math.min(COLS - 1, Math.ceil(b.x1) - 1);
    const by0 = Math.max(0, Math.floor(b.y0)), by1 = Math.min(ROWS - 1, Math.ceil(b.y1) - 1);
    const ex = (b.x0 + b.x1) / 2, ey = (b.y0 + b.y1) / 2;
    const rx = (b.x1 - b.x0) / 2 + 0.12, ry = (b.y1 - b.y0) / 2 + 0.12;
    for (let py = by0; py <= by1; py++)
      for (let px = bx0; px <= bx1; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        if (Math.pow((cx - ex) / rx, 2) + Math.pow((cy - ey) / ry, 2) <= 1 && blocked[py]) blocked[py][px] = true;
      }
  });

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

  /* ==========================================================================
   * 摆放规则引擎（v2.9）—— 从"提示词约束"改成"引擎约束"的唯一实现
   *
   * 用户的原话：户外摆设不许进房间；墙上除了能挂的物品不许出现别的；
   * 地区要提前划分好；这些要从素材层就区分；违规要报错；
   * 物品要有碰撞体积，除了放桌上的，全部不许重叠。
   *
   * 于是这里给出四件事，check.mjs / place.mjs / 审计工具全部只读这里：
   *   layerOf(f)      这件东西该在哪个层（floor / wall / top）
   *   placeOf(f)      它现在实际在哪个层 / 室内还是室外
   *   bodyCellsOf(f)  它的碰撞体积（植被只占主干 1 格）
   *   layoutViolations()  全量违规清单（分区 / 层 / 重叠），违规就是错误
   * ========================================================================== */

  /** 该条目实际的挂载层：由数据字段推断，推断不出来就是 "floor" */
  const layerOf = f => {
    if (f.on) return "top";          // 叠在 host 上 = 桌面层
    if (f.wall) return "wall";       // 挂墙
    if (f.band) return "wall";       // 贴顶部墙带也属于墙面
    return "floor";
  };

  /** 该条目所在的场所："indoor" 或 "outdoor"（房间矩形内即 indoor）。
   * 注意用 roomStrict（严格矩形），不能用 roomOf —— 后者带 0.6 格容差，
   * 贴墙件会被误算进房间，然后反过来报"室外件进了房间"这种假违规。 */
  const roomStrict = (fx, fy) => {
    for (const k of Object.keys(rooms)) {
      const r = rooms[k];
      if (fx >= r.x && fx < r.x + r.w && fy >= r.y && fy < r.y + r.h) return k;
    }
    return null;
  };
  const placeOf = f => (roomStrict(f.x, f.y) ? "indoor" : "outdoor");

  /** 碰撞体积：
   *   body="none" → 无碰撞（挂墙件 / 桌上件 / 纯装饰）
   *   body="cell" → 只占主干那 1 格（树/灌木/花：树冠交叠是像素游戏的正常表现）
   *   body="full" → 整块 bbox 底部投影（家具/设施的硬碰撞）
   */
  const bodyCellsOf = f => {
    const rb = ruleOf(f.a);
    if (!rb) return null;                     // 未登记分类 → 调用方必须当错误
    if (rb.body === "none") return [];
    if (rb.body === "cell") {
      if (f.on) return [];
      const T2 = T;
      const px2 = f.x * T2 + T2 / 2 + (f.ox || 0);
      const py2 = f.band ? WALL_H + (f.oy || 0) : (WALL_H + f.y * T2 + T2 / 2 + (f.oy || 0));
      const gx = Math.floor(px2 / T2);
      const gy = Math.floor((py2 - WALL_H - 1) / T2);
      return [gx + "," + gy];
    }
    return cellsOf(f);                        // full
  };
  const hasBody = f => {
    const rb = ruleOf(f.a);
    return !!(rb && rb.body !== "none");
  };

  /* 全量违规清单。每条都带 code，方便门禁逐类统计、也方便按清单修数据。
   *   E-UNKNOWN   素材没登记分类（无法判定 = 不许进场）
   *   E-PLACE     室外专用件被放进房间，或室内专用件被放在户外
   *   E-LAYER     挂载层不对（墙上出现地面件 / 地面件被标成挂墙 / 桌上件没有 host）
   *   E-OVERLAP   家具或设施互相重叠（植被之间豁免）
   *   E-WALL      非挂墙件占了墙格
   *   E-ROAD      落地件压在道路上
   *   E-HOST      桌上件引用的 host 不存在或是自身        */
  const layoutViolations = () => {
    const out = [];
    const push = (code, f, msg, extra) => out.push(Object.assign({
      code, asset: f.a, id: f.id || null, x: f.x, y: f.y,
      room: roomStrict(f.x, f.y), msg
    }, extra || {}));

    items.forEach(f => {
      const rb = ruleOf(f.a);
      if (!rb) { push("E-UNKNOWN", f, "素材 " + f.a + " 没有在 tools/asset-rules.mjs 登记分类"); return; }

      const layer = layerOf(f), where = placeOf(f);

      // 1) 分区：室内件 / 室外件
      if (!canPlace(f.a, where)) {
        push("E-PLACE", f, (where === "indoor" ? "室外专用件被放进了房间（" + roomStrict(f.x, f.y) + "）"
                                            : "室内专用件被放在了户外"), { where, want: rb.place });
      }

      // 2) 挂载层
      if (!canMount(f.a, layer)) {
        push("E-LAYER", f, "挂载层不对：它现在是 " + layer + "，允许 " + rb.mount.join("/"), { layer, want: rb.mount });
      }

      // 3) 桌上件必须有合法 host
      /* 关键补充（用户截图抓到的那条）：**只能放桌上的物件，落地了要报 E-TOP**。
       * 之前只在 f.on 存在时才查 host 是否合法，于是"果盘压根没写 on、直接躺在地上"
       * 这种情况既不触发 E-LAYER（因为它就是 floor）、也不触发 E-HOST（因为没有 on），
       * 整套引擎全绿，可画面上果盘就在地砖上。判定缺口就在这里。 */
      const topOnly = rb.mount.length === 1 && rb.mount[0] === "top";
      if (topOnly && !f.on) {
        push("E-TOP", f, "只能放桌面/台面上的物件被直接摆在了地上（缺 on 指向一个 host）", { layer });
      }
      if (f.on) {
        const host = items.find(g => g.id === f.on);
        if (!host) push("E-HOST", f, "桌上件引用的 host 「" + f.on + "」不存在");
        else if (host === f) push("E-HOST", f, "host 指向自己");
        else if (!["floor", "floor_or_top"].some(mk => canMount(host.a, "floor"))) {
          push("E-HOST", f, "host「" + f.on + "」(" + host.a + ") 本身不是可承载的家具");
        }
        /* E-ANCHOR（渲染定位缺口）：桌上件的**画面位置完全由 dx/dy 决定**，
         * 运行时是 y = (host.y - host.bbox[3]) + dy。缺 dx/dy 时默认落 0，
         * 物体会贴在"宿主内容顶边"，视觉上像是悬在半空/躺在地上 ——
         * 而数据、碰撞、房间归属全是对的，所以任何几何判据都发现不了。
         * 这一条是用户第二次截图"这真的改了吗"的直接原因：
         * 我给果盘补了 on，却忘了给 dx/dy，于是 check 全绿、画面没变。
         * 缺省时**必须显式写 0 或具体偏移**，不许留空。 */
        if (typeof f.dx !== "number" || typeof f.dy !== "number") {
          const miss = [typeof f.dx !== "number" ? "dx" : null, typeof f.dy !== "number" ? "dy" : null].filter(Boolean);
          push("E-ANCHOR", f, "桌上件缺 " + miss.join("/") + "（画面位置全靠它，缺省=贴宿主顶边，看着像浮空/落地）");
        }
      }

      // 4) 非挂墙件占墙格
      if (layer !== "wall" && rb.body !== "none") {
        const onWall = bodyCellsOf(f).filter(k => wallCells.has(k));
        if (onWall.length) push("E-WALL", f, "占了墙格 " + onWall.join(" "), { cells: onWall });
      }

      // 5) 落地件压路
      if (layer === "floor" && rb.body === "full") {
        const onRoad = bodyCellsOf(f).filter(k => roadCells.has(k));
        if (onRoad.length) push("E-ROAD", f, "压在道路上 " + onRoad.join(" "), { cells: onRoad });
      }
    });

    // 6) 重叠：家具/设施一律不许重叠；植被之间豁免（用户拍板）
    const withBody = items.filter(f => hasBody(f));
    const occ = new Map();
    withBody.forEach(f => bodyCellsOf(f).forEach(k => {
      if (!occ.has(k)) occ.set(k, []);
      occ.get(k).push(f);
    }));
    const reported = new Set();
    occ.forEach((list, cell) => {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const A = list[i], B = list[j];
        if (isVegetation(A.a) && isVegetation(B.a)) continue;   // 植被互叠豁免
        const key = [(A.id || A.a), (B.id || B.a)].sort().join("|");
        if (reported.has(key)) continue;
        reported.add(key);
        push("E-OVERLAP", A, "与 " + (B.id || B.a) + "(" + B.a + "@" + B.x + "," + B.y + ") 重叠于 " + cell,
          { other: B.id || B.a, otherAsset: B.a, cell });
      }
    });

    return out;
  };

  return {
    map, man, T, COLS, ROWS, rooms, roomOf, roomStrict, material, items, solid, cellsOf, roadCells, conflictsOf, protectedSet,
    customFloor, customTerrain, customFurn, anchors, anchorCells,
    wallCells, wallTouch, touchesWall,
    hiddenKeys, moveOverrides, hidden, movedCount,
    layerOf, placeOf, bodyCellsOf, hasBody, layoutViolations,
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
    /* 门禁的输出是 "         ✗ sofa 锚点 [7,28] 落在阻挡格里，A* 会漂走"。
     * 原来这里的正则以 ^(\S+) 开头，碰上 "✗ " 前缀永远匹配不上 —— 于是不管门禁报多少条，
     * reported 都是空的，对账恒定输出"全部一致"。假绿比红更坏：它让人相信两套模型没分叉。 */
    const m = /✗\s+(\S+)\s+锚点\s+\[(\d+),(\d+)\]\s+落在阻挡格里/.exec(line);
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
