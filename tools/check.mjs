#!/usr/bin/env node
/**
 * office 静态自检 —— 不开浏览器，把前几轮踩过的坑一次性挡住。
 *
 *   node office/tools/check.mjs
 *
 * 覆盖范围（与浏览器内 __officeCtl.zoneAudit() 同一套判定，坐标推导复刻 makePlacement /
 * buildBlockedGrid，避免「静态说没问题、画面全错」）：
 *   JSON / 常量一致性 / 状态→区域引用 / 锚点越界与阻挡 / 区域语义家具(2.2格) /
 *   坐席宿主 / 家具资产·on引用·帧号 / 作息与调试台状态名 / hub 状态清单双向一致 /
 *   线上调试台保护·hub 白名单与持久化·aria 防回退 / 鲸鱼女仆精灵表与动作帧 / 部署文件清单 /
 *   资源版本号 / 本地生活事件表（区域·动作·房间分布防回退）/ 画布文字缩放防回退 /
 *   画布铺满容器·调试台重排（防宽屏左右留白）
 *
 * 典型用法：改完 STATE_MAP、hub/states.json、hub/schedule.json、map.json 或 sync_web.sh 后跑一次；
 * sync_web.sh 已把它接成上线门禁，失败即中止同步。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { dryRun } from "./bust.mjs";
import { build, buildRaw } from "./build.mjs";
import { simulate } from "./beat-audit.mjs";

const OFFICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(OFFICE, "web");
const ASSETS = path.join(WEB, "assets");
const read = f => fs.readFileSync(f, "utf8");
const norm = s => String(s).replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
const results = [];

function check(name, fn) {
  try {
    const r = fn() || {};
    results.push({ name, problems: r.problems || [], warnings: r.warnings || [], note: r.note || "" });
  } catch (e) {
    results.push({ name, problems: ["抛出异常: " + e.message], warnings: [], note: "" });
  }
}

// ---------- 载入 ----------
let map, manifest, officeSrc, indexSrc, shSrc, dbgSrc, hubSrc, statesJson = null, scheduleJson = null;
try {
  map = JSON.parse(read(path.join(WEB, "map.json")));
  manifest = JSON.parse(read(path.join(ASSETS, "manifest.json")));
  officeSrc = buildRaw();   // 源码检查用"未压缩拼接"，产物压缩后注释/缩进会变
  indexSrc = read(path.join(WEB, "index.html"));
  dbgSrc = read(path.join(WEB, "debug.js"));
  hubSrc = read(path.join(OFFICE, "hub", "hub.mjs"));
  shSrc = read(path.join(OFFICE, "sync_web.sh"));
  try { statesJson = JSON.parse(read(path.join(OFFICE, "hub", "states.json"))); } catch { /* 由专门一项报错 */ }
  try { scheduleJson = JSON.parse(read(path.join(OFFICE, "hub", "schedule.json"))); } catch { /* 由第 18 项报错 */ }
  /* v88：门禁必须看见自定义层的家具 —— 否则"坐席宿主 <某个编辑器里加的椅子>"会被判成
   * "宿主不存在"，而运行时它明明在。这跟 §8 坑 12（hide/move 模型不认）是同一类病：
   * 判据看的是 map.json，玩家看的是 map.json + map.custom.json。
   * 这里只做最小必要的事：把自定义层的**家具条目**并进 map.furniture（floor/terrain/hide/move 不是家具）。
   * 注意 hide 掉的件不该被当成宿主，所以先按 key 剔掉。 */
  try {
    const cj = JSON.parse(read(path.join(OFFICE, "hub", "map.custom.json")));
    const hidden = new Set((cj.furniture || []).filter(f => f.a === "hide" && f.k).map(f => String(f.k)));
    const moves = new Map((cj.furniture || []).filter(f => f.a === "move" && f.k).map(f => [String(f.k), { x: f.x, y: f.y }]));
    const keyOf = f => (f.id ? "id:" + f.id : f.a + "@" + f.x + "," + f.y);
    map.furniture = map.furniture.filter(f => !hidden.has(keyOf(f)));
    map.furniture.forEach(f => { const mv = moves.get(keyOf(f)); if (mv) { f.x = mv.x; f.y = mv.y; } });
    (cj.furniture || []).forEach(f => {
      if (f.a === "floor" || f.a === "terrain" || f.a === "hide" || f.a === "move") return;
      if (typeof f.x !== "number" || typeof f.y !== "number") return;
      if (!manifest[f.a]) return;                       // 资产不认识的留给第 6 项去报
      if (hidden.has(keyOf(f))) return;
      map.furniture.push(f);
    });
  } catch { /* 自定义层缺失/损坏时保持原样，别把整条门禁带崩 */ }
} catch (e) {
  console.error("[FAIL] 读取/解析基础文件失败: " + e.message);
  process.exit(1);
}

const TILE = map.room.tile, COLS = map.room.cols, ROWS = map.room.rows, WALL_H = map.room.wallH;
const zones = map.zones || {};

// ---------- 解析 office.js 里的状态表与常量 ----------
function parseStateMap() {
  const i = officeSrc.indexOf("var STATE_MAP = {");
  const j = officeSrc.indexOf("\n  };", i);
  if (i < 0 || j < 0) throw new Error("找不到 STATE_MAP 定义");
  const block = officeSrc.slice(i, j), out = {};
  const re = /^\s{4}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(block))) {
    const b = m[2];
    out[m[1]] = {
      zone: /zone:\s*"([^"]+)"/.exec(b)?.[1],
      act: /act:\s*"([^"]+)"/.exec(b)?.[1],
      verb: /verb:\s*"([^"]+)"/.exec(b)?.[1],
      mood: /mood:\s*"([^"]+)"/.exec(b)?.[1]
    };
  }
  if (!Object.keys(out).length) throw new Error("STATE_MAP 解析为空");
  return out;
}
function parseActive() {
  const i = officeSrc.indexOf("var ACTIVE_STATES = [");
  const j = officeSrc.indexOf("];", i);
  if (i < 0 || j < 0) return [];
  return [...officeSrc.slice(i, j).matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map(x => x[1]);
}

// ---------- 复刻 makePlacement / buildBlockedGrid ----------
function placement(f, host) {
  const m = manifest[f.a];
  if (!m) return null;
  const bbox = m.bbox || [0, 0, m.frameW, m.frameH];
  let x, y;
  if (f.on && host) {
    x = host.x + (f.dx || 0);
    y = (host.y - host.bbox[3]) + (f.dy || 0);
  } else {
    x = f.x * TILE + TILE / 2 + (f.ox || 0);
    y = WALL_H + f.y * TILE + TILE / 2 + (f.oy || 0);
  }
  return { x, y, bbox, m, key: f.a, f, tx: (x - TILE / 2) / TILE, ty: (y - WALL_H - TILE / 2) / TILE };
}
function buildProps() {
  const hosts = {};
  // 第一遍：只有落地家具会被注册进 hostMap（叠加物此时还不可引用）
  map.furniture.filter(f => !f.on).forEach(f => { if (f.id) hosts[f.id] = placement(f, null); });
  const props = [];
  map.furniture.forEach(f => {
    const p = placement(f, f.on ? hosts[f.on] : null);
    props.push(p);
    if (f.id && p) hosts[f.id] = p;
  });
  return { props, hosts };
}
function buildGrid(props) {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
  for (let x = 0; x < COLS; x++) grid[0][x] = 1;
  /* 必须区分竖墙 / 横墙 —— 竖墙对象带 {x,y,h}，横墙带 {y,x0,x1}。
   * 这里原来丢了 isH 判定，把竖墙也按"整列全堵"处理（忽略 y/h），于是 x=10/16/25 三列
   * 在**整张图**的所有行上都是阻挡格：办公室正中凭空多出三条走不进去的走廊。
   * 运行时 furniture.js 的 buildBlockedGrid 是正确的（v24 已按 isH 分叉，见那里的 P0-1 注释），
   * 是这条"复刻"没跟上 —— 复刻和实现分叉，正是 §2 说的事。
   * 表现：把白板放到 (16,16) 后，锚点 (16,17) 被门禁判成"落在阻挡格里"，而运行时不挡。 */
  (map.walls || []).forEach(wl => {
    const isH = wl.x0 !== undefined;
    if (!isH) {
      for (let wy = wl.y; wy < wl.y + wl.h; wy++) {
        if (wl.gap && wy >= wl.gap[0] && wy <= wl.gap[1]) continue;
        if (grid[wy]) grid[wy][wl.x] = 1;
      }
    } else {
      for (let wx = wl.x0; wx <= wl.x1; wx++) {
        if (wl.gap && wx >= wl.gap[0] && wx <= wl.gap[1]) continue;
        if (grid[wl.y]) grid[wl.y][wx] = 1;
      }
    }
  });
  props.forEach(p => {
    if (!p || p.f.wall || p.f.o || p.f.on) return;
    const footH = Math.min(12, p.bbox[3]);
    const left = p.x - p.m.frameW / 2 + p.bbox[0];
    const right = left + p.bbox[2];
    const top = p.y - footH;
    for (let gy = Math.floor((top - WALL_H) / TILE); gy <= Math.floor((p.y - WALL_H - 1) / TILE); gy++)
      for (let gx = Math.floor(left / TILE); gx <= Math.floor((right - 1) / TILE); gx++)
        if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) grid[gy][gx] = 1;
  });
  // 阻挡区块（v37 与前端 buildBlockedGrid 同步）：水面椭圆内格子不可走
  (map.blockers || []).forEach(b => {
    if (b.t !== "pond") return;
    const bx0 = Math.max(0, Math.floor(b.x0)), bx1 = Math.min(COLS - 1, Math.ceil(b.x1) - 1);
    const by0 = Math.max(0, Math.floor(b.y0)), by1 = Math.min(ROWS - 1, Math.ceil(b.y1) - 1);
    const ex = (b.x0 + b.x1) / 2, ey = (b.y0 + b.y1) / 2;
    const rx = (b.x1 - b.x0) / 2 + 0.12, ry = (b.y1 - b.y0) / 2 + 0.12;
    for (let py = by0; py <= by1; py++)
      for (let px = bx0; px <= bx1; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        if (Math.pow((cx - ex) / rx, 2) + Math.pow((cy - ey) / ry, 2) <= 1) grid[py][px] = 1;
      }
  });
  return grid;
}
function pngFrames(file, m) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") return -1;
  return Math.floor(b.readUInt32BE(16) / m.frameW) * Math.floor(b.readUInt32BE(20) / m.frameH);
}

// ---------- 各项检查 ----------
let STATE = {}, ACTIVE = [], props = [], hosts = {}, grid = [];

check("基础文件与状态表解析", () => {
  STATE = parseStateMap(); ACTIVE = parseActive();
  const r = buildProps(); props = r.props; hosts = r.hosts; grid = buildGrid(props);
  return { note: `${Object.keys(STATE).length} 个状态 / ${Object.keys(zones).length} 个区域 / ${map.furniture.length} 件家具 / ${grid.flat().filter(Boolean).length} 个阻挡格` };
});

check("常量一致性 map.room ↔ office.js", () => {
  const t = /var TILE = (\d+)/.exec(officeSrc)?.[1];
  const c = /var COLS = (\d+), ROWS = (\d+), WALL_H = (\d+)/.exec(officeSrc);
  const bad = [];
  if (Number(t) !== TILE) bad.push(`TILE: map=${TILE} js=${t}`);
  if (!c) bad.push("office.js 里找不到 COLS/ROWS/WALL_H 定义");
  else {
    if (Number(c[1]) !== COLS) bad.push(`COLS: map=${COLS} js=${c[1]}`);
    if (Number(c[2]) !== ROWS) bad.push(`ROWS: map=${ROWS} js=${c[2]}`);
    if (Number(c[3]) !== WALL_H) bad.push(`WALL_H: map=${WALL_H} js=${c[3]}`);
  }
  return { problems: bad, note: `${COLS}×${ROWS} / TILE=${TILE} / WALL_H=${WALL_H}` };
});

check("状态 → 区域引用", () => {
  const bad = Object.keys(STATE).filter(k => !STATE[k].zone || !zones[STATE[k].zone])
    .map(k => `状态 ${k} 的区域 ${STATE[k].zone || "(空)"} 不存在`);
  const miss = Object.keys(STATE).filter(k => !STATE[k].verb).map(k => `状态 ${k} 缺 verb`);
  return { problems: bad.concat(miss), note: `${Object.keys(STATE).length} 个状态全部有合法区域` };
});

check("区域锚点：越界 / 阻挡格", () => {
  const bad = [];
  Object.keys(zones).forEach(n => {
    const z = zones[n], a = z.anchor || [0, 0];
    const ex = Math.round(a[0]), ey = Math.round(a[1]);
    if (ex < 0 || ey < 0 || ex >= COLS || ey >= ROWS) {
      if (!z.decorative) bad.push(`${n} 目标格 [${ex},${ey}] 越出 ${COLS}×${ROWS}`);
    } else if (grid[ey][ex] && !z.decorative) {
      bad.push(`${n} 锚点 [${ex},${ey}] 落在阻挡格里，A* 会漂走`);
    }
  });
  return { problems: bad, note: `${Object.keys(zones).length} 个区域，decorative 区域跳过阻挡检查` };
});

check("区域语义：期望家具在 2.2 格内", () => {
  const bad = []; let checked = 0;
  Object.keys(zones).forEach(n => {
    const z = zones[n], a = z.anchor || [0, 0];
    if (z.expect && z.expect.length) {
      checked++;
      const found = z.expect.map(asset => {
        let best = Infinity;
        props.forEach(p => {
          if (!p || p.key !== asset) return;
          const d = Math.hypot(p.tx - a[0], p.ty - a[1]);
          if (d < best) best = d;
        });
        return { asset, d: best };
      });
      if (!found.some(f => f.d <= 2.2))
        bad.push(`${n} 2.2 格内找不到 [${z.expect.join("/")}]（最近：${found.map(f => f.asset + " " + (isFinite(f.d) ? f.d.toFixed(1) : "缺失") + "格").join("、")}）`);
    } else if (z.feature) {
      checked++;
      if (!map[z.feature]) bad.push(`${n} 的背景设施 ${z.feature} 未在 map.json 配置`);
    }
  });
  return { problems: bad, note: `${checked} 个语义区域（expect / feature）` };
});

