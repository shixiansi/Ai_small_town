#!/usr/bin/env node
/**
 * 落位执行器（tools/place.mjs）—— 用"格"说话，别手算 x/y 小数
 *
 * 这个项目反复翻车的根因是半格误差（§8 坑 2）：手写 f.y = 27.6 以为是第 28 行，
 * 实际 cellsOf 用 round(y - footH) 算出来是第 27 行，于是"算着贴墙、门禁说没贴"。
 * 本工具把这句话反过来：你只给"要占哪一格"，坐标由 cellsOf 自己反解，
 * 落完立刻报占格 / 贴墙 / 冲突 / 压锚点 / 压路 —— 全部走 map-model，不另算一套。
 *
 *   node tools/place.mjs --id=ofFile2 --cell=11,28            # 只预览（默认不写盘）
 *   node tools/place.mjs --id=ofFile2 --cell=11,28 --apply    # 写入 web/map.json
 *   node tools/place.mjs --id=sofaA --cell=5,28 --anchor=tea:4,27 --apply
 *   node tools/place.mjs --list --room=office                 # 列房间内每件的占格与宽度
 *
 * 约定：--cell=x,y 给的是**该件占格的最左格**和**脚底所在行**（就是 ASCII 图上的格子）。
 */
import fs from "node:fs";
import path from "node:path";
import { loadModel } from "./map-model.mjs";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mapPath = path.join(ROOT, "web", "map.json");

const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("="); return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));

let model = loadModel();
const { man, T, COLS, ROWS, cellsOf, solid, items, anchorCells, roadCells, conflictsOf, wallTouch, roomOf, rooms } = model;

/** 该件在一次落位里会占几格宽（决定 --cell 的起点对不对） */
const footOf = f => {
  const m = man[f.a] || {};
  const sc = Number(f.sc || 1);
  const bb = m.bbox || [0, 0, 48, 48];
  const pxW = Number(m.frameW || m.fw || bb[2] || 48) * sc;
  const pxH = Number(m.frameH || m.fh || bb[3] || 48) * sc;
  return { wT: Math.max(1, pxW / T), fh: Math.min(12, pxH) / T };
};

/** 反解：让占格正好落在 [cx, …] × row
 *
 *  横向：**优先取整数 f.x** —— 运行时 p.x = f.x*TILE + TILE/2，f.x 取整数时贴图才正好落在这一列；
 *        取 6.5 会让左边缘压在格线上，运行时同时占 6、7 两列（旧 solver 正好犯这个错）。
 *  纵向：f.y 取 row + 0.25。这个值同时满足三套口径，别乱改：
 *        · 运行时/门禁的脚底行 = floor(f.y + 0.5 - footH/T)…floor(f.y + 0.5 - 1/T) → row
 *        · map-audit 的 H1「家具踩在墙上」用的是 floor(f.y) → 必须等于 row
 *        取 row - 0.25 时脚底行也是 row，但 floor(f.y) 变成 row-1，H1 会报"踩在墙上"（假警报）。 */
const solve = (f, cx, row) => {
  const test = (x, y) => cellsOf(Object.assign({}, f, { x, y }));
  const xs = [cx];
  for (let d = 1; d <= 10; d++) { xs.push(cx - d / 10, cx + d / 10); }
  const ys = [];
  for (let d = 0; d <= 10; d++) {
    for (const s of (d === 0 ? [0] : [-1, 1])) {
      const y = Math.round((row + 0.25 + s * d / 20) * 100) / 100;
      if (y >= row && y < row + 0.5) ys.push(y);
    }
  }
  for (const x of xs) {
    for (const y of ys) {
      const cs = test(x, y);
      if (!cs.length) continue;
      const cols = cs.map(k => +k.split(",")[0]);
      const rows = cs.map(k => +k.split(",")[1]);
      if (!rows.every(r => r === row)) continue;
      if (Math.min(...cols) !== cx) continue;
      if (new Set(cs).size !== cs.length) continue;
      return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, cells: cs };
    }
  }
  return null;
};

const report = (f, label) => {
  const cs = cellsOf(f);
  const wt = wallTouch(f);
  /* 同格叠件：故意不做"同素材互叠豁免"（密林/花丛那种豁免在 audit 里够了）。
   * 这里问的是"这一格是不是已经被别的东西占着"——两张椅子叠在同一格必须报出来，
   * 而 conflictsOf 因为同 a 会放过它（现状里 ofMeetC2 与 f0023 就叠在 6,25）。 */
  const same = g => (f.id && g.id ? g.id === f.id : g === f);
  const stack = items.filter(g => g !== f && !same(g) && solid(g) && cellsOf(g).some(c => cs.includes(c)));
  const anchorHit = cs.filter(c => Object.keys(model.anchors).some(k => model.anchors[k].x + "," + model.anchors[k].y === c && !model.anchors[k].decorative));
  const roadHit = cs.some(c => roadCells.has(c));
  /* "压墙/压件"必须排除这件家具自己 —— entry 来自另一次 JSON.parse，和 model.items 里的不是同一个对象，
   * 只按引用比较会把自己算成阻挡，于是每一件都报红。按 id 排除。 */
  const blockedCells = cs.filter(k => {
    const [x, y] = k.split(",").map(Number);
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return true;
    if (model.wallCells.has(k) || model.customTerrain.has(k)) return true;
    return items.filter(g => !same(g) && solid(g)).some(g => cellsOf(g).includes(k));
  });
  console.log("  " + label.padEnd(6) + "x=" + String(f.x).padEnd(7) + "y=" + String(f.y).padEnd(7) +
    "格=" + cs.join(" ").padEnd(22) +
    "贴墙:" + (wt === "ok" ? "ok " : wt === "on-wall" ? "⚠墙里" : "none") +
    (stack.length ? "  叠件:" + stack.map(g => g.id || g.a).join(",") : "") +
    (anchorHit.length ? "  ⚠占住锚点:" + anchorHit.join(",") : "") +
    (roadHit ? "  ⚠压路" : "") +
    (blockedCells.length ? "  ⚠压墙/压件:" + blockedCells.join(" ") : ""));
  return { wt, stack, anchorHit, roadHit, blockedCells, cs };
};

