#!/usr/bin/env node
/**
 * 桌面落位推导（tools/surface-fit.mjs）
 *
 *   node tools/surface-fit.mjs            # 预览：每件桌上物品推导出来的 dx/dy
 *   node tools/surface-fit.mjs --apply    # 写回 web/map.json
 *
 * 为什么需要它：
 *   以前桌上物品的 dx/dy 是**手试**出来的。手试有三个必然结果：
 *     · 忘记写 → 贴到宿主顶边 → 看着悬空（果盘那次）
 *     · 猜小了 → 沉进桌面、被桌子挡住
 *     · 猜大了 → 浮在桌上方，或者压到旁边的物件上
 *   70 个素材里 68 个的 bbox 都不在 48px 网格上，手试永远调不完。
 *
 * 现在改成推导（成熟 2D 游戏的通行做法）：
 *   dy = SURFACE[宿主素材]                       ← 台面高度，量一次写进 asset-rules
 *   dx = 该宿主上第 i 件（共 n 件）的等分槽位      ← 自动排布，不重叠
 * 于是"果盘在哪"不再是一个随手填的数字，而是素材属性 + 排布顺序的唯一结果。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { surfaceOf, ruleOf } from "./asset-rules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP = path.join(ROOT, "web", "map.json");
const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "assets", "manifest.json"), "utf8"));

const apply = process.argv.includes("--apply");
const map = JSON.parse(fs.readFileSync(MAP, "utf8"));
/* 宿主可能定义在**自定义层**（hub/map.custom.json）里 —— 只读 base 会把
 * cumw9ba88s66k 这种编辑器放的桌子判成"不存在"（第一次跑就这么漏了 2 件）。 */
let customFurn = [];
try {
  const cj = JSON.parse(fs.readFileSync(path.join(ROOT, "hub", "map.custom.json"), "utf8"));
  customFurn = cj.furniture || [];
} catch (e) { /* 没有自定义层也能跑 */ }
const furn = (map.furniture || []).concat(customFurn);

const byId = new Map();
furn.forEach(f => { if (f.id) byId.set(f.id, f); });
const baseIds = new Set((map.furniture || []).map(f => f.id).filter(Boolean));

/* 素材级渲染缩放（manifest.artScale）。宽度一律按它算 ——
 * 不用 map.json 的 `sc`：那个字段运行时根本不生效（构建产物里搜不到 `.sc`），
 * 以前拿它算宽度，算出来"果盘 21px"而实际渲染 32.7px，布局自然顶到桌沿。 */
const renderScale = a => {
  const m = MAN[a];
  return (m && typeof m.artScale === "number") ? m.artScale : 1;
};

/* 按宿主分组：同一张桌子上的东西按出现顺序排成一排 */
const groups = new Map();
furn.forEach(f => {
  if (!f.on) return;
  if (!groups.has(f.on)) groups.set(f.on, []);
  groups.get(f.on).push(f);
});

let changed = 0, skipped = 0;
const report = [];