check("坐席宿主与距离", () => {
  const bad = []; let n = 0;
  Object.keys(zones).forEach(k => {
    const sit = zones[k].sit; if (!sit) return;
    n++;
    const h = hosts[sit.host];
    if (!h) { bad.push(`${k} 的坐席宿主 ${sit.host} 不存在`); return; }
    const d = Math.hypot(h.tx - zones[k].anchor[0], h.ty - zones[k].anchor[1]);
    if (d > 2.6) bad.push(`${k} 锚点距坐席 ${sit.host} ${d.toFixed(1)} 格（>2.6，落座会瞬移）`);
  });
  return { problems: bad, note: `${n} 处坐席` };
});

check("家具资产 / on 引用 / 帧号 / 重复 id", () => {
  const bad = [], ids = new Set();
  map.furniture.forEach((f, i) => {
    const tag = f.id || `${f.a}#${i}`;
    if (!manifest[f.a]) { bad.push(`${tag}: 素材 ${f.a} 不在 manifest.json`); return; }
    const png = path.join(ASSETS, f.a + ".png");
    if (!fs.existsSync(png)) { bad.push(`${tag}: 缺文件 assets/${f.a}.png`); return; }
    if (f.frame != null) {
      const total = pngFrames(png, manifest[f.a]);
      if (f.frame < 0 || f.frame >= total) bad.push(`${tag}: frame=${f.frame} 越界（素材仅 ${total} 帧）`);
    }
    if (f.id) { if (ids.has(f.id)) bad.push(`家具 id 重复: ${f.id}`); ids.add(f.id); }
    if (f.on) {
      const host = map.furniture.find(x => x.id === f.on);
      if (!host) bad.push(`${tag}: on 宿主 ${f.on} 不存在`);
      else if (host.on) bad.push(`${tag}: on 宿主 ${f.on} 本身也是叠加物，第一遍 hostMap 里还没有它`);
    }
  });
  return { problems: bad, note: `${map.furniture.length} 件家具 / ${Object.keys(manifest).length} 个素材` };
});

check("作息 / 调试台引用的状态 ⊆ STATE_MAP", () => {
  const used = new Set();
  // 1) 作息表里登记的班次状态（hub/schedule.json 的 state 字段）
  (scheduleJson?.shifts || []).forEach(s => { if (s && s.state) used.add(String(s.state)); });
  // 2) 调试台的演示序列（debug.js 的 SEQ）——一键演示不能推前端不认识的状态
  const seq = /var SEQ = \[([^\]]*)\]/.exec(dbgSrc);
  if (seq) seq[1].split(",").forEach(s => { const v = s.trim().replace(/^["']|["']$/g, ""); if (v) used.add(v); });
  const bad = [...used].filter(s => !STATE[s]).map(s => `"${s}" 不在 STATE_MAP，前端会静默兜底成 idle`);
  // P4.1 扩容：班次时长合法性 —— dur 必须 >0，同状态两班（无 every）不得重叠
  if (scheduleJson && Array.isArray(scheduleJson.shifts)) {
    scheduleJson.shifts.forEach(s => {
      if (s && s.dur != null && !(Number(s.dur) > 0)) bad.push(`班次「${s.label}」的 dur=${s.dur} 非法（必须 >0，单位小时）`);
      if (s && s.dur != null && Number(s.dur) > 24) bad.push(`班次「${s.label}」的 dur=${s.dur} 超过 24 小时`);
      if (s && !s.silent && s.state && !s.at) bad.push(`班次「${s.label}」要上报状态却缺 at 时刻`);
    });
    const occ = scheduleJson.shifts.filter(s => s.at && s.state);
    const toMin = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0) };
    for (let a = 0; a < occ.length; a++) for (let b = a + 1; b < occ.length; b++) {
      const A = occ[a], B = occ[b];
      if (A.state !== B.state || (A.weekday ?? "") !== (B.weekday ?? "")) continue;
      if (A.every || B.every) continue;   // every 班是同一班展开，不参与重叠判断
      const a0 = toMin(A.at), a1 = a0 + (Number(A.dur) || 1) * 60;
      const b0 = toMin(B.at), b1 = b0 + (Number(B.dur) || 1) * 60;
      // 跨零点：把窗口平移 ±1440 再测三种相对位置
      const ov = (x0, x1, y0, y1) => (x0 < y1 && y0 < x1) || (x0 - 1440 < y1 && y0 < x1 - 1440) || (x0 + 1440 < y1 && y0 < x1 + 1440);
      if (ov(a0, a1, b0, b1)) bad.push(`班次「${A.label}」与「${B.label}」同状态时段重叠（${A.at}+${A.dur}h vs ${B.at}+${B.dur}h）`);
    }
  }
  // P4.1 扩容：hub 必须保留优先级仲裁与排班引擎（解耦后小镇自主生活的两个支柱）
  if (!/STATE_PRIORITY\s*=/.test(hubSrc)) bad.push("hub.mjs 缺 STATE_PRIORITY 优先级表（外部低优事件会粗暴打断排班）");
  if (!/scheduleTick/.test(hubSrc)) bad.push("hub.mjs 缺 scheduleTick 排班引擎（小镇 0 外部依赖就该能活）");
  return { problems: bad, note: `${used.size} 个状态名 · dur/重叠/优先级/排班引擎 校验` };
});

check("状态清单 hub/states.json ↔ 前端 STATE_MAP", () => {
  if (!statesJson) return { problems: ["hub/states.json 缺失或不是合法 JSON：hub 会降级为不校验白名单"] };
  const declared = statesJson.states || [], active = statesJson.active || [], keys = Object.keys(STATE), bad = [];
  if (!Array.isArray(statesJson.states) || !Array.isArray(statesJson.active)) return { problems: ["states.json 的 states / active 必须是数组"] };
  const dups = a => [...new Set(a.filter((x, i) => a.indexOf(x) !== i))];
  if (dups(declared).length) bad.push(`states 有重复项: ${dups(declared).join(",")}`);
  keys.filter(k => !declared.includes(k)).forEach(k => bad.push(`前端 STATE_MAP 有 ${k}，states.json 缺（hub 会拒收该状态）`));
  declared.filter(k => !STATE[k]).forEach(k => bad.push(`states.json 有 ${k}，前端 STATE_MAP 缺（鱼会兜底成 idle）`));
  ACTIVE.filter(k => !active.includes(k)).forEach(k => bad.push(`ACTIVE_STATES 有 ${k}，active 清单缺`));
  active.filter(k => !ACTIVE.includes(k)).forEach(k => bad.push(`active 清单有 ${k}，前端 ACTIVE_STATES 缺`));
  active.filter(k => !declared.includes(k)).forEach(k => bad.push(`active 里的 ${k} 不在 states 清单中`));
  return { problems: bad, note: `${declared.length} 个状态 / ${active.length} 个 active，双向一致` };
});

check("线上调试台保护 / hub 白名单与持久化", () => {
  const bad = [];
  if (!/btn\.hidden = true/.test(indexSrc)) bad.push("index.html 未在线上隐藏调试入口");
  if (!/HUB_OK/.test(dbgSrc) || !/b\.disabled = true/.test(dbgSrc)) bad.push("debug.js 未在线上禁用「推到 hub / 查 hub 状态」");
  if (!/function hubFetch/.test(officeSrc)) bad.push("office.js 缺 hubFetch 线上保护（会误 fetch 主站 /api/event）");
  if (!/states\.json/.test(hubSrc)) bad.push("hub.mjs 未接入状态白名单");
  if (!/saveDisk/.test(hubSrc)) bad.push("hub.mjs 未启用状态持久化");
  if (!/role|aria-label/.test(officeSrc) || !/aria-pressed/.test(officeSrc)) bad.push("office.js 缺 canvas / 房间按钮无障碍属性");
  return { problems: bad, note: "入口隐藏 · 按钮禁用 · 白名单 · 持久化 · aria" };
});

check("状态圆点样式 / ACTIVE_STATES", () => {
  const warnings = [];
  Object.keys(STATE).forEach(k => {
    if (STATE[k].mood === "working" && !ACTIVE.includes(k)) warnings.push(`${k} 是 working 态但不在 ACTIVE_STATES，圆点不会变绿`);
  });
  ["browsing", "watching"].forEach(k => {
    if (ACTIVE.includes(k) && indexSrc.includes(".dot." + k)) warnings.push(`CSS .dot.${k} 永不生效（ACTIVE_STATES 会统一改成 .working）`);
  });
  return { warnings, note: `${ACTIVE.length} 个 active 状态` };
});

check("鲸鱼女仆精灵表 / 动作帧", () => {
  const bad = [];
  const m = manifest.whale;
  if (!m) return { problems: ["manifest.json 缺 whale 条目"] };
  let side = null;
  try { side = JSON.parse(read(path.join(ASSETS, "whale.json"))); }
  catch (e) { bad.push("assets/whale.json 解析失败: " + e.message); }
  if (side && JSON.stringify(side) !== JSON.stringify(m)) bad.push("whale.json 与 manifest.json 的 whale 条目不一致（跑 gen_whale.py 重新生成）");
  if (m.frameW !== 64 || m.frameH !== 64) bad.push(`whale 帧尺寸应为 64x64，实际 ${m.frameW}x${m.frameH}`);
  if (JSON.stringify(m.bbox) !== JSON.stringify([20, 15, 24, 40])) bad.push("whale.bbox 变了，脚点定位 / 家具对齐会整体漂移");
  const acts = m.acts || {}, names = Object.keys(acts);
  if (!names.length) return { problems: ["whale.acts 为空：动作帧没行号表，playAct 会全降级成静态帧"] };
  if (m.frameRows !== names.length) bad.push(`frameRows=${m.frameRows} 与 acts 的 ${names.length} 行不一致`);
  if (m.actFrames !== 8) bad.push(`actFrames=${m.actFrames}，office.js 固定按 8 帧一行生成动画`);
  const buf = fs.readFileSync(path.join(ASSETS, "whale.png"));
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== m.frameW * 8) bad.push(`whale.png 宽 ${w}，应为 ${m.frameW * 8}`);
  if (h !== m.frameH * m.frameRows) bad.push(`whale.png 高 ${h}，应为 ${m.frameH * m.frameRows}`);
  const rows = Object.values(acts);
  if (new Set(rows).size !== rows.length) bad.push("acts 里有两个动作复用了同一行");
  rows.forEach((r, i) => {
    if (!Number.isInteger(r) || r < 0 || r >= m.frameRows) bad.push(`${names[i]} 行号 ${r} 越界`);
  });
  ["walk_s", "walk_e", "walk_w", "walk_n"].forEach((k, i) => {
    if (acts[k] !== i) bad.push(`兼容回归：${k} 必须固定在第 ${i} 行（fish.face/still 按 row*8 取帧）`);
  });
  ["idle_back", "typing_back", "lounge"].forEach(k => {
    if (acts[k] === undefined) bad.push(`缺关键动作行 ${k}（背对镜头 / 瘫沙发会退回静态帧）`);
  });
  const ai = officeSrc.indexOf("var ACT_ANIM = {"), aj = officeSrc.indexOf("};", ai);
  const block = ai < 0 ? "" : officeSrc.slice(ai, aj);
  const pairs = [...block.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)].map(x => [x[1], x[2]]);
  if (!pairs.length) bad.push("office.js 里找不到 ACT_ANIM 映射");
  const actKeys = new Set(pairs.map(p => p[0]));    // 源 act 名（STATE_MAP / LOCAL_ACTS 用）
  pairs.forEach(([src, dst]) => {
    if (acts[dst] === undefined) bad.push(`ACT_ANIM.${src} → ${dst}，但 whale.acts 没有这一行`);
  });
  new Set(Object.values(STATE).map(s => s.act).filter(Boolean)).forEach(a => {
    if (!actKeys.has(a)) bad.push(`STATE_MAP 的 act="${a}" 没在 ACT_ANIM 里映射（会兜底成 idle）`);
  });
  const li = officeSrc.indexOf("var LOCAL_ACTS = {"), lj = officeSrc.indexOf("};", li);
  const localBlock = li < 0 ? "" : officeSrc.slice(li, lj);
  [...localBlock.matchAll(/anim:\s*"([A-Za-z_]+)"/g)].forEach(x => {
    if (!actKeys.has(x[1])) bad.push(`LOCAL_ACTS 的 anim="${x[1]}" 没在 ACT_ANIM 里映射`);
  });
  if (!fs.existsSync(path.join(OFFICE, "tools", "gen_whale.py"))) bad.push("缺 tools/gen_whale.py，精灵表不可复现");
  return { problems: bad, note: `${m.frameRows} 行 × ${m.actFrames} 帧 / ${actKeys.size} 种动作映射` };
});

check("部署清单 sync_web.sh", () => {
  const need = ["index.html", "office.js", "debug.js", "editor.html", "editor.js", "map.json", "assets/*.png", "assets/*.json", "phaser.min.js"];
  const bad = need.filter(n => !shSrc.includes(n)).map(n => `sync_web.sh 未覆盖 ${n}`);
  if (!/bust\.mjs/.test(shSrc)) bad.push("sync_web.sh 未接入 bust.mjs（版本号不会自动更新）");
  if (!/check\.mjs/.test(shSrc)) bad.push("sync_web.sh 未接入 check.mjs（无上线门禁）");
  return { problems: bad, note: `${need.length} 类文件 + 门禁` };
});

check("资源版本号与内容 hash 一致", () => {
  const stale = dryRun().filter(r => r.actual !== r.expected);
  return {
    problems: stale.map(r => `${r.file} 版本号过期，跑 node office/tools/bust.mjs`),
    note: stale.length ? "" : "office.js / debug.js / map.json / manifest.json / PNG 全部匹配"
  };
});