if (arg.list) {
  const only = arg.room ? String(arg.room) : null;
  items.filter(f => solid(f)).forEach(f => {
    if (only && roomOf(f.x, f.y) !== only) return;
    const cs = cellsOf(f);
    const cols = cs.map(k => +k.split(",")[0]);
    const straddle = new Set(cols).size > 1 && Number.isInteger(Math.min(...cols)) === false;
    console.log(String(f.id || "-").padEnd(15) + f.a.padEnd(18) + ("@" + f.x + "," + f.y).padEnd(15) +
      "格=" + cs.join(" ").padEnd(20) + "格数=" + cs.length +
      (!Number.isInteger(f.x) ? "  ⚠f.x 非整数（会跨列）" : "") +
      (straddle ? "  ⚠跨列" : ""));
  });
  process.exit(0);
}

if (!arg.id || !arg.cell) {
  console.log("用法：node tools/place.mjs --id=<家具id> --cell=<x>,<row> [--anchor=<zone>:<x>,<row>] [--apply]");
  console.log("      node tools/place.mjs --list --room=office");
  process.exit(1);
}

const mj = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const [cx, row] = String(arg.cell).split(",").map(Number);
const idx = mj.furniture.findIndex(f => f.id === arg.id);
if (idx < 0) {
  /* 编辑器加的家具在 hub/map.custom.json 里，不在 web/map.json —— 本工具只改 base 层。
   * 明说清楚，别让人以为"这件不存在"（踩过一次：椅子在自定义层，place 报找不到）。 */
  let inCustom = false;
  try {
    const cj = JSON.parse(fs.readFileSync(path.join(ROOT, "hub", "map.custom.json"), "utf8"));
    inCustom = (cj.furniture || []).some(f => f.id === arg.id);
  } catch {}
  if (inCustom) {
    console.log("✗ id = " + arg.id + " 在 hub/map.custom.json（编辑器层），不在 web/map.json。");
    console.log("  本工具只管 base 层。改自定义层的件请直接编辑 hub/map.custom.json 的 x/y，");
    console.log("  或先在编辑器里挪；改完 hub 会在 1.5s 内自动热重载（见 RULES §8 坑 11）。");
  } else {
    console.log("✗ map.json 和 hub/map.custom.json 里都没有 id = " + arg.id);
  }
  process.exit(1);
}

const entry = mj.furniture[idx];
const before = { x: entry.x, y: entry.y };
console.log("\n" + arg.id + "  " + entry.a + (entry.sc ? "  sc=" + entry.sc : "") + (entry.flipX ? "  flipX=1" : ""));
report(entry, "旧");

const solved = solve(entry, cx, row);
if (!solved) {
  const { wT } = footOf(entry);
  console.log("  ✗ 找不到能正好落在 " + cx + "," + row + " 的坐标（该件占 " + wT.toFixed(2) + " 格宽，用法见 --list）");
  process.exit(1);
}
entry.x = solved.x; entry.y = solved.y;
const after = report(entry, "新");

// 锚点（可选）：同一个 zone 的 anchor 一起挪，才能保持"锚点 = host + 朝向 1.2 格"
if (arg.anchor) {
  const [zoneName, pos] = String(arg.anchor).split(":");
  const [ax, ay] = pos.split(",").map(Number);
  if (!mj.zones[zoneName]) { console.log("  ✗ 没有 zone " + zoneName); process.exit(1); }
  const oldA = mj.zones[zoneName].anchor;
  mj.zones[zoneName].anchor = [ax, ay];
  console.log("  锚点 " + zoneName + ": [" + oldA + "] → [" + ax + "," + ay + "]");
  /* 锚点必须可站，且不能被这件家具自己占着。
   * 注意 blocked 来自"落位前"的模型，所以这里只做这两条能确定判定的检查；
   * 真正的可走性由 bust → check（锚点落在阻挡格里）最终裁决。 */
  if (after.cs.includes(ax + "," + ay)) console.log("  ⚠ 锚点 (" + ax + "," + ay + ") 正被这件家具占着 —— 要站到占格旁边一格");
  else if (model.isBlocked(ax, ay)) console.log("  ⚠ 锚点 (" + ax + "," + ay + ") 在旧模型里就不可走 —— 门禁会拦");
}

if (arg.apply) {
  fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
  console.log("\n  ✓ 已写入 web/map.json（记得跑 bust → check）");
} else {
  console.log("\n  （预览，未写盘；加 --apply 落盘）");
}
