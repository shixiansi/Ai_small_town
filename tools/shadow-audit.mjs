// 第 5 维自检：断言渲染层的逐件阴影是"接触阴影"，不是"复制一份本体贴图"
//
// v86 重做。旧版自检把错误的设计锁死了：它逐条断言
//   "阴影精灵存在（add.image 剪影）" / "tint 0x000000" / "偏移 +6/+10" / "flipX 同步镜像"
// —— 也就是"把家具自己再画一遍、涂黑、斜移"，看着就是物体被复制了一份。
// 门禁断言了一个错误的实现，等于把这个错误变成了"规格"。所以这里同时加了**反向断言**：
// 一旦有人把"复制贴图当阴影"写回来，第 1 条立刻红。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "web", "src", "furniture.js"), "utf8");
/* 断言只看代码，不看注释 —— 否则"注释里写了 setTint(0x000000) 解释为什么不能用它"
 * 会把反向断言判成红的（我就被自己写的注释坑了一次）。 */
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const checks = [
  // ---- 反向断言：这几条是"别再犯" ----
  ["不再复制本体贴图（源码里没有 setTint(0x000000) 的影子层）", !/setTint\(0x000000\)/.test(code)],
  ["影子不再按贴图原点/镜像复刻（没有 shd.setFlipX）", !/shd\.setFlipX/.test(code)],
  ["不再有专门的影子 image（没有 var shd = s.add.image）", !/var shd = s\.add\.image/.test(code)],

  // ---- 正向断言：接触阴影的规格 ----
  ["接触阴影存在（p.shadow = s.add.ellipse）", /p\.shadow = s\.add\.ellipse\(/.test(code)],
  ["宽度跟内容宽 × 缩放", /shW = p\.bbox\[2\] \* ssc \* 1\.08/.test(code)],
  ["高度有上下限（不随素材高度无限拉伸）", /Math\.max\(6, Math\.min\(14,/.test(code)],
  ["深度压在本体下一层（depth - 1）", /setDepth\(Math\.max\(0, p\.depth - 1\)\)/.test(code)],
  ["只给落地件加影（排除 o / wall / on）", /if \(!p\.wall && !p\.o && !f\.on\) \{/.test(code)],
  ["影子登记进 p.shadow，重建时能一起销毁（不再漏一层黑影子）", /if \(p\.shadow\) \{ try \{ p\.shadow\.destroy\(\); \} catch/.test(code)]
];

let bad = 0;
console.log("\n逐件阴影自检（第 5 维）");
console.log("─".repeat(64));
checks.forEach(([name, ok]) => {
  console.log("  " + (ok ? "✓ " : "✗ ") + name);
  if (!ok) bad++;
});
console.log("─".repeat(64));
console.log(bad ? "✗ " + bad + " 项不通过（阴影层被改动）" : "✓ " + checks.length + " 项全部通过");
console.log("");
if (bad) process.exitCode = 1;
