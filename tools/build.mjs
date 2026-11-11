#!/usr/bin/env node
/**
 * 把 web/src/*.js 拼成 web/office.js（拼接顺序写死在 ORDER 里，不靠文件名排序）。
 *
 *   node office/tools/build.mjs          拼接 + 压缩注释/空白 → 写盘
 *   node office/tools/build.mjs --check  只比对：office.js 是否等于 build() 的结果
 *   node office/tools/build.mjs --raw    打印未压缩的拼接结果（调试用，不写盘）
 *
 * 为什么是"拼接"而不是 ES module：office.js 是一个 ~5000 行的 IIFE，内部上百个闭包变量互相引用。
 * 拆成 ES module 得把每个共享变量改成导出绑定，属于等价重写，风险远大于收益；
 * 片段 + 顺序拼接，源码可读、产物行为 100% 等价。
 *
 * 压缩只做"安全三件事"：删整行注释、删空行、去掉行首缩进（代码里没有多行模板字符串，
 * 且压缩后会跑一遍 node --check，语法不过就自动退回不压缩）。标识符/字符串一个字不动，
 * 所以 check.mjs 的那些特征串（"function applyCustomMap(" 之类）在产物里照样搜得到。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "web", "src");
const OUT = path.join(ROOT, "web", "office.js");

export const HEAD = "/* 本文件由 office/tools/build.mjs 从 web/src/*.js 拼接压缩生成，别直接改这里。改动请改 src/ 再 build。 */\n";

/* 拼接顺序（必须显式写死）：
 *   head 开 IIFE → 各功能片段 → start 里挂 DOMContentLoaded 启动 Phaser → api 定义 window.__office* 并闭合 IIFE。
 * 中间的片段之间只靠函数声明（会提升）和运行期取值，互相之间没有加载期依赖，但顺序仍要稳定可读。 */
export const ORDER = [
  "head.js",        // IIFE 开头 + 常量 + 素材/工具函数
  "boot.js",        // Boot 场景（预载）+ 主场景 create()
  "npc.js",         // 小镇居民状态机 + 串门
  "view.js",        // 房间切换 tab + 拖动视角/滚轮缩放
  "placement.js",   // bbox 定位计算 + 灯光/光池
  "furniture.js",   // 家具层 + 碰撞格推导
  "mapedit.js",     // 自定义层（可编辑数据）+ 游戏内编辑面板
  "editor-api.js",  // 独立地图编辑器三图层 API（window.__mapEditor）
  "pathfind.js",    // A* + 鱼本体 + 深度排序
  "room.js",        // 房间底图（tiles 贴图）
  "farm.js",        // 农场 / 鱼塘 / 料理
  "hud.js",         // 证据板 / 画布文字 / 气泡 / 工作特效
  "states.js",      // 真实事件 / 行走 / 动作表演
  "life.js",        // 本地生活模拟
  "loop.js",        // 主循环 + 点击语义
  "net.js",         // WebSocket + 状态条
  "activity.js",    // 最近动态窗 / 今日时间表
  "start.js",       // new Phaser.Game 启动
  "api.js"          // window.__office / __officeCtl + IIFE 收尾
];

/** 未压缩拼接结果（check.mjs 用它做特征串检查，注释还在） */
export function buildRaw(read) {
  const r = read || (f => fs.readFileSync(path.join(SRC_DIR, f), "utf8"));
  const missing = ORDER.filter(f => { try { r(f); return false; } catch { return true; } });
  if (missing.length) throw new Error("web/src 缺片段：" + missing.join(", "));
  const extra = fs.readdirSync(SRC_DIR).filter(f => f.endsWith(".js") && !ORDER.includes(f));
  if (extra.length) throw new Error("web/src 有未登记在 ORDER 里的片段：" + extra.join(", "));
  return ORDER.map(f => r(f)).join("\n");
}

/** 安全压缩：删整行注释 + 空行 + 行首缩进（不含多行模板字符串，压缩后由 node --check 兜底） */
export function compact(text) {
  const out = [];
  let inBlock = false;
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (inBlock) { if (t.endsWith("*/") || t.includes("*/")) inBlock = false; continue; }
    if (t.startsWith("/*")) { if (!t.includes("*/")) inBlock = true; continue; }
    if (!t || t.startsWith("//")) continue;
    out.push(t);
  }
  return out.join("\n") + "\n";
}

/** 产物：拼接 + 压缩（语法不过则退回未压缩） */
export function build(read) {
  const raw = buildRaw(read);
  const min = HEAD + compact(raw);
  if (read) return min;                       // bust.mjs 传自定义 read 时不落盘、不跑语法检查
  const tmp = path.join(ROOT, "web", ".office.check.js");
  fs.writeFileSync(tmp, min);
  const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
  fs.unlinkSync(tmp);
  if (r.status !== 0) {
    console.warn("warn: 压缩后语法检查失败，退回未压缩产物\n" + (r.stderr || "").split("\n").slice(0, 4).join("\n"));
    return HEAD + raw;
  }
  return min;
}

function main() {
  const text = build();
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  const norm = s => s.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  if (process.argv.includes("--check")) {
    const same = norm(cur) === norm(text);
    console.log(`${same ? "OK  " : "STALE"} web/office.js ← web/src/*.js（${ORDER.length} 个片段）`);
    if (!same) { console.error("office.js 与 src 不一致，先跑：node office/tools/build.mjs"); process.exit(1); }
    return;
  }
  if (process.argv.includes("--raw")) { console.log(buildRaw()); return; }
  if (norm(cur) === norm(text)) { console.log(`office.js 已是最新（${ORDER.length} 个片段，${text.length} 字符）`); return; }
  const rawLen = buildRaw().length;
  fs.writeFileSync(OUT, text);
  console.log(`已生成 web/office.js：${ORDER.length} 个片段，${rawLen} → ${text.length} 字符（省 ${Math.round((1 - text.length / rawLen) * 100)}%）`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