check("本地生活事件表（区域 / 动作 / 房间分布防回退）", () => {
  const bad = [];
  const i = officeSrc.indexOf("var LOCAL_EVENTS = [");
  const j = officeSrc.indexOf("\n  ];", i);
  if (i < 0 || j < 0) return { problems: ["office.js 找不到 LOCAL_EVENTS：本地生活模拟退回写死的 4 条"] };
  const field = (s, k) => new RegExp("\\b" + k + ":\\s*\"([^\"]*)\"").exec(s)?.[1];
  const num = (s, k) => new RegExp("\\b" + k + ":\\s*([0-9.]+)").exec(s)?.[1];
  const rows = [...officeSrc.slice(i, j).matchAll(/\{([^{}]*)\}/g)].map(m => m[1]);
  const evs = rows.map(s => ({
    key: field(s, "key"), zone: field(s, "zone"), label: field(s, "label"),
    icon: field(s, "icon"), text: field(s, "text"), act: field(s, "act"),
    face: field(s, "face"), room: field(s, "room"), w: Number(num(s, "w"))
  })).filter(e => e.key);
  if (evs.length < 18) bad.push(`本地事件只有 ${evs.length} 条（要求 ≥18，旧版只有 4 条）`);

  // 关联表：LOCAL_ACTS 的 act → 动作行；ACT_ANIM 的源 act 集合
  const li = officeSrc.indexOf("var LOCAL_ACTS = {"), lj = officeSrc.indexOf("\n  };", li);
  const localMap = {};
  if (li >= 0 && lj > li) {
    [...officeSrc.slice(li, lj).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{\s*anim:\s*"([^"]+)"/g)]
      .forEach(m => { localMap[m[1]] = m[2]; });
  }
  const ai = officeSrc.indexOf("var ACT_ANIM = {"), aj = officeSrc.indexOf("};", ai);
  const actKeys = new Set(ai < 0 ? [] : [...officeSrc.slice(ai, aj)
    .matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"([A-Za-z_][A-Za-z0-9_]*)"/g)].map(x => x[1]));
  const ri = officeSrc.indexOf("var ROOMS = ["), rj = officeSrc.indexOf("];", ri);
  const rooms = ri < 0 ? [] : [...officeSrc.slice(ri, rj).matchAll(/id:\s*"([^"]+)"/g)].map(x => x[1]);

  const seen = new Set(), byRoom = {}, anims = new Set();
  evs.forEach(e => {
    if (seen.has(e.key)) bad.push(`事件 key 重复：${e.key}`);
    seen.add(e.key);
    ["zone", "label", "icon", "text", "act", "face", "room"].forEach(k => {
      if (!e[k]) bad.push(`${e.key} 缺字段 ${k}`);
    });
    if (!zones[e.zone]) bad.push(`${e.key} 的 zone="${e.zone}" 不在 map.json.zones 里`);
    if (!/^[snew]$/.test(e.face || "")) bad.push(`${e.key} 的 face="${e.face}" 非法`);
    if (!rooms.includes(e.room)) bad.push(`${e.key} 的 room="${e.room}" 不在 ROOMS 里`);
    if (!(e.w > 0)) bad.push(`${e.key} 的权重 w 不是正数`);
    if (!localMap[e.act]) bad.push(`${e.key} 的 act="${e.act}" 不在 LOCAL_ACTS 里（会兜底成 idle 1800ms）`);
    else {
      if (!actKeys.has(localMap[e.act])) bad.push(`LOCAL_ACTS.${e.act} → anim="${localMap[e.act]}" 没在 ACT_ANIM 里映射`);
      anims.add(localMap[e.act]);
    }
    byRoom[e.room] = (byRoom[e.room] || 0) + 1;
  });
  rooms.forEach(r => {
    if ((byRoom[r] || 0) < 2) bad.push(`房间 ${r} 只有 ${byRoom[r] || 0} 条本地事件（至少 2 条）`);
  });
  if (anims.size < 10) bad.push(`只用到 ${anims.size} 种动作帧（要求 ≥10，精灵表有 20 行）`);
  ["sofa", "tea", "window", "library"].forEach(k => {
    if (!seen.has(k)) bad.push(`调试台常用快捷按钮 ${k} 在事件表里消失了`);
  });
  if (!/findLocalEvent\(key\)/.test(officeSrc)) bad.push("__officeCtl.localAct 没有从事件表查 key");
  if (!/localAct:\s*function\s*\(key,\s*instant\)/.test(officeSrc)) bad.push("__officeCtl.localAct 缺 instant 就地播放参数（远处事件无法快速预览）");
  if (!/C\.localEvents\s*\|\||C\.localEvents\(\)/.test(dbgSrc)) bad.push("debug.js 没有从 C.localEvents() 渲染事件按钮");
  if (!dbgSrc.includes("dbg-instant")) bad.push("debug.js 缺就地播放开关 dbg-instant");
  if (!officeSrc.includes("localEvents: function")) bad.push("__officeCtl 缺 localEvents() 诊断接口");
  return { problems: bad, note: `${evs.length} 条事件 / ${Object.keys(byRoom).length} 个房间 / ${anims.size} 种动作帧` };
});

