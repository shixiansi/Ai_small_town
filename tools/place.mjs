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
      /* 多行占格（如 foot=[2,2] 的双人床）必须支持：
       * 旧判断要求"所有格都在同一行"，2×2 的床永远解不出来（报"找不到坐标"）。
       * 现在：行必须**连续且末行 = 目标行**（脚点落在目标行），列左缘 = 目标列。 */
      const rowSet = [...new Set(rows)].sort((a, b) => a - b);
      const contiguous = rowSet.every((r, i) => i === 0 || r === rowSet[i - 1] + 1);
      if (!contiguous) continue;
      if (Math.max(...rows) !== row) continue;
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

/* 桌上物件（mount 只有 top）没有自己的坐标，它跟着 host 走。
 * 用 --cell 想把它"放地上"必须直接拒绝，而且要说清原因 ——
 * 这正是用户截图里"果盘躺在地砖上"的入口：以前它只是"解不出来"，报错很难懂。 */
{
  const r0 = (await import("./asset-rules.mjs")).ruleOf(entry.a);
  if (r0 && r0.mount.length === 1 && r0.mount[0] === "top") {
    console.log("  ✗ " + entry.a + " 是**桌上物品**（mount 只有 top），它没有自己的坐标，只能挂在 host 上。");
    console.log("     要换位置请改它的 on 指向哪件家具，例如：");
    console.log("       在 web/map.json 里把该条目的 on 改成目标家具的 id（去掉 x/y）");
    console.log("     若它现在就在桌上，说明它已经是合法的，不需要再用 --cell 落位。");
    process.exit(1);
  }
}
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

/* ==========================================================================
 * 摆放规则引擎：**落位前硬阻断**
 *
 * 这是用户要求的核心："这些应该做成硬性约束……应该有违反的摆放会报错，
 * 应该做成引擎而不是提示词的约束。"
 *
 * 于是 place.mjs 不再只是"报几个 ⚠ 让人自己看"—— 它会在写盘之前，
 * 用与门禁同一套判据（map-model.layoutViolations + asset-rules 分类）
 * 检查"这一件挪过去之后会不会违规"，违规就**拒绝落盘**。
 *
 *   node tools/place.mjs --id=fence1 --cell=10,2      → ✗ 拒绝（室外件不能进房间）
 *   node tools/place.mjs --id=fence1 --cell=10,2 --force → 明确豁免（会打印为什么危险）
 * ========================================================================== */
{
  // 把待落位的这件也带进模型一起判定，才能发现"压到别人"这类问题
  const rb = (await import("./asset-rules.mjs")).ruleOf(entry.a);
  if (!rb) {
    console.log("\n  ✗ 素材 " + entry.a + " 没有在 tools/asset-rules.mjs 登记分类 —— 无法判定合法性，拒绝落盘。");
    console.log("     先补分类，再落位（未登记 = 不许进场）。");
    process.exit(1);
  }
  /* 层判定必须看"这件东西落到目标位置之后会处于哪一层"，不能只看它原来的标记。
   * 坑：窗帘 entry.wall=true，把它拖到房间中央，wall 标记还在，于是层仍算 wall、
   * 规则放行 —— 但它其实已经悬在地面上了。判定口径与运行时的层语义对齐：
   *   on      → top（叠在 host 上）
   *   band    → wall（贴顶部墙带）
   *   wall 且**目标格确实挨着/压着墙** → wall
   *   wall 但目标格完全脱离墙面 → 它已经在空地上了，按 floor 判（会被规则拦下） */
  const targetCells = model.cellsOf(entry);
  const nearWall = targetCells.some(k => {
    const [kx, ky] = k.split(",").map(Number);
    return model.wallCells.has(k) ||
      model.wallCells.has((kx + 1) + "," + ky) || model.wallCells.has((kx - 1) + "," + ky) ||
      model.wallCells.has(kx + "," + (ky + 1)) || model.wallCells.has(kx + "," + (ky - 1));
  });
  const layer = entry.on ? "top" : entry.band ? "wall" : entry.wall ? (nearWall ? "wall" : "floor") : "floor";
  const { canMount: cm, canPlace: cp } = await import("./asset-rules.mjs");
  const where = model.roomStrict(entry.x, entry.y) ? "indoor" : "outdoor";
  const probs = [];
  if (!cp(entry.a, where)) {
    probs.push((where === "indoor" ? "室外专用件不能放进房间" : "室内专用件不能放在户外")
      + "（该素材 place=" + rb.place + "）");
  }
  if (!cm(entry.a, layer)) probs.push("挂载层不对：现在是 " + layer + "，允许 " + rb.mount.join("/") + "（墙/地/桌三层不能用错）");

  // 用模型的真实判定跑一遍"落位后"的检查：临时构造一个只含本件的探测
  const probe = Object.assign({}, entry);
  const body = model.bodyCellsOf(probe);
  const clash = [];
  if (body) {
    const others = model.items.filter(f => (f.id || f.a) !== (entry.id || entry.a) && model.hasBody(f));
    for (const o of others) {
      const oc = model.bodyCellsOf(o);
      if (!oc) continue;
      const shared = body.filter(k => oc.includes(k));
      if (!shared.length) continue;
      const { isVegetation: iv } = await import("./asset-rules.mjs");
      if (iv(entry.a) && iv(o.a)) continue;     // 植被互叠豁免
      clash.push((o.id || o.a) + "(" + o.a + ")@" + o.x + "," + o.y + " 重叠于 " + shared.join(" "));
    }
  }
  const onWall = body ? body.filter(k => model.wallCells.has(k)) : [];
  const onRoad = body ? body.filter(k => model.roadCells.has(k)) : [];
  if (layer !== "wall" && onWall.length) probs.push("占了墙格 " + onWall.join(" ") + "（只有挂墙件能上墙）");
  if (layer === "floor" && onRoad.length) probs.push("压在道路上 " + onRoad.join(" "));
  clash.slice(0, 5).forEach(c => probs.push("与已有物件重叠：" + c));

  if (probs.length) {
    console.log("\n  ✗ 摆放规则不允许这个位置（引擎约束，不是建议）：");
    probs.forEach(p => console.log("      · " + p));
    if (arg.force) {
      console.log("\n  ! 你用了 --force：明知违规仍然落盘。门禁 check.mjs 会把它当成错误报出来。");
    } else {
      console.log("\n  换一个位置，或先确认 tools/asset-rules.mjs 里该素材的分类是否正确。");
      console.log("  确实要强行落盘：加 --force（门禁仍会报错）。");
      process.exit(1);
    }
  } else {
    console.log("  ✓ 摆放规则通过（分区 / 挂载层 / 碰撞 都合法）");
  }
}

if (arg.apply) {
  fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
  console.log("\n  ✓ 已写入 web/map.json（记得跑 bust → check）");
} else {
  console.log("\n  （预览，未写盘；加 --apply 落盘）");
}
