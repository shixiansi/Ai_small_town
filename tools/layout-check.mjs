#!/usr/bin/env node
/**
 * 摆放规则检查（tools/layout-check.mjs）—— 门禁第 33 项的 CLI 入口
 *
 *   node tools/layout-check.mjs            # 人读清单
 *   node tools/layout-check.mjs --json     # 机器可读（check.mjs 用这个）
 *   node tools/layout-check.mjs --code=E-PLACE   # 只看某一类
 *
 * 所有判定都来自 tools/map-model.mjs 的 layoutViolations()，分类来自 tools/asset-rules.mjs。
 * 这里只负责"排版 + 退出码"，**不重新实现任何判据**。
 */
import { loadModel } from "./map-model.mjs";
import { ASSET_RULES } from "./asset-rules.mjs";

const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("=");
  return i > 0 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));

const CODE_DESC = {
  "E-UNKNOWN": "素材未登记分类（无法判定，不许进场）",
  "E-PLACE": "分区错误（室内件到了户外 / 户外件进了房间）",
  "E-LAYER": "挂载层错误（墙 / 地 / 桌 三层放错）",
  "E-OVERLAP": "碰撞重叠（家具与设施一律不许重叠；植被之间豁免）",
  "E-WALL": "非挂墙件占了墙格",
  "E-ROAD": "落地件压在道路上",
  "E-HOST": "桌上件引用的 host 非法"
};

const model = loadModel();
let violations = model.layoutViolations();
if (arg.code) violations = violations.filter(v => v.code === arg.code);

const byCode = {};
violations.forEach(v => (byCode[v.code] = byCode[v.code] || []).push(v));

if (arg.json) {
  console.log(JSON.stringify({
    ruleCount: Object.keys(ASSET_RULES).length,
    checked: model.items.length,
    total: violations.length,
    byCode: Object.fromEntries(Object.entries(byCode).map(([k, v]) => [k, v.length])),
    violations
  }, null, 2));
  process.exit(violations.length ? 1 : 0);
}

console.log("\n摆放规则检查（引擎约束 · 非提示词）");
console.log("─".repeat(78));
console.log("  素材分类 " + Object.keys(ASSET_RULES).length + " 条 · 受检 " + model.items.length + " 件");
if (!violations.length) {
  console.log("  ✓ 全部通过：没有分区错误、没有挂载层错误、没有碰撞重叠");
  console.log("─".repeat(78) + "\n");
  process.exit(0);
}
Object.keys(byCode).sort().forEach(code => {
  console.log("\n[" + code + "] " + (CODE_DESC[code] || "") + "  共 " + byCode[code].length + " 处");
  byCode[code].forEach(v => {
    console.log("   " + String(v.asset).padEnd(16) + String(v.id || "-").padEnd(14) +
      "@" + String(v.x).padStart(6) + "," + String(v.y).padStart(6) +
      "  " + String(v.room || "户外").padEnd(10) + v.msg);
  });
});
console.log("\n" + "─".repeat(78));
console.log("合计 " + violations.length + " 处违规 —— 这些都是**错误**，不是建议。");
console.log("修法：先看 tools/asset-rules.mjs 里该素材的分类，再决定是改数据还是改分类。");
console.log("─".repeat(78) + "\n");
process.exit(1);
