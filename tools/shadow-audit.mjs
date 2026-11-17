// 第 5 维自检：断言渲染层的逐件阴影常量没被改坏（偏移/alpha/depth/flip/sc 跟随）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "web", "src", "furniture.js"), "utf8");

const checks = [
  ["阴影精灵存在（add.image 剪影）", /var shd = s\.add\.image\(p\.x \+ 6 \* shadowSc, p\.y \+ 10 \* shadowSc/.test(src)],
  ["水平偏移 +6", /p\.x \+ 6 \* shadowSc/.test(src)],
  ["垂直偏移 +10", /p\.y \+ 10 \* shadowSc/.test(src)],
  ["纯黑剪影 tint 0x000000", /\.setTint\(0x000000\)/.test(src)],
  ["alpha 固定 0.22", /\.setAlpha\(0\.22\)/.test(src)],
  ["深度压在本体下一层（depth - 1）", /setDepth\(Math\.max\(0, p\.depth - 1\)\)/.test(src)],
  ["flipX 同步镜像", /if \(f\.flipX\) shd\.setFlipX\(true\)/.test(src)],
  ["sc 缩放跟随", /if \(shadowSc !== 1\) shd\.setScale\(shadowSc\)/.test(src)],
  ["只给落地件加影（排除 o/wall/on）", /if \(!f\.o && !f\.wall && !f\.on\) \{/.test(src)]
];

let bad = 0;
console.log("\n逐件阴影自检（第 5 维）");
console.log("─".repeat(56));
checks.forEach(([name, ok]) => {
  console.log("  " + (ok ? "✓ " : "✗ ") + name);
  if (!ok) bad++;
});
console.log("─".repeat(56));
console.log(bad ? "✗ " + bad + " 项不通过（阴影层被改动）" : "✓ 9 项全部通过");
console.log("");
if (bad) process.exitCode = 1;