for (const [hostId, items] of groups) {
  const host = byId.get(hostId);
  if (!host) { console.log("✗ host 不存在: " + hostId); skipped += items.length; continue; }
  const surf = surfaceOf(host.a);
  if (surf == null) {
    console.log("✗ 宿主 " + hostId + "(" + host.a + ") 没有在 SURFACE 表里登记台面高度 —— 先补 asset-rules.mjs");
    skipped += items.length;
    continue;
  }
  const hostW = (MAN[host.a] && MAN[host.a].bbox[2]) || 32;
  const n = items.length;

  /* 排布算法：**按物品实际宽度并排摆放，整组居中**（装箱，不是等分槽位）。
   *
   * 旧写法是等分槽位（`dx = (i-(n-1)/2) * step`），它有两个致命前提：
   *   ① 假设所有物品一样宽 —— 实际笔记本 22px、果盘 30px×0.7=21px、纸堆 20px
   *   ② 假设 step 小于台面宽就够了 —— 但从没检查"两件物品的半宽之和"是否超过 step
   * 结果就是用户截图里那样：两件东西被同时推到左右边缘，中间空一大块，看着像要掉下去。
   *
   * 正确做法（Tiled/Stardew 一脉的通行处理）：
   *   total = Σ 每件实际宽 + gap×(n-1)      ← 整组占多宽
   *   从 -total/2 起逐个"贴着放"，每组中心落在台面中心
   *   单件自然居中（dx=0），多件自然铺开且不重叠
   */
  const GAP = 2;              // 物品之间的最小缝隙（px）
  const EDGE = 3;             // 台面左右各留的边距（px），避免贴到桌沿
  const maxW = Math.max(6, hostW - EDGE * 2);
  const ROW_GAP = 5;          // 后排比前排抬高多少（3/4 视角下"往里放"）
  const TARGET = 0.68;        // 整组最多占台面可用宽度的 75%，剩下留边距

  /* 自动缩放：桌上物品太大时按比例缩小，让整组落在台面中间并留出边距。
   * 为什么需要它：餐桌面 58px，笔记本 22 + 果盘 21 + 缝隙 = 45px，占 78%。
   * 怎么排都会顶到左右桌沿，笔记本的屏幕还会探出桌外 —— 用户看到的就是"快飘出去了"。
   * 成熟做法是把桌上摆件按台面尺寸缩放（不是硬塞），这样视觉上才是"摆在桌上"。
   * 下限 0.55：再小就看不清是什么东西了，那时改用两排。 */
  /* 自动缩放是**一次性动作**（--scale），不参与每次推导。
   * 踩过的坑：把缩放塞进推导里会变成"sc 变→宽度变→dx 变→下次又算出新 sc"，
   * 工具永远收敛不了，门禁第 34 项一直红（实测：写入 18 件后立刻又报 17 件不一致）。
   * 所以拆开：
   *   --scale：按台面宽度调一次 sc（写盘后不再变动）
   *   默认    ：只按"当前宽度"推导 dx/dy，纯函数，跑多少次结果一样 */
  /* 缩放**永远从素材级 artScale 推导**，不看实例级 artScale。
   * 这是幂等的关键：如果拿"当前生效的"缩放去算，缩过一次之后下次又按缩小后的宽度算，
   * 会一路缩下去（或者来回震荡）。基准固定 → 结果固定。 */
  const baseSizes = items.map(it => {
    const m = MAN[it.a];
    const base = (m ? m.bbox[2] : 32) * renderScale(it.a);
    return { it, baseW: Math.max(6, Math.round(base)), baseSc: renderScale(it.a) };
  });
  const rawTotal = baseSizes.reduce((s, o) => s + o.baseW, 0) + GAP * Math.max(0, baseSizes.length - 1);
  // 台面放不下就按比例缩，下限 0.55（再小就认不出是什么了，那时改用两排）
  const fitScale = rawTotal > maxW * TARGET
    ? Math.max(0.55, (maxW * TARGET) / rawTotal)
    : 1;
  const sizes = baseSizes.map(o => ({
    it: o.it,
    w: Math.max(6, Math.round(o.baseW * fitScale)),
    newSc: Math.round(o.baseSc * fitScale * 1000) / 1000,
    scaled: fitScale < 1
  }));

  /* 一行放不下就分两排 —— 桌面本来就有纵深。
   * 为什么必须允许两排：办公桌宽 42px，一台显示器就占 40px，
   * 强行"三件并排不重叠"在几何上无解（实测 total 71px vs 可用 36px）。
   * 成熟 2D 游戏（Stardew / RPG Maker）桌上摆件就是按前/后排放的，
   * 靠 depth 排序自然遮挡，而不是硬挤在一行。 */
  function layoutRow(list) {
    const total = list.reduce((s, o) => s + o.w, 0) + GAP * Math.max(0, list.length - 1);
    const scale = total > maxW ? maxW / total : 1;   // 一行仍放不下 → 等比压缩（宁可略叠，也不出桌沿）
    let c = -(total * scale) / 2;
    const positions = list.map(o => {
      const cx = c + (o.w * scale) / 2;
      c += o.w * scale + GAP * scale;
      return cx;
    });
    return { total, scale, positions };
  }

  // 先试一排，放不下就分两排
  const oneRow = layoutRow(sizes);
  let rows;
  if (oneRow.total <= maxW || sizes.length === 1) {
    rows = [{ list: sizes, dy: surf }];
  } else {
    /* 分两排的排法：**最宽的那件单独占后排，其余小件排前排**。
     * 不按"对半分"——对半会把两件大东西一起塞进后排，仍然互相挤压。
     * 实际桌面也是这样：显示器靠里，笔筒、台灯在它前面一字排开。 */
    const sorted = [...sizes].sort((a, b) => b.w - a.w);
    const back = [sorted[0]];
    const front = sorted.slice(1);
    rows = [
      { list: back, dy: surf - ROW_GAP },   // 后排：抬高一点 = 往里
      { list: front, dy: surf }
    ];
  }

  let overflow = "";
  const oneRowTotal = oneRow.total;
  if (oneRowTotal > maxW && sizes.length > 1) {
    overflow = "台面宽 " + hostW + " 一行放不下 " + oneRowTotal + "px，已分 " + rows.length + " 排";
  }

  rows.forEach(row => {
    const lay = layoutRow(row.list);
    row.list.forEach(({ it, w, newSc, scaled }, i) => {
      const dx = Math.round(lay.positions[i]);
      const dy = row.dy;
      const before = (it.dx === undefined ? "—" : it.dx) + "/" + (it.dy === undefined ? "—" : it.dy);
      const after = dx + "/" + dy;
      /* 缩放是否已同步：比的是**实例级 artScale**（运行时真正读的字段），
       * 不是 map.json 里的 `sc`（死字段，没人读，拿它比会永远判"不一致"）。 */
      const wantSc = scaled ? newSc : undefined;
      const curSc = typeof it.artScale === "number" ? it.artScale : undefined;
      const scBad = scaled
        ? Math.abs((curSc === undefined ? -1 : curSc) - wantSc) > 0.001
        : (curSc !== undefined);
      const bad = it.dx !== dx || it.dy !== dy || scBad;
      if (bad) changed++;
      report.push({
        host: hostId, hostAsset: host.a, item: it.id, asset: it.a,
        w, before, after, ok: !bad, overflow,
        sc: scaled ? (curSc === undefined ? "—→" : curSc + "→") + wantSc : ""
      });
      /* 只写回 base 层（web/map.json）。自定义层的件属于 hub/map.custom.json，
       * 本工具不改它，只报告它的推导值（避免把两个文件写出分歧）。 */
      if (apply && baseIds.has(it.id)) {
        it.dx = dx; it.dy = dy;
        /* 缩放写进**实例级 artScale**（运行时优先读它），不写 sc ——
         * sc 是历史死字段，构建产物里没有任何代码读它。 */
        if (scaled) it.artScale = Math.round(newSc * 1000) / 1000;
        else delete it.artScale;
      }
    });
  });
}

