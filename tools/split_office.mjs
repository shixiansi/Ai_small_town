/* 把 web/office.js 机械拆成 web/src/*.js 片段（一次性工具，保留在仓库里备查）。
 * 只按行号切、不改一个字符；office.js 由 tools/build.mjs 按文件名顺序拼回去。
 * 用法：node office/tools/split_office.mjs  （已拆过会覆盖 src 下的同名文件）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "web", "office.js");
const OUT = path.join(ROOT, "web", "src");

// [输出文件名, 起始行(1基), 结束行(含)]  —— 边界都落在 `// ---------- xxx ----------` 标题行上
const PARTS = [
  ["head.js", 1, 128],            // IIFE 开头 + 常量 + DOM/素材工具
  ["boot.js", 129, 304],          // 全局变量 + Boot 场景 + 主场景 create()
  ["npc.js", 305, 490],           // 小镇居民（本地状态机）+ 串门
  ["view.js", 491, 772],          // 房间切换 UI + 拖动视角 / 缩放
  ["placement.js", 773, 1020],        // makePlacement（bbox 定位）+ 灯光
  ["furniture.js", 1021, 1162],   // 家具层 + 碰撞格
  ["mapedit.js", 1163, 1649],     // 自定义层 + 游戏内编辑面板
  ["editor-api.js", 1650, 2226],      // 独立地图编辑器（三图层 API）
  ["pathfind.js", 2227, 2357],       // A* + 鱼 + 深度排序
  ["room.js", 2358, 2554],        // 房间底图（地板/墙/道路/窗）
  ["farm.js", 2555, 2980],        // 农场 / 鱼塘 / 料理
  ["hud.js", 2981, 3153],         // 证据板 / 画布文字 / 气泡 / 工作特效
  ["states.js", 3154, 3377],       // 真实事件 / 行走 / 动作
  ["life.js", 3378, 3984],        // 本地生活模拟
  ["loop.js", 3985, 4203],        // 主循环 + 点击
  ["net.js", 4204, 4336],         // WebSocket + 状态条
  ["activity.js", 4337, 4603],    // 最近动态窗 / 时间表
  ["start.js", 4604, 4646],        // Phaser 启动
  ["api.js", 4647, Infinity]      // window.__office / __officeCtl
];

const lines = fs.readFileSync(SRC, "utf8").split("\n");
fs.mkdirSync(OUT, { recursive: true });
let prev = null;
for (const [name, from, to] of PARTS) {
  const end = Math.min(to, lines.length);
  const body = lines.slice(from - 1, end).join("\n");
  if (prev && !/^\s*\/\/ -+ .* -+\s*$/.test(lines[from - 1] || "") && !/^\s*\/\* =+/.test(lines[from - 1] || "")) {
    console.warn(`warn: ${name} 的起始行不是段落标题：${JSON.stringify((lines[from - 1] || "").slice(0, 60))}`);
  }
  fs.writeFileSync(path.join(OUT, name), body);   // 不追加换行：build.mjs 用 "\n" 连接，才能还原成原文件
  console.log(`${name.padEnd(18)} ${from}-${end}  ${body.length} bytes`);
  prev = name;
}
console.log(`\n拆出 ${PARTS.length} 个片段 → web/src/`);