check("画布内文字按缩放比渲染（防回退到糊字）", () => {
  const bad = [];
  if (!/function canvasScale\s*\(/.test(officeSrc)) bad.push("缺 canvasScale()：没有测量 Phaser FIT 的画布缩放比");
  if (!/function uiFont\s*\(/.test(officeSrc)) bad.push("缺 uiFont()：画布内文字会退回写死的世界像素字号");
  const bi = officeSrc.indexOf("function showBubble("), bj = officeSrc.indexOf("function hideBubble(", bi);
  if (!/uiFont\(/.test(officeSrc.slice(bi, bj))) bad.push("showBubble 仍写死 fontSize（手机上只剩 3~4 CSS px）");
  const ri = officeSrc.indexOf("function redrawBoard("), rj = officeSrc.indexOf("// 产出物架", ri);
  if (!/uiFont\(/.test(officeSrc.slice(ri, rj))) bad.push("任务板 redrawBoard 仍写死 fontSize");
  if (!/addEventListener\("resize"/.test(officeSrc)) bad.push("窗口尺寸变化后没有重绘画布文字");
  if (!/setTimeout\(refreshCanvasText, 400\)/.test(officeSrc)) bad.push("缺首屏延迟重绘（canvas 布局完成前拿不到缩放比）");
  // 气泡"位置偏移"用世界 px（相对鱼头尺寸恒定）；"字号/圆角/边框"才乘 k 补偿缩放。
  // 反向规则：偏移若乘了 k，缩小屏上会推出 2 个身位（v15 用户报的对不齐根因）。
  {
    const seg = officeSrc.slice(officeSrc.indexOf("function calcBubbleOff("), bi);
    if (/\*\s*k/.test(seg.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")))
      bad.push("calcBubbleOff 偏移不应乘 k（世界 px 对齐鱼身，字号才乘 k）——v15 回归");
  }
  return { problems: bad, note: "FIT 缩放比反算 · 气泡 / 任务板 / 粒子 · resize 重绘" };
});

check("画布铺满容器 / 调试台重排（防宽屏左右留白）", () => {
  const bad = [];
  const gm = /width:\s*(\d+),\s*height:\s*(\d+)/.exec(officeSrc);
  if (!gm) bad.push("解析不到 Phaser 游戏尺寸");
  const gw = gm ? +gm[1] : 1248, gh = gm ? +gm[2] : 768;
  const parentRule = /#office-parent\s*\{([^}]*)\}/.exec(indexSrc)?.[1] || "";
  if (!new RegExp(`aspect-ratio:\\s*${gw}\\s*/\\s*${gh}`).test(parentRule)) {
    bad.push(`#office-parent 缺 aspect-ratio: ${gw} / ${gh}（容器高度不随宽度长，FIT 会把画布居中留白）`);
  }
  const canvasRule = /#office-parent canvas\s*\{([^}]*)\}/.exec(indexSrc)?.[1] || "";
  if (!/width:\s*100%\s*!important/.test(canvasRule) || !/height:\s*100%\s*!important/.test(canvasRule)) {
    bad.push("canvas 没用 !important 强制铺满：Phaser inline 尺寸滞后一拍时会露出容器底色");
  }
  const rsz = officeSrc.indexOf('addEventListener("resize"');
  if (rsz < 0 || !/game\.scale\.refresh\(\)/.test(officeSrc.slice(rsz, rsz + 400))) {
    bad.push("resize 时没有 game.scale.refresh()，Phaser 仍按旧 parentSize 计算");
  }
  if (!/dispatchEvent\(new Event\("resize"\)\)/.test(dbgSrc)) {
    bad.push("debug.js 开/关面板没派发 resize：CSS 改 .wrap 宽度不会触发浏览器 resize");
  }
  const show = dbgSrc.indexOf("function show()"), close = dbgSrc.indexOf("function close()", show);
  if (!/relayout\(\)/.test(dbgSrc.slice(show, close)) || !/relayout\(\)/.test(dbgSrc.slice(close, close + 500))) {
    bad.push("show()/close() 必须都调用 relayout()，否则关掉面板后画布仍是旧尺寸");
  }
  if (/body\.dbg-open \.wrap\{[^}]*max-width:\s*none/.test(dbgSrc)) {
    bad.push("宽屏调试台又把 .wrap 拉到无限宽，画布会被撑出首屏");
  }
  return { problems: bad, note: `${gw}:${gh} 比例 · CSS 强制铺满 · 面板开关重排` };
});

check("最近动态窗（事件流 / 今日时间表 / 作息表对齐）", () => {
  const bad = [], warnings = [];

  // ---- 1) DOM 结构：面板在 index.html 里，且是 DOM 文字（canvas 里的字手机上糊，见 v21）----
  [['id="activity"', "面板容器 #activity"],
   ['id="act-list"', "事件流列表 #act-list"],
   ['id="act-plan"', "时间表列表 #act-plan"],
   ['id="act-now"', "「现在几点 / 当前状态」#act-now"],
   ['id="act-why"', "「为什么现在是这样」#act-why"],
   ['id="act-tab-events"', "事件流标签"],
   ['id="act-tab-plan"', "时间表标签"],
   ['id="act-fold"', "折叠按钮"]].forEach(([needle, what]) => {
    if (!indexSrc.includes(needle)) bad.push(`index.html 缺${what}（${needle}）`);
  });
  if (!/#activity\s*\{/.test(indexSrc)) bad.push("index.html 缺 #activity 样式：面板会是无样式的裸列表");
  if (!/#act-list[^{]*\{[^}]*max-height/.test(indexSrc) || !/#act-plan[^{]*\{[^}]*max-height/.test(indexSrc)) {
    bad.push("事件流 / 时间表列表要各自限高自己滚（长列表会把下面的说明顶出视野）");
  }
  if (/#activity \.act-body[^{]*\{[^}]*max-height/.test(indexSrc)) {
    bad.push("滚动条又给了整块 .act-body：上方的「现在几点 / 为什么是这样」会被一起滚出视野");
  }
  if (!/aria-selected/.test(indexSrc)) bad.push("index.html 的标签缺 aria-selected（键盘/读屏用户分不清选中哪个）");

  // ---- 2) 事件流：hub.recent 合并 + 本地留档 + 定时刷新 ----
  if (!/function pushEvent\(/.test(officeSrc)) bad.push("office.js 缺 pushEvent()：实时事件进不了流水");
  if (!/Array\.isArray\(msg\.recent\)\) msg\.recent\.forEach\(pushEvent\)/.test(officeSrc)) {
    bad.push("WS hello 没有合并 msg.recent：刷新页面后事件流只剩当前一条，「最近干了什么」看不出来");
  }
  if (!/office_activity_v1/.test(officeSrc)) bad.push("事件流没有 localStorage 留档（刷新 / 发版后历史全丢）");
  if (!/function renderEvents\(/.test(officeSrc)) bad.push("office.js 缺 renderEvents()");
  if (!/function renderPlan\(/.test(officeSrc)) bad.push("office.js 缺 renderPlan()");
  if (!/setInterval\(function \(\) \{\s*renderEvents\(\);/.test(officeSrc)) {
    bad.push("缺 30s 刷新：「几分钟前 / 此刻正在进行」会一直停在打开页面那一刻");
  }
  if (!/activity: function/.test(officeSrc) || !/schedule: function/.test(officeSrc)) {
    bad.push("__officeCtl 缺 activity() / schedule() 诊断接口（自动走查没法断言）");
  }

  // ---- 3) 北京时间：不能拿访客本地时区算班次 ----
  if (!/BJ_MS/.test(officeSrc) || !/function bjClock\(/.test(officeSrc)) bad.push("缺北京时间换算（访客在别的时区会把班次算错）");
  if (/\.getHours\(\)/.test(officeSrc)) bad.push("office.js 出现 getHours()：班次会跟着访客本地时区漂");

  // ---- 4) 时间表 ↔ hub/schedule.json 双向核对 ----
  const si = officeSrc.indexOf("var SCHEDULE = {"), sj = officeSrc.indexOf("\n  };", si);
  if (si < 0 || sj < 0) return { problems: bad.concat(["office.js 找不到 SCHEDULE 时间表"]), warnings, note: "" };
  const block = officeSrc.slice(si, sj);
  const wakeM = /wake:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]/.exec(block);
  const shifts = [...block.matchAll(/\{([^{}]*)\}/g)].map(m => m[1]).map(s => ({
    at: /at:\s*"([0-2]\d:[0-5]\d)"/.exec(s)?.[1],
    every: Number(/every:\s*(\d+)/.exec(s)?.[1] || 0),
    weekday: /weekday:\s*(\d)/.exec(s)?.[1],
    label: /label:\s*"([^"]+)"/.exec(s)?.[1],
    silent: /silent:\s*true/.test(s)
  })).filter(r => r.label);
  if (!wakeM) bad.push("SCHEDULE 缺 wake 清醒时段：[起, 止]，hub 的空档回落要对齐它");
  if (shifts.length < 5) bad.push(`SCHEDULE 只有 ${shifts.length} 班（要求 ≥5，别把时间表缩回只有一条）`);
  shifts.filter(s => !s.at).forEach(s => bad.push(`班次「${s.label}」的 at 不是 HH:MM`));

  if (!scheduleJson) {
    bad.push("缺 hub/schedule.json：作息表就没有唯一事实源，页面上的时间表无从核对");
  } else {
    const plan = Array.isArray(scheduleJson.shifts) ? scheduleJson.shifts : [];
    if (!Array.isArray(scheduleJson.shifts)) bad.push("hub/schedule.json 的 shifts 必须是数组");
    if (plan.length < 5) bad.push(`hub/schedule.json 只有 ${plan.length} 班（要求 ≥5）`);
    const key = s => `${s.at}|${s.weekday ?? ""}|${s.label}`;
    const planKeys = new Set(plan.map(key));
    const pageKeys = new Set(shifts.map(key));
    shifts.filter(s => s.at && !planKeys.has(key(s))).forEach(s => {
      bad.push(`页面时间表里的 ${s.at}「${s.label}」在 hub/schedule.json 里找不到（改了作息忘了改前端，或者反过来）`);
    });
    plan.filter(s => s.at && s.label && !pageKeys.has(key(s))).forEach(s => {
      bad.push(`hub/schedule.json 里的 ${s.at}「${s.label}」没写进页面时间表（前端会漏掉这一班）`);
    });
    // 周几字段两侧都要一致：只改一边等于"I班每天跑"和"只周日跑"混着
    plan.filter(s => s.at && s.label && (s.weekday ?? "") !== "").forEach(s => {
      const hit = shifts.find(x => x.at === s.at && x.label === s.label);
      if (hit && (hit.weekday ?? "") !== String(s.weekday)) {
        bad.push(`「${s.label}」的 weekday 不一致：schedule.json=${s.weekday} / 页面=${hit.weekday ?? "每天"}`);
      }
    });
    if (!plan.some(s => String(s.weekday) === "0")) bad.push("schedule.json 里没有周日专属的班次（赶集日）");
    // v83.6 时刻合法性：at 必须是 HH:MM、dur 必须为正、state 必须在 states.json 白名单
    const stateNames = new Set(Array.isArray(statesJson?.states) ? statesJson.states : []);
    const atRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    plan.filter(s => s.at && !atRe.test(s.at)).forEach(s => bad.push(`「${s.label}」的 at="${s.at}" 不是合法 HH:MM`));
    plan.filter(s => s.at).sort((a, b) => (a.at || "").localeCompare(b.at || "")).forEach((s, i, arr) => {
      if (i > 0 && arr[i - 1].at === s.at && (s.weekday ?? "") === (arr[i - 1].weekday ?? ""))
        bad.push(`${s.at} 同一时刻有两个班次：「${arr[i - 1].label}」和「${s.label}」`);
    });
    plan.filter(s => s.dur !== undefined && !(Number(s.dur) > 0)).forEach(s => bad.push(`「${s.label}」的 dur=${s.dur} 必须为正数`));
    plan.filter(s => s.state && !stateNames.has(s.state)).forEach(s => bad.push(`「${s.label}」的 state="${s.state}" 不在 states.json 白名单`));
    const planWake = Array.isArray(scheduleJson.wake) ? scheduleJson.wake : null;
    if (!planWake || planWake.length !== 2) bad.push("hub/schedule.json 缺 wake: [起, 止]");
    else if (wakeM && (Number(planWake[0]) !== Number(wakeM[1]) || Number(planWake[1]) !== Number(wakeM[2]))) {
      bad.push(`hub/schedule.json 的 wake ${planWake[0]}:00–${planWake[1]}:00 与前端 SCHEDULE.wake ${wakeM[1]}:00–${wakeM[2]}:00 不一致`);
    }
  }

  /* 可选：如果你确实想让小镇作息跟某台机器的 crontab 对齐，把 OFFICE_CRONTAB_FILE 指过去即可，
   * 这里只做告警不做门禁 —— 小镇自己的作息由 hub/schedule.json 说了算，不依赖外部定时任务。 */
  const cronPath = process.env.OFFICE_CRONTAB_FILE;
  let cron = null;
  if (cronPath && fs.existsSync(cronPath)) {
    cron = read(cronPath).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"))
      .map(l => l.split(/\s+/)).filter(f => f.length >= 6)
      .map(f => ({ min: f[0], hour: f[1], dom: f[2], mon: f[3], dow: f[4], cmd: f.slice(5).join(" ") }));
    const minOK = (field, m) => field === String(m) || field === "*" || (field.startsWith("*/") && m % Number(field.slice(2)) === 0);
    const hourOK = (field, h) => {
      if (field.startsWith("*/")) { const step = Number(field.slice(2)); return step > 0 && h % step === 0; }
      if (field.includes(",")) return field.split(",").map(Number).includes(h);
      return field === "*" || Number(field) === h;
    };
    shifts.filter(s => s.at).forEach(s => {
      const [hh, mm] = s.at.split(":").map(Number);
      if (!cron.find(c => minOK(c.min, mm) && hourOK(c.hour, hh))) {
        warnings.push(`时间表里的 ${s.at}「${s.label}」在 ${cronPath} 找不到对应排班（只是提醒：小镇作息不依赖它）`);
      }
    });
  }

  // ---- 5) hub 空档回落必须按时钟：19 点（清醒时段）没有事件不能再显示「睡觉」----
  const hubStart = /OFFICE_WAKE_START \|\| (\d+)/.exec(hubSrc), hubEnd = /OFFICE_WAKE_END \|\| (\d+)/.exec(hubSrc);
  if (!hubStart || !hubEnd) bad.push("hub.mjs 缺 OFFICE_WAKE_START / OFFICE_WAKE_END：空档回落会退回一律 sleeping");
  else if (wakeM && (Number(hubStart[1]) !== Number(wakeM[1]) || Number(hubEnd[1]) !== Number(wakeM[2]))) {
    bad.push(`hub 清醒时段 ${hubStart[1]}:00–${hubEnd[1]}:00 与前端 SCHEDULE.wake ${wakeM[1]}:00–${wakeM[2]}:00 不一致`);
  }
  if (!/isAwakeHour\(/.test(hubSrc)) bad.push("hub.mjs 的空档回落没有按时钟判断");
  if (!/state:\s*"idle"/.test(hubSrc)) bad.push("hub 空档回落没有 idle 分支：白天没有事件时仍会显示「睡觉」");
  if (!/夜里没有排班|空档期/.test(hubSrc)) bad.push("hub 空档回落的状态文案没有说明原因（用户会以为它真在睡）");

  return {
    problems: bad, warnings,
    note: `${shifts.length} 班 / wake ${wakeM ? wakeM[1] + ":00–" + wakeM[2] + ":00" : "?"} / 作息表 ${scheduleJson?.shifts?.length ?? 0} 班${cron ? ` / 外部 crontab ${cron.length} 条` : ""}`
  };
});

// ---------- 输出 ----------
let fails = 0, warns = 0;
// ---------- 第 19 项：内在状态层（stats）一致性 ----------
check("数值层 stats（hub 字段 / 前端 UI / 增量上报 防回退）", () => {
  const problems = [], warnings = [];
  // 1) hub 必须有 STAT_KEYS 与 /api/stats 端点、60s tick
  if (!/const STAT_KEYS = \["hunger", "mood", "energy", "social", "hygiene"\]/.test(hubSrc))
    problems.push("hub.mjs 缺 STAT_KEYS 五词条定义");
  if (!hubSrc.includes("/api/stats"))
    problems.push("hub.mjs 缺 POST /api/stats 增量入口");
  if (!/setInterval\(\(\) => \{\s*\n\s*tickStats/.test(hubSrc) && !/setInterval\(\(\) => \{$/[test])
    warnings.push("hub.mjs 未检出 tickStats 定时器（人工确认）");
  if (!/type: "stats"/.test(hubSrc))
    problems.push("hub.mjs 缺 stats WS 广播");
  if (!/"state: cur, recent, stats"/.test(hubSrc) && !/stats: statsSnapshot\(\)/.test(hubSrc))
    problems.push("hub.mjs /api/status 未带 stats");
  // 2) 前端必须有：stats 对象、onStats、WS 分支、渲染函数、EVENT_NEED
  /* v2.8-b1：前端不再自己算 delta（postStatDelta 已删除），改为发"命名交互"由 hub 结算 */
  for (const needle of ["function onStats(", 'msg.type === "stats"', "function renderStatsBar(", "var EVENT_NEED", "function needBoost(", "function statFillFor(", "function interact(", "function hubApiUrl("])
    if (!officeSrc.includes(needle))
      problems.push(`office.js 缺 ${needle}`);
  // 3) index.html 必须有 stats-bar DOM 与样式
  if (!indexSrc.includes('id="stats-bar"'))
    problems.push("index.html 缺 #stats-bar 容器");
  if (!indexSrc.includes(".stat-fill"))
    problems.push("index.html 缺 .stat-fill 样式");
  // 4) nginx 反代（sync 不覆盖 nginx，单独提醒）
  //    站点配置路径各家不同：用 OFFICE_NGINX_CONF 指过去；不设就跳过（不猜别人的路径）
  let ng = "";
  const ngPath = process.env.OFFICE_NGINX_CONF;
  if (!ngPath) warnings.push("未设置 OFFICE_NGINX_CONF，跳过 nginx 反代检查");
  else {
    try { ng = read(ngPath); } catch { warnings.push(`读不到 nginx 配置 ${ngPath}，跳过反代检查`); }
  }
  if (ng && !ng.includes("/office-hub-api/"))
    problems.push("nginx 缺 /office-hub-api/ 反代");
  // 5) EVENT_NEED 的 key 必须都在 LOCAL_EVENTS 里
  const needKeys = [...officeSrc.matchAll(/\b([a-z_2]+):\s*\{\s*need:/g)].map(m => m[1]);
  const evKeys = [...officeSrc.matchAll(/\{ key: "([a-z_2]+)"/g)].map(m => m[1]);
  const missing = needKeys.filter(k => !evKeys.includes(k));
  if (missing.length) problems.push(`EVENT_NEED 引用了不存在的事件: ${missing.join(", ")}`);
  return { problems, warnings, note: `${needKeys.length} 条事件挂需求 · 5 词条 · hub 真相源` };
});

// ---------- 第 20 项：鱼塘碰撞 + 地图编辑（v37） ----------
check("鱼塘阻挡 + 地图编辑层（blockers / hub API / 编辑模式 防回退）", () => {
  const bad = [];
  // 1) map.json 必须声明鱼塘 blocker，且与前端 POND 常量一致
  const blocker = (map.blockers || []).find(b => b.t === "pond");
  if (!blocker) bad.push("map.json 缺 blockers[].t=pond：鱼塘水面会被 A* 穿过");
  const pond = /var POND = \{\s*x0:\s*([\d.]+),\s*y0:\s*([\d.]+),\s*x1:\s*([\d.]+),\s*y1:\s*([\d.]+)/.exec(officeSrc);
  if (!pond) bad.push("office.js 找不到 POND 常量");
  else if (blocker) {
    const [, x0, y0, x1, y1] = pond.map(Number);
    if ([x0, y0, x1, y1].some(v => Math.abs(v - (blocker[[x0, y0, x1, y1][[x0, y0, x1, y1].indexOf(v)]]) ) > 0.001)) {
      // 数值对不上时用精确比较再报（避免浮点误报）
      const kv = { x0, y0, x1, y1 };
      const mismatch = Object.keys(kv).filter(k => Math.abs(kv[k] - blocker[k]) > 0.001);
      if (mismatch.length) bad.push(`POND 常量与 map.blockers 不一致: ${mismatch.join(",")}`);
    }
  }
  // 2) 前端必须有 blocker 碰撞逻辑 + check.mjs 已同步（本文件自身）
  if (!/s\.mapdata\.blockers/.test(officeSrc)) bad.push("buildBlockedGrid 未消费 mapdata.blockers（鱼塘碰撞失效）");
  if (!/\(map\.blockers \|\| \[\]\)\.forEach/.test(read(path.join(OFFICE, "tools", "check.mjs"))))
    bad.push("check.mjs 的 buildGrid 未同步 blockers（静态自检与运行时碰撞会漂移）");
  // 3) hub 地图 API：GET/POST /api/map、落盘 map.custom.json、WS 广播、校验
  for (const needle of ['"/api/map"', "applyMapEdit", "map.custom.json", 'type: "map"', "validateMapItem", "customMap"])
    if (!hubSrc.includes(needle)) bad.push(`hub.mjs 缺 ${needle}（地图编辑 API 不完整）`);
  if (!/customMap: customMap\.furniture/.test(hubSrc)) bad.push("hub hello 未带 customMap（刷新后编辑内容不恢复）");
  // 4) 前端编辑模式：应用自定义层、编辑面板、保存调用、走位守卫
  for (const needle of ["function applyCustomMap(", "function setEditMode(", "function editPointerDown(", "function saveEditMap(", 'action: "add"', 'action: "move"', 'action: "remove"', "renderEditList"])
    if (!officeSrc.includes(needle)) bad.push(`office.js 缺 ${needle}（编辑器链路不完整）`);
  if (!/if \(editMode && editPointerDown\(/.test(officeSrc)) bad.push("pointerdown 未接编辑模式（画布点击不会进入放置/删除）");
  if (!/applyCustomFurniture\(s\)/.test(officeSrc)) bad.push("buildFurniture 未调用 applyCustomFurniture（自定义家具不会显示）");
  // 5) debug 台入口
  if (!dbgSrc.includes("dbg-edit") || !dbgSrc.includes("setEditMode")) bad.push("debug.js 缺编辑模式入口");
  if (!dbgSrc.includes("dbg-map-reload")) bad.push("debug.js 缺重载自定义层按钮");
  // 6) 钓鱼 zone 不得被水格堵死：pond zone 锚点必须是可走格
  if (blocker && zones.pond) {
    const a = zones.pond.anchor, ex = Math.round(a[0]), ey = Math.round(a[1]);
    // 复算一次 pond 阻挡（与 buildGrid 相同公式）
    const exC = (blocker.x0 + blocker.x1) / 2, eyC = (blocker.y0 + blocker.y1) / 2;
    const rx = (blocker.x1 - blocker.x0) / 2 + 0.12, ry = (blocker.y1 - blocker.y0) / 2 + 0.12;
    const inPond = Math.pow((ex + 0.5 - exC) / rx, 2) + Math.pow((ey + 0.5 - eyC) / ry, 2) <= 1;
    if (inPond) bad.push(`pond 钓鱼位 [${ex},${ey}] 落在水格里，鱼永远走不进去`);
  }
  return { problems: bad, note: "鱼塘椭圆阻挡 · hub /api/map · 编辑模式 · 调试入口" };
});

// ---------- 第 21 项：独立地图编辑器（v38 三图层） ----------
check("独立编辑器（editor.html）：三图层 / 静态可移动 / 地形碰撞 防回退", () => {
  const bad = [];
  let edHtml = "", edJs = "";
  try { edHtml = read(path.join(OFFICE, "web", "editor.html")); } catch { bad.push("缺 web/editor.html"); }
  try { edJs = read(path.join(OFFICE, "web", "editor.js")); } catch { bad.push("缺 web/editor.js"); }
  // 1) 页面：挂 #office-parent（Phaser parent）、引 office.js/editor.js、藏游戏本体 DOM
  if (edHtml) {
    for (const needle of ['id="office-parent"', "office.js?v=", "editor.js?v=", 'id="game-chrome"', 'id="ed-stage"'])
      if (!edHtml.includes(needle)) bad.push(`editor.html 缺 ${needle}`);
  }
  // 2) 侧栏：三图层 + 工具 + 图标
  if (edJs) {
    for (const needle of ['"floor"', '"object"', '"terrain"', "setLayer", "setFloor", "setTerrain", "setAsset", "deleteObject", "restoreHidden", "M.icon"])
      if (!edJs.includes(needle)) bad.push(`editor.js 缺 ${needle}`);
  }
  // 3) office.js：图层数据模型 + 叠加渲染 + 地形碰撞 + 独立页 API
  for (const needle of ["function splitCustomLayer(", "function renderEditOverlays(", "floorEdits", "terrainEdits", "moveOverrides",
                        "function meSetTile(", "function meEraseAt(", "function meMoveTo(", "window.__mapEditor", "editorMode", "mapEditorPointerDown"])
    if (!officeSrc.includes(needle)) bad.push(`office.js 缺 ${needle}（三图层编辑链路不完整）`);
  // 4) 地形必须参与碰撞：墙/水挡路；地板贴片放行（家具压着的格除外；v83.1 墙格最终覆写，floor 不能放行墙）
  if (!/(terrainEdits\)\.forEach[\s\S]{0,400}grid\[e\.y\]\[e\.x\] = 1)|(solidTerrain\[e\.y \+ "," \+ e\.x\] = 1[\s\S]{0,600}grid\[gy\]\[gx\] = 1)/.test(officeSrc))
    bad.push("buildBlockedGrid 未消费 terrainEdits（墙/水不挡路）");
  if (!/floorEdits\)\.forEach[\s\S]{0,400}grid\[e\.y\]\[e\.x\] = 0/.test(officeSrc)) bad.push("buildBlockedGrid 未消费 floorEdits（地板贴片不能把墙/水改成可走）");
  if (!/solidTerrain\[e\.y \+ "," \+ e\.x\]\) return/.test(officeSrc))
    bad.push("地板放行未跳过地形墙格（v83.1：同格 floor 会把墙重新放行 → 穿墙）");
  if (!/propBlocked\[e\.y \+ "," \+ e\.x\]/.test(officeSrc)) bad.push("地板贴片未避开家具占格（会把家具下面放行）");
  // 5) 静态家具可移动：拖动落定写 move 覆盖，而不是直接改 map.json
  if (!/isMoveEntry\(f\)|isMoveEntry\(e\)/.test(officeSrc)) bad.push("office.js 缺 move 覆盖条目处理（静态家具不能移动）");
  if (!/function moveEntryFor\(/.test(officeSrc)) bad.push("office.js 缺 moveEntryFor（静态家具移动无法持久化）");
  // 6) 部署：sync_web.sh 带上 editor 两件
  for (const f of ["editor.html", "editor.js"]) if (!shSrc.includes(f)) bad.push(`sync_web.sh 未覆盖 ${f}`);
  return { problems: bad, note: "三图层 · 静态可移动 · 地形碰撞 · 独立页" };
});

// ---------- 第 22 项：源码拆分 + 地图贴图化（v39） ----------
check("源码拆分（web/src）+ 地图贴图化 防回退", () => {
  const bad = [];
  const SRC = path.join(OFFICE, "web", "src");
  let files = [];
  try { files = fs.readdirSync(SRC).filter(f => f.endsWith(".js")).sort(); } catch { bad.push("缺 web/src/ 目录（office.js 应拆成片段）"); }
  if (files.length < 10) bad.push(`web/src 片段过少（${files.length}），office.js 可能又变回单文件`);
  for (const need of ["head.js", "boot.js", "room.js", "farm.js", "start.js"]) {
    if (!files.includes(need)) bad.push(`缺片段 web/src/${need}`);
  }
  // office.js 必须等于 src 的拼接结果
  let builtSame = false;
  try { builtSame = norm(build()) === norm(read(path.join(WEB, "office.js"))); } catch { bad.push("web/office.js 与 src 拼接结果不一致（跑 build.mjs）"); }
  if (!builtSame && !bad.some(b => b.includes("拼接结果"))) bad.push("web/office.js 与 src 拼接结果不一致（跑 build.mjs）");
  // 地图贴图：tiles 目录 + 加载 + 底图用 RenderTexture
  let tiles = [];
  try { tiles = fs.readdirSync(path.join(OFFICE, "web", "assets", "tiles")).filter(f => f.endsWith(".png")); } catch { bad.push("缺 web/assets/tiles/（跑 gen_tiles.mjs）"); }
  for (const t of ["wood", "wall", "water", "grass", "road", "farm", "window"]) {
    if (!tiles.includes(t + ".png")) bad.push(`缺地图贴图 assets/tiles/${t}.png`);
  }
  if (!/load\.image\("tile-" \+ mat/.test(read(path.join(SRC, "boot.js")))) bad.push("10-core.js 未加载地图贴图");
  const room = read(path.join(SRC, "room.js"));
  if (!/add\.renderTexture/.test(room)) bad.push("room.js 底图不是贴图（renderTexture）");
  if (/fillStyle\(/.test(room)) bad.push("room.js 里还有 fillStyle 画地板/墙（应全部走贴图）");
  if (!/function paintPond/.test(room) || !/function paintFarm/.test(room) || !/function paintWalls/.test(room)) bad.push("room.js 缺池塘/农田/墙的贴图铺设");
  if (!/var TILE_V = "/.test(read(path.join(SRC, "head.js")))) bad.push("head.js 缺 TILE_V 版本号");
  // 路灯光源定位必须已删除
  if (/lampGlows|buildLampGlows/.test(officeSrc)) bad.push("office.js 里还有路灯光源（lampGlows），用户已要求去掉");
  // v39.2：窗必须能当物品摆（虚拟资产 + wall 标记），鱼塘必须能被逐格改
  if (!/var EDIT_PICKABLE = \[[\s\S]*?"window"/.test(read(path.join(SRC, "mapedit.js")))) bad.push("mapedit.js 的 EDIT_PICKABLE 缺 window（窗不能当物品摆）");
  if (!/placeExtraFor/.test(read(path.join(SRC, "editor-api.js")))) bad.push("editor-api.js 缺 placeExtraFor（窗摆放不会带 wall 标记，会挡路）");
  if (!/manifest\.window = /.test(read(path.join(SRC, "boot.js")))) bad.push("boot.js 未把 window 注册成可用资产");
  if (!/floorEdits\[tx \+ "," \+ ty\] \|\| terrainEdits\[tx \+ "," \+ ty\]/.test(room)) bad.push("room.js 的 paintPond 没让用户手改的格子优先（鱼塘不能自定义）");
  // v39.3：资产必须分类且不重不漏
  const mpSrc = read(path.join(SRC, "mapedit.js"));
  const pick = (/var EDIT_PICKABLE = \[([\s\S]*?)\];/.exec(mpSrc) || [, ""])[1].match(/"([a-z0-9-]+)"/g) || [];
  const pickList = pick.map(s => s.replace(/"/g, ""));
  const catBlock = (/var EDIT_CATS = \[([\s\S]*?)\n  \];/.exec(mpSrc) || [, ""])[1];
  const catAssets = [];
  (catBlock.match(/assets:\s*\[([^\]]*)\]/g) || []).forEach(m => {
    (m.match(/"([a-z0-9-]+)"/g) || []).forEach(s => catAssets.push(s.replace(/"/g, "")));
  });
  const missingCat = pickList.filter(a => !catAssets.includes(a));
  const extraCat = catAssets.filter(a => !pickList.includes(a));
  const dupCat = catAssets.filter((a, i) => catAssets.indexOf(a) !== i);
  if (missingCat.length) bad.push(`资产未分类：${missingCat.join(", ")}（编辑器里找不到它们）`);
  if (extraCat.length) bad.push(`分类里有未登记资产：${extraCat.join(", ")}`);
  if (dupCat.length) bad.push(`资产被重复分类：${[...new Set(dupCat)].join(", ")}`);
  if (!/#ed-cats/.test(read(path.join(WEB, "editor.html")))) bad.push("editor.html 缺分类 chips 样式（#ed-cats）");
  if (!/curCat/.test(read(path.join(WEB, "editor.js")))) bad.push("editor.js 缺分类筛选状态");
  // v39.4：底图结构面板已删；保存必须有可见反馈（保存状态条 + 回读校验）
  if (/STRUCTS|setStruct|structs:/.test(mpSrc + read(path.join(SRC, "editor-api.js")))) bad.push("底图结构（STRUCTS/setStruct）还在，用户已要求删掉");
  if (!/ed-save-status/.test(read(path.join(WEB, "editor.html")))) bad.push("editor.html 缺保存状态条（#ed-save-status）");
  if (!/saveNow/.test(read(path.join(SRC, "editor-api.js"))) || !/saveNow/.test(read(path.join(WEB, "editor.js")))) bad.push("保存没有回读校验（saveNow），失败会静默");
  if (!/noteSave\(/.test(mpSrc)) bad.push("保存结果没有记录（noteSave），UI 无法显示成功/失败");
  // v39.5：画死的旧窗必须删干净（窗只在物品层里摆）
  if (/EXTRA_WINDOWS|redrawWindow|winRedraw/.test(officeSrc)) bad.push("office.js 里还有画死的旧窗（EXTRA_WINDOWS / redrawWindow），用户已要求删除");
  if (/winMat|winCells/.test(read(path.join(SRC, "room.js")))) bad.push("room.js 顶部墙带还在画窗（winCells/winMat）");
  // v40：光照层（昼夜预览 + 夜间阴影可调 + 自定义灯源）
  for (const needle of ["isLightEntry", "renderCustomLights", "LIGHT_PRESETS", "nightCfg"]) {
    if (!mpSrc.includes(needle)) bad.push(`mapedit.js 缺 ${needle}（光照层链路不完整）`);
  }
  const apiSrc = read(path.join(SRC, "editor-api.js"));
  const apiSrc2 = apiSrc;
  for (const needle of ["meAddLight", "meRemoveLight", "mePatchLight", "meSetNight", "saveNow"]) {
    if (!apiSrc.includes(needle)) bad.push(`editor-api.js 缺 ${needle}`);
  }
  if (!/id: "light"/.test(read(path.join(WEB, "editor.js")))) bad.push("editor.js 缺少光照层 tab");
  if (!/ed-lights/.test(read(path.join(WEB, "editor.html")))) bad.push("editor.html 缺灯光预设样式（#ed-lights）");
  // v42：阴影区域 = 内置 4 间房 + 自定义块，每块各自存 夜 / 开灯 / 白天 三档浓度
  if (!/var BUILTIN_SHADOWS = \[/.test(mpSrc)) bad.push("mapedit.js 缺 BUILTIN_SHADOWS（内置房间阴影区域没进列表）");
  if (!/function buildShadowRegions\(/.test(mpSrc)) bad.push("mapedit.js 缺 buildShadowRegions（内置+自定义合并）");
  if (!/function shadowAlphaOf\(/.test(mpSrc)) bad.push("mapedit.js 缺 shadowAlphaOf（三档浓度取值）");
  if (!/r\.room \? \(roomLights\[r\.room\] !== false\)/.test(mpSrc)) bad.push("阴影区域没按房间灯状态选「夜/开灯」浓度");
  if (!/isShadowEntry\(f\) \{ return !!\(f && f\.a === "shadow" && \(typeof f\.w === "number" \|\| f\.del\)\)/.test(mpSrc)) bad.push("阴影条目必须支持 矩形(w/h) 或 删除标记(del)");
  if (!/del: 1/.test(apiSrc)) bad.push("editor-api.js 删内置阴影块没写 del 标记（内置块删不掉）");
  if (!/renderNightShadow\(s\)/.test(read(path.join(SRC, "placement.js")))) bad.push("applyRoomLights 没重画阴影区域（开关灯看不出变化）");
  const edJs = read(path.join(WEB, "editor.js"));
  // v45：旋转后影子/碰撞/脚点必须按"当前帧所在行"的 bbox 算
  if (!/function bboxForFrame\(/.test(read(path.join(SRC, "head.js")))) bad.push("缺 bboxForFrame（按行取包围盒）");
  if (!/bboxForFrame\(m, f\.frame\)/.test(read(path.join(SRC, "placement.js")))) bad.push("makePlacement 没按行取 bbox（旋转后影子/碰撞不会变）");
  if (!/bboxForFrame\(m, editFrameFor/.test(read(path.join(SRC, "mapedit.js")))) bad.push("编辑器预览没按朝向取 bbox");
  const manAll = JSON.parse(read(path.join(ASSETS, "manifest.json")));
  const noRows = Object.keys(manAll).filter(k => manAll[k] && manAll[k].rows && Object.keys(manAll[k].rows).length > 1 && !Array.isArray(manAll[k].bboxRows));
  if (noRows.length) bad.push(`这些资产的 manifest 缺 bboxRows：${noRows.slice(0, 5).join("/")}（跑 office/tools/gen_bboxrows.ps1）`);
  // v47：存档保护（自动备份 + 一键回滚 + 本机副本）
  const hubSrc = read(path.join(OFFICE, "hub", "hub.mjs"));
  if (!/function backupMapFile\(/.test(hubSrc)) bad.push("hub 没有自动备份（backupMapFile）");
  if (!/\/api\/map\/backups/.test(hubSrc) || !/\/api\/map\/restore/.test(hubSrc)) bad.push("hub 缺 /api/map/backups 或 /restore");
  if (!/backupMapFile\(\)\s*\/\/ 先备份再覆盖/.test(hubSrc) && !/const bak = backupMapFile\(\)/.test(hubSrc)) bad.push("写盘前没调用备份");
  if (!/restoreFromMirror/.test(read(path.join(SRC, "editor-api.js")))) bad.push("editor-api 缺本机副本恢复");
  if (!/ed-backups/.test(read(path.join(WEB, "editor.html"))) || !/ed-mirror/.test(read(path.join(WEB, "editor.html")))) bad.push("editor.html 缺历史存档/本机副本按钮");
  // v48：右键拖动平移 + 编辑页屏蔽游戏原有 UI
  const viewSrc = read(path.join(SRC, "view.js"));
  if (!/rightDrag/.test(viewSrc)) bad.push("view.js 缺右键拖动平移（rightDrag）");
  if (!/contextmenu/.test(viewSrc)) bad.push("画布没屏蔽右键菜单");

  // v75：编辑器「自动」预览不能压夜色；邻居按新地图定位
  const plNight = read(path.join(SRC, "placement.js"));
  if (/if \(pv !== "day" && typeof nightCfg !== "undefined" && nightCfg\.ambient != null\) target = nightCfg\.ambient;/.test(plNight))
    bad.push("编辑器自动预览仍会压夜色（屏幕发灰）");
  if (/cx: 43 \* TILE, cy: 24 \* TILE/.test(viewSrc)) bad.push("邻居家还是旧坐标");

  // v76：NPC 家 = 床；走路必须走 A*（否则穿墙）；要有自主行为
  const npcSrc = read(path.join(SRC, "npc.js"));
  if (!/bedAt: \[41\.3, 21\.2\]/.test(npcSrc)) bad.push("NPC 家还绑在旧房子上（应为 bedAt 床位）");
  if (/s\.hostMap\[def\.home\]/.test(npcSrc)) bad.push("NPC 还在依赖房子 sprite");
  if (!/function npcWalkTo\(/.test(npcSrc) || !/astar\(/.test(npcSrc)) bad.push("NPC 走路没用 A*（会穿墙）");
  if (!/function npcWalkHome\(/.test(npcSrc)) bad.push("缺 npcWalkHome（回家不走床位）");
  if (!/NPC_ACTS/.test(npcSrc)) bad.push("NPC 缺自主行为表");
  // v77：三张床必须在 map.json 里真实存在；缩小不能露出灰底
  // v78：NPC 的 bed id 必须是 map.json 里【真实存在】的家具（不许凭空造床）
  const mapJson = JSON.parse(read(path.join(WEB, "map.json")));
  const npcSrcB = read(path.join(SRC, "npc.js"));
  const bedIds = [];
  npcSrcB.replace(/bed: "([A-Za-z0-9_]+)"/g, function (_, id) { bedIds.push(id); return _; });
  if (bedIds.length < 3) bad.push("NPC 的 bed id 少于 3 个");
  bedIds.forEach(function (bid) {
    const found = (mapJson.furniture || []).filter(function (f) { return f.id === bid; })[0];
    if (!found) bad.push("NPC 床位 " + bid + " 在 map.json 里不存在（不许私自造家具）");
  });
  // 一个房间一张床：catBed 所在的喵酱家不该有第二张床
  const houses = [["catBed", 40, 44], ["chiefChair1", 46, 50], ["docArm", 52, 55]];
  houses.forEach(function (h) {
    const beds = (mapJson.furniture || []).filter(function (f) {
      return /^bed/.test(f.a || "") && f.x >= h[1] && f.x <= h[2] && f.y >= 19;
    });
    if (beds.length > 1) bad.push("房间 x" + h[1] + "-" + h[2] + " 有 " + beds.length + " 张床（应只有一张）");
  });
  const apiSrc3 = read(path.join(SRC, "editor-api.js"));
  if (!/function minZoomNoVoid/.test(apiSrc3)) bad.push("缺 minZoomNoVoid（缩小会露出灰底）");
  if (!/background:#1b2233/.test(read(path.join(WEB, "editor.html")))) bad.push("画布容器缺底色（缩小时露灰）");

  ["sleep", "idle", "wander", "look"].forEach(function (a) {
    if (!new RegExp('"' + a + '"').test(npcSrc)) bad.push("NPC 行为缺 " + a);
  });

  if (!/右键只用来平移/.test(read(path.join(SRC, "loop.js")))) bad.push("右键没拦住点击（会误放物品）");
  if (!/编辑页不弹气泡/.test(read(path.join(SRC, "hud.js")))) bad.push("编辑页还会弹气泡");
  if (!/地图编辑页不显示名牌/.test(read(path.join(SRC, "npc.js")))) bad.push("编辑页还会显示 NPC 名牌");
  // v49：房间灯开关必须真的影响阴影浓度（预览不得强行当关灯）
  const mpSrc2 = read(path.join(SRC, "mapedit.js"));
  const mpSrc3 = mpSrc;
  if (/previewNight\(\) === "night"\) on = false/.test(mpSrc2)) bad.push("黑夜预览把开灯状态强行当关灯（灯开关无效）");
  if (!/function meSetRoomLight\(/.test(apiSrc2)) bad.push("editor-api 缺 setRoomLight（编辑器没法试开关）");
  // v49b：自定义阴影区域必须能归属到房间（否则单房间开灯不生效）
  if (!/function roomForRect\(/.test(mpSrc2)) bad.push("缺 roomForRect（自定义阴影区域不会跟随房间灯）");
  if (!/roomForRect\(Number\(o\.x\)/.test(mpSrc2)) bad.push("自定义阴影区域没自动绑定房间");
  if (!/var allRoomsOn/.test(mpSrc2)) bad.push("无房间归属的阴影块应与单个房间灯解耦（只在全屋开灯时亮）");
  if (!/跟随灯/.test(edJs)) bad.push("editor.js 缺阴影块的\"跟随灯\"选择器");
  // v50：灯开关必须是一件可摆放的素材（贴图 + 注册 + 点击切换）
  if (!/switch-off/.test(read(path.join(OFFICE, "tools", "gen_tiles.mjs")))) bad.push("gen_tiles 缺 switch-off 贴图");
  if (!fs.existsSync(path.join(WEB, "assets", "tiles", "switch-off.png")) || !fs.existsSync(path.join(WEB, "assets", "tiles", "switch-on.png"))) bad.push("assets/tiles 缺 switch-off/on.png");
  if (!/manifest\["switch"\]/.test(read(path.join(SRC, "boot.js")))) bad.push("boot.js 没注册 manifest.switch");
  if (!/function toggleSwitchAt\(/.test(read(path.join(SRC, "furniture.js")))) bad.push("缺 toggleSwitchAt（点开关切灯）");
  if (!/toggleSwitchAt\(p\.worldX/.test(read(path.join(SRC, "loop.js")))) bad.push("点击没接上灯开关");
  if (!/"switch"/.test(mpSrc)) bad.push("编辑器可选资产里没有 switch");
  // v51：窗/开关必须能贴到顶部墙带（band）
  if (!/f\.band \? WALL_H/.test(read(path.join(SRC, "placement.js")))) bad.push("makePlacement 不支持 band（墙饰贴不到墙带）");
  if (!/meWallAsset/.test(read(path.join(SRC, "editor-api.js")))) bad.push("editor-api 缺 meWallAsset（墙带内不能落笔）");
  if (!/v51：贴到顶部墙带/.test(read(path.join(SRC, "editor-api.js")))) bad.push("放置时没写 band 标记");
  if (!/ed-shadow-edit/.test(edJs)) bad.push("editor.js 缺选中块的浓度编辑面板（#ed-shadow-edit）");
  if (!/alphaNow/.test(edJs)) bad.push("editor.js 阴影列表没显示当前生效浓度");
  if (!/setShadowDefaults/.test(edJs)) bad.push("editor.js 缺新建块的默认浓度滑杆（setShadowDefaults）");
  if (!/forceNight/.test(read(path.join(SRC, "head.js"))) || !/forceNight/.test(read(path.join(SRC, "farm.js")))) bad.push("昼夜预览开关（forceNight）没接到 isNightHour");
  if (!/shadowAlphaOf/.test(mpSrc)) bad.push("阴影区域缺三档浓度取值函数");
  // 部署脚本要带 tiles
  if (!shSrc.includes("assets/tiles/")) bad.push("sync_web.sh 未同步 assets/tiles/");
  return { problems: bad, note: `${files.length} 个片段 · 地图贴图 ${tiles.length} 张 · 底图 RenderTexture` };
});

// ---------- 第 26 项：音频层（v2.7）----------
check("音频层（零素材合成 / 默认开 / 触发点接全）", () => {
  const bad = [];
  const SRC = path.join(WEB, "src");
  const audioSrc = read(path.join(SRC, "audio.js"));
  // 1) 默认开 + 主音量 0.35（用户 2026-11 拍板）；pref 存 localStorage
  if (!/=== null \? true : v === "1"/.test(audioSrc)) bad.push("audio.js 的默认值不是「开」（localStorage 缺省应为 true）");
  if (!/master\.gain\.value = on \? 0\.35/.test(audioSrc)) bad.push("audio.js 主音量默认值不是 0.35");
  if (!/office_audio/.test(audioSrc)) bad.push("audio.js 没把开关持久化到 localStorage.office_audio");
  // 2) 自动播放策略：必须挂在用户手势上
  if (!/pointerdown/.test(audioSrc) || !/AudioContext/.test(audioSrc)) bad.push("audio.js 缺手势解锁（pointerdown + AudioContext）");
  // 3) 三档事件音 + 三个高频音都要有
  ["small", "medium", "large"].forEach(t => { if (!new RegExp(t + ":\\s*\\{").test(audioSrc)) bad.push(`音频 tier 缺 ${t}`); });
  ["fx", "footstep", "typeTick"].forEach(fn => { if (!new RegExp("function " + fn + "\\(").test(audioSrc)) bad.push(`audio.js 缺 ${fn}()`); });
  // 4) 触发点必须真的接上（漏一处 = 那个动作是哑的）
  const wiring = [
    ["states.js", /Audio\.fx\(cfg\.mood === "error" \? "large" : "medium"/, "真实事件到达没出声"],
    ["states.js", /Audio\.typeTick\(\)/, "写作打字没声音"],
    ["life.js", /Audio\.fx\("small", curPlan\.cfg\.act\)/, "本地小动作没声音"],
    ["life.js", /Audio\.fx\("medium", msg\.eventKey\)/, "随机事件没声音"],
    ["life.js", /Audio\.setScene\(\{ room: zoneKey \}\)/, "走到水边没切声场"],
    ["npc.js", /Audio\.fx\("medium", "chat"\)/, "NPC 搭话没声音"],
    ["net.js", /Audio\.setScene\(\{ weather: msg\.weather \}\)/, "天气没接声场"],
    ["loop.js", /Audio\.footstep\(\)/, "走路没脚步"]
  ];
  wiring.forEach(([f, re, msg]) => { if (!re.test(read(path.join(SRC, f)))) bad.push(`${f}：${msg}`); });
  // 5) DOM 开关
  if (!indexSrc.includes('id="audio-toggle"')) bad.push("index.html 缺 #audio-toggle（顶栏声音开关）");
  if (!/aria-pressed/.test(indexSrc) || !/\.hbtn\s*\{/.test(indexSrc)) bad.push("index.html 缺开关的 aria-pressed / .hbtn 样式");
  // 6) 零素材：这条是设计约束 —— 有人手塞音频文件进来就直接报错（体积/许可/同步都不划算）
  const audioFiles = fs.readdirSync(ASSETS).filter(f => /\.(mp3|ogg|wav|m4a|aac|flac)$/i.test(f));
  if (audioFiles.length) bad.push(`assets/ 里出现音频文件（本层约定零素材合成）：${audioFiles.join(", ")}`);
  // 7) 可自动走查的只读快照
  if (!/__officeAudioState/.test(audioSrc)) bad.push("audio.js 没暴露 __officeAudioState（自动走查断言用）");
  return { problems: bad, note: "3 档事件音 · 4 个环境声部 · 8 处触发 · 0 素材" };
});

// ---------- 第 23 项：节奏（3 分钟窗口命中率）----------
check("节奏：任意 3 分钟窗口都要有事（beat-audit 仿真）", () => {
  const bad = [], warnings = [];
  let r = null;
  try { r = simulate({ days: 14 }); } catch (e) { return { problems: ["beat-audit 跑不起来：" + e.message] }; }
  if (r.rate < 0.85) bad.push(`3 分钟窗口命中率只有 ${(r.rate * 100).toFixed(1)}%（要求 ≥85%）：观众打开页面很可能什么都没发生`);
  if (r.perHour.micro > 40) warnings.push(`微事件 ${r.perHour.micro.toFixed(1)} 条/小时，偏密集（OFFICE_MICRO_MIN=${r.microMinSec}s）`);
  if (r.perHour.schedule < 0.3) bad.push("排班每小时不足 0.3 条：schedule.json 的班次太少，作息撑不起一天");
  if (r.perHour.random < 0.1) bad.push("随机事件每小时不足 0.1 条：random_events.json 的触发间隔太长");

  // 微事件表本身：只允许"一句话日常"，不许碰状态机
  let beats = null;
  try { beats = JSON.parse(read(path.join(OFFICE, "hub", "micro_events.json"))); } catch (e) { bad.push("micro_events.json 缺失或不是合法 JSON"); }
  const list = (beats && Array.isArray(beats.beats)) ? beats.beats : [];
  if (list.length < 10) bad.push(`micro_events.json 只有 ${list.length} 条（要求 ≥10，太少会很快重复）`);
  list.forEach((b, i) => {
    if (!b.key || !b.task) bad.push(`micro_events[${i}] 缺 key/task`);
    if (b.state) bad.push(`micro_events[${i}]（${b.key}）不该带 state：微事件只播报，不改状态机`);
    if (b.hours && (!Array.isArray(b.hours) || b.hours.length !== 2 || b.hours.some(h => h < 0 || h > 24))) {
      bad.push(`micro_events[${i}]（${b.key}）hours 必须是 [0..24, 0..24]`);
    }
    if (b.task && b.task.length > 20) warnings.push(`micro_events[${i}]「${b.task}」超过 20 字，气泡会截断`);
  });

  // 三层事件源必须都接上：hub 发、前端收、摘要行在 DOM 里
  if (!/micro_events\.json/.test(hubSrc) || !/function beatTick\(/.test(hubSrc)) bad.push("hub.mjs 没接微事件层（micro_events.json / beatTick）");
  if (!/type: "beat"/.test(hubSrc)) bad.push("hub.mjs 没广播 type:\"beat\"");
  if (!/OFFICE_MICRO_MIN/.test(hubSrc)) bad.push("hub.mjs 缺 OFFICE_MICRO_MIN 环境变量（间隔不可调）");
  const netSrc = read(path.join(WEB, "src", "net.js"));
  if (!/msg\.type === "beat"/.test(netSrc)) bad.push("net.js 没处理 beat 报文（前端收不到微事件）");
  if (!/pushEvent\(\{ state: "beat"/.test(netSrc)) bad.push("net.js 没把 beat 写进事件流");
  const actSrc = read(path.join(WEB, "src", "activity.js"));
  if (!/function noteDaily\(/.test(actSrc) || !/function renderDaily\(/.test(actSrc)) bad.push("activity.js 缺日常摘要（noteDaily / renderDaily）");
  if (!/office_daily_v1/.test(actSrc)) bad.push("activity.js 日常摘要没落 localStorage（刷新就丢）");
  if (!indexSrc.includes('id="act-daily"')) bad.push("index.html 缺 #act-daily 摘要行容器");
  if (!/\.act-row-beat/.test(indexSrc)) bad.push("index.html 缺 .act-row-beat 样式（微事件和真实事件分不出来）");
  if (!/noteDaily\(text\)/.test(read(path.join(WEB, "src", "life.js")))) bad.push("life.js 的 goLocal 没把本地小动作写进摘要");

  return {
    problems: bad, warnings,
    note: `命中率 ${(r.rate * 100).toFixed(1)}% · ${r.totalPerHour.toFixed(1)} 条/小时（微事件 ${r.perHour.micro.toFixed(1)}，间隔 ${r.microMinSec}s）· ${list.length} 条微事件`
  };
});

// ---------- 第 24 项：小地图（v2.7）----------
check("小地图（左上 / 500ms 重绘 / 点击跳转 / 房间矩形同源）", () => {
  const bad = [], warnings = [];
  const mmSrc = read(path.join(WEB, "src", "minimap.js"));
  // 1) DOM 与样式
  if (!indexSrc.includes('id="minimap"')) bad.push("index.html 缺 #minimap 容器");
  if (!indexSrc.includes('id="mm-canvas"')) bad.push("index.html 缺 #mm-canvas（小地图画布）");
  if (!indexSrc.includes('id="mm-fold"')) bad.push("index.html 缺 #mm-fold（折叠按钮）");
  if (!/#minimap\s*\{[^}]*position:\s*absolute/.test(indexSrc)) bad.push("#minimap 没做绝对定位（会挤跑画布布局）");
  if (!/#minimap\s*\{[^}]*left:\s*\d/.test(indexSrc)) bad.push("#minimap 没靠左（v2.7 决定的位置是左上）");
  // 2) 重绘节奏：太慢会顿、太快没必要（1680 格不该逐格画）
  const iv = /setInterval\(draw,\s*(\d+)\)/.exec(mmSrc);
  if (!iv) bad.push("minimap.js 缺 setInterval(draw, N)（没有定时重绘）");
  else {
    const ms = Number(iv[1]);
    if (ms < 250) bad.push(`小地图重绘间隔 ${ms}ms 太密（≥250ms，500ms 最好）`);
    if (ms > 1000) warnings.push(`小地图重绘间隔 ${ms}ms 偏慢，移动会跳格`);
  }
  // 3) 数据来源：她 / NPC / 视口框都要真的读运行时状态
  if (!/fishXY/.test(mmSrc)) bad.push("minimap.js 没读 __office.fishXY（画不出她在哪）");
  if (!/window\.__office\.npcs/.test(mmSrc)) bad.push("minimap.js 没读 __office.npcs（NPC 点缺失）");
  if (!/worldView/.test(mmSrc)) bad.push("minimap.js 没画视口框（worldView）：看不出镜头在哪一块");
  // 4) 点击跳转：必须停跟随，否则下一帧就被拉回去
  if (!/addEventListener\("click", onClick\)/.test(mmSrc)) bad.push("小地图没绑点击");
  if (!/stopFollow\(\)/.test(mmSrc) || !/\.pan\(/.test(mmSrc)) bad.push("小地图点击没有 stopFollow + pan（会被跟随立刻拉回）");
  // 5) 房间矩形必须与家具层同源（防止以后改房间尺寸时小地图变成一张假图）
  if (!/__officeRoomRects/.test(read(path.join(WEB, "src", "furniture.js")))) bad.push("furniture.js 没暴露 __officeRoomRects（小地图会画在旧坐标上）");
  if (!/window\.__officeRoomRects \|\|/.test(mmSrc)) bad.push("minimap.js 没有 __officeRoomRects 的兜底（加载顺序变化时会画空）");
  // 6) 折叠态记忆 + 自动走查快照
  if (!/office_minimap/.test(mmSrc)) bad.push("小地图折叠态没持久化（localStorage.office_minimap）");
  if (!/__officeMinimap/.test(mmSrc)) bad.push("小地图没暴露 __officeMinimap（自动走查断言用）");
  return { problems: bad, warnings, note: `168×90 CSS / ${iv ? iv[1] : "?"}ms 重绘 / 房间矩形同源家具层` };
});

// ---------- 第 25 项：相机与地图几何（v2.7-d）----------
check("相机（死区 / 锁定）与房间矩形几何", () => {
  const bad = [], warnings = [];
  const viewSrc = read(path.join(WEB, "src", "view.js"));
  const roomSrc = read(path.join(WEB, "src", "room.js"));
  const furnSrc = read(path.join(WEB, "src", "furniture.js"));

  // 1) 跟随死区：没有死区时，她每走两步镜头就漂，观众盯不住细节
  if (!/CAM_DEADZONE/.test(viewSrc)) bad.push("view.js 缺跟随死区常量（CAM_DEADZONE）");
  if (!/function beginFollow\(/.test(viewSrc) || !/cam\.setDeadzone\(/.test(viewSrc)) bad.push("view.js 的 beginFollow 没调 setDeadzone");
  if (/startFollow\(fish, true, 0\.08, 0\.08\)/.test(viewSrc.replace(/function beginFollow\([\s\S]*?\n  \}/, ""))) {
    bad.push("view.js 里还有绕过 beginFollow 的裸 startFollow（那里没有死区）");
  }
  // 2) 锁定视角：状态 + 持久化 + 顶栏按钮 + states 的运镜要认它
  if (!/var camLocked = false/.test(viewSrc) || !/function setCamLocked\(/.test(viewSrc)) bad.push("view.js 缺锁定视角（camLocked / setCamLocked）");
  if (!/office_camlock/.test(viewSrc)) bad.push("锁定态没持久化（localStorage.office_camlock）");
  if (!indexSrc.includes('id="cam-lock"')) bad.push("index.html 缺 #cam-lock 按钮");
  if (!/else if \(camLocked\)/.test(read(path.join(WEB, "src", "states.js")))) {
    bad.push("states.js 的观景运镜没认 camLocked：锁定后点事件还会搬镜头");
  }

  // 3) 房间矩形：互不重叠、每块至少装得下一件家具、邻居家的房子要在自己那块里
  const keys = ["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"];
  const rects = {};
  keys.forEach(k => {
    const m = new RegExp(k + ":\\s*\\[(\\d+),\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\]").exec(furnSrc);
    if (!m) bad.push(`furniture.js 的 SWITCH_ROOM_RECTS 缺 ${k}`);
    else rects[k] = { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
  });
  const inRect = (r, x, y) => r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  const ks = Object.keys(rects);
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const a = rects[ks[i]], b = rects[ks[j]];
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) bad.push(`房间矩形重叠：${ks[i]} × ${ks[j]}`);
    }
  }
  const placed = (map.furniture || []).filter(f => typeof f.x === "number" && typeof f.y === "number");
  ks.forEach(k => {
    const n = placed.filter(f => inRect(rects[k], f.x, f.y)).length;
    if (!n) bad.push(`房间 ${k} 的矩形里一件家具都没有：坐标多半是旧布局留下的`);
  });
  /* v88：房子精灵（homeCat/homeChief/homeDoc）已按用户要求删除 ——
   * 它们是初版临时过渡的门面（cottage / house-modern / farmhouse），本来就被自定义层 hide 掉了，
   * 玩家从来没看见过。原来的断言"必须存在且落在房间矩形里"是旧布局的产物，
   * 现在改成：**存在就校验位置，不存在不报警**。房间是否"有内容"由上面那条
   * "矩形里一件家具都没有"负责，不该再依赖某一个特定精灵。 */
  [["homeCat", "nbCat"], ["homeChief", "nbChief"], ["homeDoc", "nbDoc"]].forEach(([id, room]) => {
    const h = placed.find(f => f.id === id);
    if (!h) return;                                  // 已删除：不报警
    if (!inRect(rects[room], h.x, h.y)) {
      bad.push(`房子 ${id} 在 (${h.x}, ${h.y})，却不在 ${room} 的矩形里 —— 夜里开灯/阴影会作用到别人家`);
    }
  });
  // 4) NPC 的床必须在自家室内（v2.8 待清理：目前 catBed/chiefChair1 还在顶部旧位置）
  [["猫", "catBed", "nbCat"], ["村长", "chiefChair1", "nbChief"], ["博士", "docArm", "nbDoc"]].forEach(([who, id, room]) => {
    const b = placed.find(f => f.id === id);
    if (b && !inRect(rects[room], b.x, b.y)) {
      warnings.push(`${who}的床 ${id} 在 (${b.x}, ${b.y})，不在 ${room} 室内 —— 睡觉会走到空地上（v2.8 数据清理项）`);
    }
  });

  // 5) 大门：门洞不许再铺"路"（第 0 行整行不可走，铺路 = 假门）
  const band = /function paintTopBand[\s\S]*?\n  \}/.exec(roomSrc);
  if (!band) bad.push("room.js 找不到 paintTopBand");
  else {
    if (/tileTex\("road"\)/.test(band[0])) bad.push("paintTopBand 还在门洞铺 road：那是扇走不通的假门（第 0 行不可走）");
    if (!/tileTex\("wood"\)/.test(band[0])) bad.push("paintTopBand 的门洞没铺门板贴图（wood）");
  }
  if (!/grid\[0\]\[x0\] = 1|grid\[0\]\[x\] = 1/.test(furnSrc)) warnings.push("furniture.js 里没找到「贴墙根不可走」（grid[0][*] = 1），请人工确认假门修复前提仍然成立");

  const dz = /var CAM_DEADZONE = \[(\d+), (\d+)\]/.exec(viewSrc);
  return { problems: bad, warnings, note: `死区 ${dz ? dz[1] + "×" + dz[2] : "?"}px · ${ks.length} 个房间矩形无重叠 · 门洞已封板 · 家具落在 ${ks.filter(k => rects[k]).length} 块内` };
});

// ---------- 第 27 项：生活决策在 hub（v2.8-a）----------
check("生活决策在 hub（lifeTick / 数值单点结算 / 前端不再上报）", () => {
  const bad = [], warnings = [];
  const lifeSrc = read(path.join(WEB, "src", "life.js"));

  // 1) hub 侧：决策层存在、可调、自己结算数值
  if (!/function lifeTick\(/.test(hubSrc)) bad.push("hub.mjs 缺 lifeTick（生活决策没搬到服务端）");
  if (!/life_events\.json/.test(hubSrc)) bad.push("hub.mjs 没读 life_events.json");
  if (!/OFFICE_LIFE_MIN/.test(hubSrc)) bad.push("hub.mjs 缺 OFFICE_LIFE_MIN（决策间隔不可调）");
  if (!/if \(e\.fills\) applyStatDelta\(e\.fills\)/.test(hubSrc)) bad.push("hub.mjs 的 lifeTick 没自己结算 fills：数值仍要等浏览器上报，多开会叠加");
  if (!/"working"/.test(hubSrc) || !/"sleeping"/.test(hubSrc) || !/LIFE_BLOCKED/.test(hubSrc)) {
    bad.push("hub.mjs 缺 LIFE_BLOCKED（正事/睡觉会被生活决策打断）");
  }

  // 2) 事件表本身：状态必须合法、文案不能超气泡长度
  let life = null;
  try { life = JSON.parse(read(path.join(OFFICE, "hub", "life_events.json"))); } catch (e) { bad.push("life_events.json 缺失或不是合法 JSON"); }
  const list = (life && Array.isArray(life.events)) ? life.events : [];
  if (list.length < 15) bad.push(`life_events.json 只有 ${list.length} 条（要求 ≥15，否则来回就那几下）`);
  const declared = new Set((statesJson && statesJson.states) || []);
  const seen = new Set();
  list.forEach((e, i) => {
    if (!e.key || !e.state || !e.task) bad.push(`life_events[${i}] 缺 key/state/task`);
    if (e.state && !declared.has(e.state)) bad.push(`life_events[${i}]（${e.key}）的 state=${e.state} 不在 states.json 白名单：hub 会自己拒掉`);
    if (e.task && e.task.length > 20) warnings.push(`life_events[${i}]「${e.task}」超过 20 字，气泡会截断`);
    if (e.key) { if (seen.has(e.key)) bad.push(`life_events 里 ${e.key} 重复`); seen.add(e.key); }
    if (e.hours && (!Array.isArray(e.hours) || e.hours.length !== 2)) bad.push(`life_events[${i}]（${e.key}）hours 必须是 [起, 止]`);
    if (e.fills && Object.keys(e.fills).some(k => !["hunger", "mood", "energy", "social", "hygiene"].includes(k))) {
      bad.push(`life_events[${i}]（${e.key}）的 fills 有未知词条：${Object.keys(e.fills).join(",")}`);
    }
  });

  // 3) 前端侧：本地动作不再上报数值（这是"多开会叠加"的根源），且活动半径受限
  if (/postStatDelta\(curPlan\.statFill\)/.test(lifeSrc)) bad.push("life.js 的本地动作还在 postStatDelta：两个观众 = 她吃到两倍的饭");
  if (!/LOCAL_RADIUS/.test(lifeSrc) || !/hubOnlineForLife/.test(lifeSrc)) {
    bad.push("life.js 缺 LOCAL_RADIUS / hubOnlineForLife：hub 在线时前端仍会满地图乱跑，和 hub 决策互相打断");
  }

  // 4) 密度：搬上来之后 3 分钟窗口应该更满
  let r = null;
  try { r = simulate({ days: 14 }); } catch (e) { /* 由第 23 项报错 */ }
  if (r && r.perHour.life < 10) warnings.push(`生活决策只有 ${r.perHour.life.toFixed(1)} 条/小时，OFFICE_LIFE_MIN=${r.lifeMinSec}s 可能偏长`);

  return {
    problems: bad, warnings,
    note: `${list.length} 条生活事件 · 生活 ${r ? r.perHour.life.toFixed(1) : "?"} 条/小时 · 窗口命中 ${r ? (r.rate * 100).toFixed(1) + "%" : "?"}`
  };
});

// ---------- 第 28 项：农场在 hub（v2.8-a2）----------
check("农场在 hub（一份真相 / 种子闭环 / 前端只当画布）", () => {
  const bad = [], warnings = [];
  const farmSrc = read(path.join(WEB, "src", "farm.js"));

  // 1) hub 侧：存档 + 动作 + 生长 + 跨天
  if (!/OFFICE_FARM_FILE/.test(hubSrc)) bad.push("hub.mjs 缺 OFFICE_FARM_FILE（农场存档路径不可配）");
  if (!/req.url === "\/api\/farm" && req.method === "GET"/.test(hubSrc)) bad.push("hub.mjs 缺 GET /api/farm");
  if (!/req.url === "\/api\/farm" && req.method === "POST"/.test(hubSrc)) bad.push("hub.mjs 缺 POST /api/farm");
  if (!/function farmRollDay\(/.test(hubSrc)) bad.push("hub.mjs 缺跨天结算（farmRollDay）");
  if (!/function farmGrow\(/.test(hubSrc)) bad.push("hub.mjs 缺生长 tick（farmGrow）");
  ["till", "water", "sow", "feed", "harvest", "fish"].forEach(a => {
    if (!new RegExp('"' + a + '"').test(hubSrc)) bad.push(`hub.mjs 的动作表缺 ${a}`);
  });

  // 2) 种子闭环（这次修的就是「种三次后永久停摆」）
  if (!/farm\.inv\.seeds\[crop\] = \(farm\.inv\.seeds\[crop\] \|\| 0\) \+ 2/.test(hubSrc)) {
    bad.push("hub 没有「市集每天补 2 粒种子」：种子只减不增，17 格永远空着");
  }
  if (!/Math\.random\(\) < 0\.6/.test(hubSrc)) bad.push("收割没有返种子的概率（v2.8 闭环缺一半）");
  if (!/typeof d\.crop === "string"/.test(hubSrc)) bad.push("hub 播种没接前端传来的作物偏好：两边可能种出不同的作物");

  // 3) 前端：在线走 hub、离线留本地镜像；在线时生长不由前端推进（否则双倍生长）
  if (!/function farmOnline\(/.test(farmSrc) || !/function farmPost\(/.test(farmSrc) || !/function farmApply\(/.test(farmSrc)) {
    bad.push("farm.js 缺 hub 同步层（farmOnline / farmPost / farmApply）");
  }
  if (!/if \(farmOnline\(\)\) return;/.test(farmSrc)) bad.push("farm.js 的 farmTick 在线时仍在本地推进生长：会和 hub 各长一份");
  if (!/localStorage\.setItem\("office_farm_v1"/.test(farmSrc)) bad.push("farm.js 丢了本地镜像（离线兜底没了）");
  if (!/if \(farmOnline\(\) && r && r\.ok\)/.test(farmSrc)) bad.push("farm.js 的动作没回写 hub");
  if (!/farmPost\("fish"/.test(farmSrc)) bad.push("钓鱼鱼获没记到 hub：多开会各钓一份");
  if (/(farm\.inv\.feed \+=)[\s\S]{0,400}?farmPost\("fish"/.test(farmSrc) === false) warnings.push("钓鱼奖励与 hub 的概率表需人工核对一次（78/15/7）");

  return { problems: bad, warnings, note: "20 格 · 6 个动作 · 每天 +2 种子 · 收割 60% 返种" };
});

// ---------- 第 29 项：数值单点写入（v2.8-b1）----------
check("数值单点写入（前端只发意图 / hub 决定金额 / 本地开发也能连上）", () => {
  const bad = [], warnings = [];
  const lifeSrc = read(path.join(WEB, "src", "life.js"));
  const farmSrc = read(path.join(WEB, "src", "farm.js"));
  const npcSrc = read(path.join(WEB, "src", "npc.js"));
  const viewSrc2 = read(path.join(WEB, "src", "view.js"));

  // 1) hub 侧：交互表 + 配方表 + 端点
  if (hubSrc.indexOf("const INTERACT = {") < 0) bad.push("hub.mjs 缺 INTERACT 表（前端仍能自己决定加多少）");
  if (hubSrc.indexOf("const RECIPE_STATS = {") < 0) bad.push("hub.mjs 缺 RECIPE_STATS（做菜的数值没有服务端口径）");
  if (hubSrc.indexOf('"/api/interact"') < 0) bad.push("hub.mjs 缺 POST /api/interact");
  ["fish", "chat", "visit_home", "visit_away", "farm_work"].forEach(k => {
    if (hubSrc.indexOf(k + ":") < 0) bad.push("INTERACT 表缺 " + k);
  });

  // 2) 配方表两边必须对得上（少一道菜 → 那道菜做出来白吃）
  const ids = (farmSrc.match(/\{ id: "[a-z]+",\s+name: "[^"]+",\s+need:/g) || []).map(s => (/id: "([a-z]+)"/.exec(s) || [])[1]).filter(Boolean);
  if (ids.length < 8) bad.push("前端配方只解析出 " + ids.length + " 道（应 ≥8）");
  ids.forEach(id => { if (hubSrc.indexOf(id + ":") < 0) bad.push("RECIPE_STATS 缺「" + id + "」：做这道菜不会加数值"); });

  // 3) 前端不许再自己算 delta、也不许再写死反代前缀
  if (lifeSrc.indexOf("postStatDelta") >= 0) bad.push("life.js 还留着 postStatDelta：数值仍可能由前端决定");
  if ((lifeSrc + farmSrc).indexOf('fetch("/office-hub-api') >= 0) bad.push("前端仍硬编码 /office-hub-api 前缀（本地开发会静默 404）");
  if (lifeSrc.indexOf("function interact(") < 0 || lifeSrc.indexOf("function hubApiUrl(") < 0) bad.push("life.js 缺 interact / hubApiUrl");
  if (farmSrc.indexOf('interact("fish")') < 0) bad.push("farm.js 钓鱼没走 interact");
  if (farmSrc.indexOf('interact("cook"') < 0) bad.push("farm.js 做菜没走 interact");
  if (npcSrc.indexOf('interact("chat"') < 0) bad.push("npc.js 聊天没走 interact");
  if (viewSrc2.indexOf('"visit_home" : "visit_away"') < 0) bad.push("view.js 串门没走 interact");
  if (lifeSrc.indexOf('interact("farm_work")') < 0) bad.push("life.js 农活没走 interact");
  if (bad.length) warnings.push("改动后请跑一次 npm run dev 点一遍：钓鱼 / 做菜 / 聊天 / 串门 / 下地，看数值条是否都涨");

  return { problems: bad, warnings, note: ids.length + " 道菜的金额在 hub · 5 个交互统一结算 · 前端只剩意图" };
});

// ---------- 第 30 项：NPC 关系值（v2.9）----------
check("NPC 关系值（聊天累计 / 三个档位 / 台词与主动程度跟着变）", () => {
  const bad = [], warnings = [];
  const npcSrc = read(path.join(WEB, "src", "npc.js"));

  // 1) hub：存档 + 只增不减 + 上限 + 档位阈值 + 聊天挂钩
  if (hubSrc.indexOf("OFFICE_NPC_FILE") < 0) bad.push("hub.mjs 缺 OFFICE_NPC_FILE（关系值存档路径不可配）");
  if (hubSrc.indexOf("function bumpAffinity(") < 0) bad.push("hub.mjs 缺 bumpAffinity");
  if (hubSrc.indexOf("AFFINITY_CAP") < 0) bad.push("hub.mjs 缺关系值上限（会无限涨）");
  if (hubSrc.indexOf("function npcTier(") < 0) bad.push("hub.mjs 缺档位换算 npcTier");
  if (hubSrc.indexOf('kind === "chat") bumpAffinity') < 0) bad.push("hub.mjs 的 chat 交互没累计关系值");
  if ((hubSrc.match(/"close"/g) || []).length < 1 || (hubSrc.match(/"familiar"/g) || []).length < 1) {
    bad.push("hub.mjs 的档位缺 close/familiar");
  }
  if (hubSrc.indexOf("affinity: affinitySnapshot()") < 0) bad.push("/api/npc-feed 没下发关系值：前端挑不了台词档位");

  // 2) 前端：三条档位分支 + 不硬编码反代前缀 + 可断言快照
  if (npcSrc.indexOf("office-hub-api") >= 0) bad.push("npc.js 还硬编码 /office-hub-api 前缀（本地开发会静默 404）");
  ["stranger", "familiar", "close"].forEach(t => {
    if (npcSrc.indexOf(t) < 0) bad.push("npc.js 缺档位分支 " + t);
  });
  if (npcSrc.indexOf("feed.affinity") < 0) bad.push("npc.js 没从 feed 读 affinity（关系值白算了）");
  if (npcSrc.indexOf("__officeNpcRel") < 0) bad.push("npc.js 没暴露 __officeNpcRel（自动走查断言用）");
  if (npcSrc.indexOf("隔着半条街") < 0) warnings.push("close 档位的「主动挥手」文案没找到，确认是不是被改掉了");

  // 3) 只增不减、且不封顶到 100（那是数值条，不是关系）
  if (!/Math\.min\(AFFINITY_CAP,/.test(hubSrc)) bad.push("bumpAffinity 没做上限钳制");

  return { problems: bad, warnings, note: "3 档（<3 陌生 / 3~7 熟面 / >=8 亲近）· 上限 20 · 随 feed 下发" };
});

// ---------- 第 31 项：地图审计（v2.8-c）----------
check("地图审计（可走性 / 锚点 / 房间矩形 / 路网 / 地形 / NPC 活动区）", () => {
  const bad = [], warnings = [];
  let out = "";
  try {
    out = execFileSync(process.execPath, [path.join(OFFICE, "tools", "map-audit.mjs"), "--json"], { encoding: "utf8" });
  } catch (e) {
    return { problems: ["map-audit 跑不起来：" + (e.message || "").slice(0, 120)] };
  }
  let j = null;
  try { j = JSON.parse(out); } catch (e) { return { problems: ["map-audit --json 输出不是合法 JSON"] }; }
  const issues = j.issues || [];
  const p0 = issues.filter(i => i.sev === "P0");
  const p1 = issues.filter(i => i.sev === "P1");
  p0.concat(p1).forEach(i => bad.push("[" + i.sev + "] " + i.code + " " + i.msg));
  issues.filter(i => i.sev === "P2").forEach(i => warnings.push("[" + i.code + "] " + i.msg));
  // NPC 漫游区必须是矩形（v2.8-c 起）——旧的 [x0,x1] 会让三个邻居飘到房子北侧空草地上
  const npcSrc2 = read(path.join(WEB, "src", "npc.js"));
  const roamRects = npcSrc2.match(/roam: \{ x0:/g) || [];
  if (roamRects.length < 3) bad.push("npc.js 里少于 3 个矩形漫游区（还是旧的横向带格式：邻居会飘在离家很远的空地上）");
  let out2 = "";
  return { problems: bad, warnings, note: "可走 " + j.walkable + " 格 · 连通区 " + j.components + " 个 · P0 " + p0.length + " / P1 " + p1.length + " / P2 " + (issues.length - p0.length - p1.length) };
});

// ---------- 第 32 项：朝向门禁（v2.9 · 判据已按 §5.1 修正）----------
check("朝向门禁（R1 背靠墙 / R2 头靠墙 / R3 面桌 / R4 面茶几）", () => {
  let out = "";
  try {
    out = execFileSync(process.execPath, [path.join(OFFICE, "tools", "facing-check.mjs"), "--json"], { encoding: "utf8" });
  } catch (e) {
    // 有违规时 facing-check 退出码是 1，JSON 仍在 stdout 里
    out = String(e.stdout || "");
  }
  let j = null;
  try { j = JSON.parse(out); } catch (e) { return { problems: ["facing-check --json 输出不是合法 JSON"] }; }
  const v = j.violations || [];
  return {
    problems: v.slice(0, 8).map(x => "[" + x.rule + "] " + (x.room || "户外") + " " + x.a + "@" + x.x + "," + x.y + "  " + x.msg),
    note: "只断言可判定件 " + (j.checked || 0) + " 件 · 违规 " + v.length + " 处 · 墙格 " + (j.wallCells || 0)
  };
});

console.log("\noffice 静态自检\n" + "─".repeat(64));
results.forEach(r => {
  const tag = r.problems.length ? "[FAIL]" : (r.warnings.length ? "[WARN]" : "[ OK ]");
  if (r.problems.length) fails += r.problems.length;
  warns += r.warnings.length;
  console.log(`${tag} ${r.name}${r.note ? "  · " + r.note : ""}`);
  r.problems.forEach(p => console.log("         ✗ " + p));
  r.warnings.forEach(p => console.log("         ! " + p));
});
console.log("─".repeat(64));
console.log(`结果：${results.filter(r => !r.problems.length).length}/${results.length} 项通过 · ${fails} 个错误 · ${warns} 条警告\n`);
process.exit(fails ? 1 : 0);







