console.log("\n桌面落位推导  " + (apply ? "【写入】" : "【预览】"));
console.log("─".repeat(92));
console.log("宿主".padEnd(18) + "桌上物品".padEnd(24) + "素材".padEnd(14) + "宽".padEnd(5) + "原 dx/dy".padEnd(12) + "推导 dx/dy");
report.forEach(r => {
  console.log(r.host.padEnd(18) + String(r.item).padEnd(24) + String(r.asset).padEnd(14) +
    String(r.w).padEnd(5) + String(r.before).padEnd(12) + String(r.after) + (r.ok ? "" : "   ← 修正"));
});
console.log("─".repeat(92));
console.log("共 " + report.length + " 件，需要修正 " + changed + " 件" + (skipped ? "，跳过 " + skipped + " 件" : ""));
const over = [...new Set(report.filter(r => r.overflow).map(r => r.host + ": " + r.overflow))];
if (over.length) { console.log("\n⚠ 台面放不下（物品总宽超过台面）："); over.forEach(o => console.log("   " + o)); }

if (apply) {
  fs.writeFileSync(MAP, JSON.stringify(map, null, 1));
  console.log("\n✓ 已写回 web/map.json（记得 bust → check）");
} else {
  console.log("\n（预览，未写盘；加 --apply 落盘）");
}
process.exit(skipped ? 1 : 0);

