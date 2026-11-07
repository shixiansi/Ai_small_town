#!/usr/bin/env node
/**
 * office 静态自检 —— 不开浏览器，把前几轮踩过的坑一次性挡住。
 *
 *   node office/tools/check.mjs
 *
 * 覆盖范围（与浏览器内 __officeCtl.zoneAudit() 同一套判定，坐标推导复刻 makePlacement /
 * buildBlockedGrid，避免「静态说没问题、画面全错」）：
 *   JSON / 常量一致性 / 状态→区域引用 / 锚点越界与阻挡 / 区域语义家具(2.2格) /
 *   坐席宿主 / 家具资产·on引用·帧号 / agent 状态名 / hub 状态清单双向一致 /
 *   线上调试台保护·hub 白名单与持久化·aria 防回退 / 鲸鱼女仆精灵表与动作帧 / 部署文件清单 /
 *   资源版本号 / 本地生活事件表（区域·动作·房间分布防回退）/ 画布文字缩放防回退 /
 *   画布铺满容器·调试台重排（防宽屏左右留白）
 *
 * 典型用法：改完 STATE_MAP、hub/states.json、map.json、agent/*.mjs 或 sync_web.sh 后跑一次；
 * sync_web.sh 已把它接成上线门禁，失败即中止同步。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dryRun } from "./bust.mjs";

const OFFICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT = path.resolve(OFFICE, "..");
const WEB = path.join(OFFICE, "web");
const ASSETS = path.join(WEB, "assets");
const read = f => fs.readFileSync(f, "utf8");
const pad2c = n => (n < 10 ? "0" : "") + n;
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
let map, manifest, officeSrc, indexSrc, shSrc, dbgSrc, hubSrc, statesJson = null;
try {
  map = JSON.parse(read(path.join(WEB, "map.json")));
  manifest = JSON.parse(read(path.join(ASSETS, "manifest.json")));
  officeSrc = read(path.join(WEB, "office.js"));
  indexSrc = read(path.join(WEB, "index.html"));
  dbgSrc = read(path.join(WEB, "debug.js"));
  hubSrc = read(path.join(OFFICE, "hub", "hub.mjs"));
  shSrc = read(path.join(OFFICE, "sync_web.sh"));
  try { statesJson = JSON.parse(read(path.join(OFFICE, "hub", "states.json"))); } catch { /* 由专门一项报错 */ }
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
  (map.walls || []).forEach(wl => {
    for (let wy = 0; wy < ROWS; wy++) {
      if (wl.gap && wy >= wl.gap[0] && wy <= wl.gap[1]) continue;
      if (grid[wy]) grid[wy][wl.x] = 1;
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

check("agent 推送状态 ⊆ STATE_MAP", () => {
  const dir = path.join(PROJECT, "agent");
  if (!fs.existsSync(dir)) return { warnings: ["未找到 agent/ 目录，跳过"], note: "跳过" };
  const used = new Set();
  fs.readdirSync(dir).filter(f => f.endsWith(".mjs")).forEach(f => {
    const t = read(path.join(dir, f));
    for (const m of t.matchAll(/\b(?:office|done)\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g)) used.add(m[1]);
    if (/endState\s*=\s*"(\w+)"/.test(t)) used.add(RegExp.$1);   // officeRun 默认收尾状态
  });
  const bad = [...used].filter(s => !STATE[s]).map(s => `agent 推了 "${s}"，前端会静默兜底成 idle`);
  return { problems: bad, note: `${used.size} 个状态名，0 缺失` };
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
  const need = ["index.html", "office.js", "debug.js", "map.json", "assets/*.png", "assets/*.json", "phaser.min.js"];
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

check("最近动态窗（事件流 / 今日时间表 / crontab 对齐）", () => {
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

  // ---- 4) 时间表 ↔ scripts/crontab.txt 双向核对 ----
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
  ["每日 agent（第一场）", "每日 agent（第二场）", "每日运营", "回博客评论", "B站互动", "备份数据"].forEach(k => {
    if (!shifts.some(s => s.label === k)) bad.push(`SCHEDULE 少了「${k}」这一班（时间表要和服务器真实排班一致）`);
  });
  if (!shifts.some(s => s.weekday === "0")) bad.push("SCHEDULE 里没有周日专属班次（鱼缸周报 20:00）");

  const cronPath = path.join(PROJECT, "scripts", "crontab.txt");
  let cron = null;
  if (!fs.existsSync(cronPath)) bad.push("缺 scripts/crontab.txt：页面上的时间表就没法和服务器排班核对");
  else {
    cron = read(cronPath).split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"))
      .map(l => l.split(/\s+/)).filter(f => f.length >= 6)
      .map(f => ({ min: f[0], hour: f[1], dom: f[2], mon: f[3], dow: f[4], cmd: f.slice(5).join(" ") }));
    const minOK = (field, m) => field === String(m) || field === "*" || (field.startsWith("*/") && m % Number(field.slice(2)) === 0);
    const hourOK = (field, h, every) => {
      if (field.startsWith("*/")) { const step = Number(field.slice(2)); return step > 0 && h % step === 0; }
      if (field.includes(",")) return field.split(",").map(Number).includes(h);
      return field === "*" || Number(field) === h;
    };
    shifts.filter(s => s.at).forEach(s => {
      const [hh, mm] = s.at.split(":").map(Number);
      const hit = cron.find(c => minOK(c.min, mm) && hourOK(c.hour, hh, s.every) &&
        (s.weekday != null ? c.dow === s.weekday : c.dow === "*"));
      if (!hit) bad.push(`时间表里的 ${s.at}「${s.label}」在 scripts/crontab.txt 找不到对应排班（改了 cron 忘了改页面，或者反过来）`);
    });
    // 反向：crontab 里跑 agent 的班次，页面上也该有 → 只告警，避免以后加新定时任务就卡门禁
    cron.filter(c => /agent\.mjs|weekly\.mjs|bili_interact\.mjs/.test(c.cmd)).forEach(c => {
      const hh = Number(c.hour.split(",")[0]);
      const mm = Number(c.min);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return;
      const at = pad2c(hh) + ":" + pad2c(mm);
      if (!shifts.some(s => s.at === at || (s.every && hh % s.every === 0 && s.at.slice(3) === at.slice(3)))) {
        warnings.push(`crontab 的 ${c.min} ${c.hour} * * * 没写进页面时间表（${c.cmd.split(" ").slice(-2).join(" ")}）`);
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
    note: `${shifts.length} 班 / wake ${wakeM ? wakeM[1] + ":00–" + wakeM[2] + ":00" : "?"} / crontab ${cron ? cron.length : 0} 条`
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
  for (const needle of ["function onStats(", 'msg.type === "stats"', "function renderStatsBar(", "var EVENT_NEED", "function needBoost(", "function statFillFor(", "function postStatDelta("])
    if (!officeSrc.includes(needle))
      problems.push(`office.js 缺 ${needle}`);
  // 3) index.html 必须有 stats-bar DOM 与样式
  if (!indexSrc.includes('id="stats-bar"'))
    problems.push("index.html 缺 #stats-bar 容器");
  if (!indexSrc.includes(".stat-fill"))
    problems.push("index.html 缺 .stat-fill 样式");
  // 4) nginx 反代（sync 不覆盖 nginx，单独提醒）
  let ng = "";
  try { ng = read("/www/server/panel/vhost/nginx/news.shixiansi.pw.conf"); } catch { warnings.push("读不到 nginx 配置，跳过反代检查"); }
  if (ng && !ng.includes("/office-hub-api/"))
    problems.push("nginx 缺 /office-hub-api/ 反代");
  // 5) EVENT_NEED 的 key 必须都在 LOCAL_EVENTS 里
  const needKeys = [...officeSrc.matchAll(/\b([a-z_2]+):\s*\{\s*need:/g)].map(m => m[1]);
  const evKeys = [...officeSrc.matchAll(/\{ key: "([a-z_2]+)"/g)].map(m => m[1]);
  const missing = needKeys.filter(k => !evKeys.includes(k));
  if (missing.length) problems.push(`EVENT_NEED 引用了不存在的事件: ${missing.join(", ")}`);
  return { problems, warnings, note: `${needKeys.length} 条事件挂需求 · 5 词条 · hub 真相源` };
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
