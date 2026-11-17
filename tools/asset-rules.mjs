#!/usr/bin/env node
/**
 * 素材摆放规则（tools/asset-rules.mjs）—— 素材层的**唯一事实源**
 *
 * 为什么要有这个文件：
 *   以前的 manifest.json 只有几何（frameW/bbox/bboxRows），**没有任何分类**。
 *   于是"户外摆设被摆进房间"（fence-picket / sign-inn / bench-park / bush 进了
 *   parkCourt/brickHall/kitchen/office）、"花花草草塞在厨房台面上"这类错误
 *   **在数据层根本无法表达**，只能靠人看图发现，发现一批修一批，改一次又错回来。
 *
 *   这里把三件事从"提示词"变成"可判定的数据"：
 *     1. where  ISO_PLACE  这件素材属于室内还是室外
 *     2. mount  MOUNT      它只能贴在哪儿：地上 floor / 墙上 wall / 桌面上 top
 *     3. body   BODY       它在引擎里的碰撞体积：无人（纯装饰）/ 1 格主干 / 整块 bbox
 *
 *   check.mjs（门禁）、map-model.mjs（判据）、place.mjs（落位）全部 import 这里，
 *   谁也不许自己再写一份分类 —— 这就是"引擎约束"与"提示词约束"的区别。
 *
 *   node tools/asset-rules.mjs            # 打印分类表
 *   node tools/asset-rules.mjs --json     # 机器可读
 *   node tools/asset-rules.mjs --audit    # 与 manifest 交叉校验：有没有漏标的素材
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAN = path.join(ROOT, "web", "assets", "manifest.json");

/** 1) where：这件素材在语义上属于哪一侧 */
export const ISO_PLACE = {
  indoor: "室内专用",
  outdoor: "室外专用",
  both: "两侧都合理（如绿植、灯具）"
};

/** 2) mount：允许贴在哪个层 */
export const MOUNT = {
  floor: "只能落地",
  wall: "只能挂墙",
  top: "只能叠在桌面/台面（跟随 host）",
  floor_or_top: "可落地，也可放在桌上（小摆件）"
};

/** 3) body：碰撞体积口径 —— 决定"能不能重叠" */
export const BODY = {
  none: "无碰撞（纯装饰贴图，允许与其他件同格）",
  cell: "占 1 格主干（树/灌木/花：树冠可交叠，根部占一格）",
  full: "占整块 bbox 投影（家具/设施的硬碰撞）"
};

/**
 * 4) SURFACE —— 台面高度表（成熟 2D 游戏的通行做法：**量一次美术，写进素材库，之后全靠推导**）
 *
 * 为什么需要它：
 *   往桌上放东西，运行时是 `y = 宿主内容顶边 + dy`。以前 dy 靠人手试——
 *   果盘那次就是 dy 缺失→贴到顶边→看着悬空；dy 猜错→压到笔记本上。
 *   手试永远调不完（70 个素材里 68 个的 bbox 都不在 48px 网格上）。
 *
 * 口径（与运行时一致，别自己发明）：
 *   surface = **距宿主内容顶边多少像素处是台面**，单位是源像素。
 *   物品的**内容底边**落在这一条线上。
 *
 * 取值方法（只需做一次）：
 *   node tools/zz-surface.mjs <素材名...>   → 出带 4px 标尺的放大图，肉眼读出"桌面那条横线"的数值
 *   量的是**台面所在那一行**，不是"最宽行"（自动测过：kitchen-counter 会被量成 1，因为柜体后沿更宽）
 *
 * 没有列在这里的素材 = 不承载任何东西（不是台面）。
 */
export const SURFACE = {
  "dining-table":    17,   // 桌面木板上下沿约 8..26，取板面中线
  "round-table":     16,   // 椭圆桌面中线
  "desk-wood":       12,   // 书桌台面
  "office-desk":      9,   // 办公桌台面
  "school-desk":     14,   // 课桌台面
  "kitchen-counter":  7,   // 台面板厚度 0..14，取中线
  "cabinet":          7,   // 柜顶面
  "nightstand":       6,   // 床头柜台面
  "bookshelf-office": 6,   // 书架顶层
  "potion-shelf":     6,   // 药水架顶层
  "arcade-cabinet":  18,   // 街机操作台
  "gramophone":      13,   // 留声机台面
  "stove-kitchen":   18,   // 灶台面
  "fridge":           5,   // 冰箱顶
  "sink":            19,   // 洗手盆平面
  "printer":          8,   // 打印机顶
  "water-cooler":     4,   // 饮水机顶
  "locker":           4,   // 更衣柜顶
  "filing-cabinet":   4,   // 文件柜顶
  "counterA":         7,
  "sofa":            14,   // 沙发坐面（书上/杯子放得下的那条线）
  "stall-fruit":     24    // 水果摊台面
};

/** 这件素材能不能承载桌面物品；返回台面高度（px），不能承载返回 null */
export function surfaceOf(asset) {
  const v = SURFACE[asset];
  return typeof v === "number" ? v : null;
}

/**
 * 主表。**新增素材必须在这里登记**，否则 check.mjs 第 33 项会直接报错
 * （未登记 = 无法判定 = 不允许进场景）。
 *
 * 字段：
 *   place  室内/室外/两侧
 *   mount  允许的挂载层（数组，元素取自 MOUNT 的键）
 *   body   碰撞口径（取自 BODY 的键）
 *   note   一句话说明它是什么（给下一个人看）
 */
export const ASSET_RULES = {
  // ---------- 室外：植被（主干 1 格，树冠可交叠） ----------
  "oak-tree":     { place: "outdoor", mount: ["floor"], body: "cell", note: "橡树，树干占 1 格，树冠视觉可交叠" },
  "bush":         { place: "outdoor", mount: ["floor"], body: "cell", note: "灌木丛" },
  "flowers":      { place: "outdoor", mount: ["floor"], body: "cell", note: "花丛/花盆（户外）" },

  // ---------- 室外：设施（硬碰撞） ----------
  "fence":        { place: "outdoor", mount: ["floor"], body: "full", note: "栅栏（长条）" },
  "fence-picket": { place: "outdoor", mount: ["floor"], body: "full", note: "尖头木栅栏，围合用" },
  "street-lamp":  { place: "outdoor", mount: ["floor"], body: "full", note: "路灯" },
  "well":         { place: "outdoor", mount: ["floor"], body: "full", note: "水井" },
  "bench-park":   { place: "outdoor", mount: ["floor"], body: "full", note: "公园长椅" },
  "market-stall": { place: "outdoor", mount: ["floor"], body: "full", note: "市集棚位" },
  "stall-fruit":  { place: "outdoor", mount: ["floor"], body: "full", note: "水果摊" },
  "sign-inn":     { place: "outdoor", mount: ["wall"], body: "none", note: "客栈招牌，挂墙" },
  "mailbox":      { place: "outdoor", mount: ["wall"], body: "none", note: "信箱，挂门边墙上" },
  "cottage":      { place: "outdoor", mount: ["floor"], body: "full", note: "小屋（建筑体）" },
  "farmhouse":    { place: "outdoor", mount: ["floor"], body: "full", note: "农舍（建筑体）" },
  "house-modern": { place: "outdoor", mount: ["floor"], body: "full", note: "现代住宅（建筑体）" },

  // ---------- 室内：家具（硬碰撞，落地） ----------
  "office-desk":    { place: "indoor", mount: ["floor"], body: "full", note: "办公桌" },
  "desk-wood":      { place: "indoor", mount: ["floor"], body: "full", note: "木书桌" },
  "school-desk":    { place: "indoor", mount: ["floor"], body: "full", note: "课桌（也算桌）" },
  "dining-table":   { place: "indoor", mount: ["floor"], body: "full", note: "餐桌" },
  "round-table":    { place: "indoor", mount: ["floor"], body: "full", note: "圆几/茶几" },
  "chair":          { place: "indoor", mount: ["floor"], body: "full", note: "木椅" },
  "office-chair":   { place: "indoor", mount: ["floor"], body: "full", note: "办公椅" },
  "sofa":           { place: "indoor", mount: ["floor"], body: "full", note: "沙发" },
  "armchair":       { place: "indoor", mount: ["floor"], body: "full", note: "单人沙发" },
  "double-bed":     { place: "indoor", mount: ["floor"], body: "full", note: "双人床" },
  "bed":            { place: "indoor", mount: ["floor"], body: "full", note: "单人床" },
  "nightstand":     { place: "indoor", mount: ["floor"], body: "full", note: "床头柜" },
  "wardrobe":       { place: "indoor", mount: ["floor"], body: "full", note: "衣柜" },
  "cabinet":        { place: "indoor", mount: ["floor"], body: "full", note: "储物柜" },
  "locker":         { place: "indoor", mount: ["floor"], body: "full", note: "更衣柜" },
  "filing-cabinet": { place: "indoor", mount: ["floor"], body: "full", note: "文件柜" },
  "bookshelf-office": { place: "indoor", mount: ["floor"], body: "full", note: "书架（落地）" },
  "printer":        { place: "indoor", mount: ["floor"], body: "full", note: "打印机" },
  "water-cooler":   { place: "indoor", mount: ["floor"], body: "full", note: "饮水机" },
  "arcade-cabinet": { place: "indoor", mount: ["floor"], body: "full", note: "街机" },
  "gramophone":     { place: "indoor", mount: ["floor"], body: "full", note: "留声机" },
  "fridge":         { place: "indoor", mount: ["floor"], body: "full", note: "冰箱" },
  "stove-kitchen":  { place: "indoor", mount: ["floor"], body: "full", note: "灶台" },
  "kitchen-counter":{ place: "indoor", mount: ["floor"], body: "full", note: "厨房操作台" },
  "bathtub":        { place: "indoor", mount: ["floor"], body: "full", note: "浴缸" },
  "toilet":         { place: "indoor", mount: ["floor"], body: "full", note: "马桶" },
  "sleeping-mat":   { place: "indoor", mount: ["floor"], body: "full", note: "睡垫" },
  "crown-cushion":  { place: "indoor", mount: ["floor_or_top"], body: "full", note: "软垫（落地或放凳上）" },
  "trophy-cup":     { place: "indoor", mount: ["floor_or_top"], body: "full", note: "奖杯（可放柜顶）" },
  "floor-lamp":     { place: "both", mount: ["floor"], body: "full", note: "落地灯（室内外都常见）" },

  // ---------- 两侧都合理 ----------
  "plant-office":   { place: "both", mount: ["floor"], body: "full", note: "盆栽绿植，室内外都常见" },

  // ---------- 挂墙（无地面碰撞） ----------
  /* 判据是**看贴图**：挂着的东西身后没有支撑物、贴图底部不落在格子中线以下。
   * 经 logs/asset-frames.png 逐帧核对：
   *   blackboard / whiteboard / potion-shelf / mirror / sink 都画了**落地支架或底座**
   *   （bbox 高度 30~55px，脚点在格子内），它们是**落地家具**，不是挂墙件 ——
   *   早先把它们写成 wall 是看着名字猜的，结果引擎反过来说数据错。
   *   真正的挂墙件只有：窗帘、窗、开关、壁灯（贴图无支撑、可直接压在墙面 tile 上）。 */
  "curtains":     { place: "indoor", mount: ["wall"], body: "none", note: "窗帘，挂窗（无支撑）" },
  "switch":       { place: "indoor", mount: ["wall"], body: "none", note: "灯开关（无支撑）" },
  "wall-lamp":    { place: "indoor", mount: ["wall"], body: "none", note: "壁灯（无支撑）" },
  "window":       { place: "both", mount: ["wall"], body: "none", note: "窗（无支撑）" },

  // ---------- 带支架/底座的"看起来像挂墙、其实落地"的家具 ----------
  "blackboard":   { place: "indoor", mount: ["floor"], body: "full", note: "黑板架（自带支架，落地）" },
  "whiteboard":   { place: "indoor", mount: ["floor"], body: "full", note: "白板架（自带支架，落地）" },
  "potion-shelf": { place: "indoor", mount: ["floor"], body: "full", note: "药水架（带底座，落地）" },
  "mirror":       { place: "indoor", mount: ["floor"], body: "full", note: "立镜（带支架，落地）" },
  "sink":         { place: "indoor", mount: ["floor"], body: "full", note: "洗手盆（立柱式，落地）" },

  // ---------- 只能叠在桌面上（跟随 host，自身无坐标） ----------
  /* 用户拍板的第三层："桌上物品必须放在桌上"。
   * 这里是我最初留的漏洞：fruit-bowl / kettle / coffee-mug 等一律写成 floor_or_top
   * （"落地也行"），等于亲手给"果盘摆地上"开了后门 —— 引擎判它合法，check.mjs 33/33 全绿，
   * 而截图里果盘就躺在地砖上。**分类写成"都行"= 放弃约束**。
   * 现在：凡语义上属于桌面的，只允许 top，落地就是错误。 */
  "computer":    { place: "indoor", mount: ["top"], body: "none", note: "台式机，只能放桌上" },
  "laptop":      { place: "indoor", mount: ["top"], body: "none", note: "笔记本，只能放桌上" },
  "pencil-cup":  { place: "indoor", mount: ["top"], body: "none", note: "笔筒，只能放桌上" },
  "open-book":   { place: "indoor", mount: ["top"], body: "none", note: "摊开的书，只能放桌/沙发面" },
  "coffee-mug":  { place: "indoor", mount: ["top"], body: "none", note: "咖啡杯，只能放桌上" },
  "phone-desk":  { place: "indoor", mount: ["top"], body: "none", note: "座机，只能放桌上" },
  "fruit-bowl":  { place: "indoor", mount: ["top"], body: "none", note: "果盘，只能放桌/台面（不许摆地上）" },
  "kettle":      { place: "indoor", mount: ["top"], body: "none", note: "水壶，只能放台面" },
  "stapler":     { place: "indoor", mount: ["top"], body: "none", note: "订书机，只能放桌上" },
  "calculator":  { place: "indoor", mount: ["top"], body: "none", note: "计算器，只能放桌上" },
  "clock-desk":  { place: "indoor", mount: ["top"], body: "none", note: "座钟，只能放桌上" },

  // ---------- 落地与桌面都合理（书堆/纸堆/奖杯/地球仪确实常见于一摞一摞放地上） ----------
  "desk-lamp":   { place: "indoor", mount: ["floor_or_top"], body: "full", note: "台灯（桌上或落地都常见）" },
  "book-stack":  { place: "indoor", mount: ["floor_or_top"], body: "none", note: "书堆（桌上或地上一摞都合理）" },
  "paper-stack": { place: "indoor", mount: ["floor_or_top"], body: "none", note: "纸堆（桌上或地上一摞都合理）" },
  "globe-desk":  { place: "indoor", mount: ["floor_or_top"], body: "none", note: "地球仪（桌上或落地都常见）" },
  "trophy-cup":  { place: "indoor", mount: ["floor_or_top"], body: "full", note: "奖杯（可放地上或柜顶）" },
  "coin":        { place: "both", mount: ["floor_or_top"], body: "none", note: "硬币，小摆件" },

  // ---------- 角色（不是家具，不参与摆放约束） ----------
  "whale":       { place: "both", mount: ["floor"], body: "none", note: "主角鱼", isActor: true },
  "whale_cat":   { place: "indoor", mount: ["floor"], body: "none", note: "NPC 喵酱", isActor: true },
  "whale_chief": { place: "indoor", mount: ["floor"], body: "none", note: "NPC 村长", isActor: true },
  "whale_doc":   { place: "indoor", mount: ["floor"], body: "none", note: "NPC 博士", isActor: true },

  // ---------- 服装等（仅编辑器用，不摆设） ----------
  "robe":        { place: "indoor", mount: ["floor"], body: "none", note: "长袍（换装用）" },
  "wizard-hat":  { place: "indoor", mount: ["floor"], body: "none", note: "巫师帽（换装用）" },
  "amulet":      { place: "indoor", mount: ["floor"], body: "none", note: "护符（换装用）" }
};

/** 查询：素材的分类（未登记返回 null —— 调用方必须当作错误处理，不许默认值放行） */
export function ruleOf(asset) {
  return ASSET_RULES[asset] || null;
}

/** 该素材能否放在这个 mount 层。
 * "floor_or_top" 是**两种层都允许**的简写（小摆件：既落地也能放桌上），
 * 展开成 ["floor","top"] 再判 —— 否则它会被误报成"挂载层不对"。 */
export function canMount(asset, layer) {
  const r = ruleOf(asset);
  if (!r || !Array.isArray(r.mount)) return false;
  const allowed = r.mount.flatMap(m => m === "floor_or_top" ? ["floor", "top"] : [m]);
  return allowed.includes(layer);
}

/** 该素材能否出现在这个场所（"both" 两边都行） */
export function canPlace(asset, where) {
  const r = ruleOf(asset);
  if (!r) return false;
  return r.place === "both" || r.place === where;
}

/** 碰撞口径 */
export function bodyOf(asset) {
  const r = ruleOf(asset);
  return r ? r.body : null;
}

/** 植被之间允许互相叠加（用户拍板：家具/设施零重叠，植被允许多重叠加） */
export function isVegetation(asset) {
  return bodyOf(asset) === "cell";
}

// ---------- CLI ----------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const man = JSON.parse(fs.readFileSync(MAN, "utf8"));
  const manKeys = Object.keys(man);
  const ruleKeys = Object.keys(ASSET_RULES);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(ASSET_RULES, null, 2));
  } else if (process.argv.includes("--audit")) {
    const missing = manKeys.filter(k => !ASSET_RULES[k]);
    const extra = ruleKeys.filter(k => !man[k]);
    console.log("\n素材分类交叉校验");
    console.log("─".repeat(64));
    console.log("  manifest 里 " + manKeys.length + " 个素材 · 规则表 " + ruleKeys.length + " 条");
    if (missing.length) {
      console.log("  ✗ 未登记分类（必须补 ASSET_RULES）共 " + missing.length + " 个：");
      missing.forEach(k => console.log("      " + k));
    } else console.log("  ✓ manifest 的每个素材都有分类");
    if (extra.length) {
      console.log("  ! 规则表里有、manifest 里没有的 " + extra.length + " 个（可能是已删素材）：");
      extra.forEach(k => console.log("      " + k));
    }
    console.log("─".repeat(64) + "\n");
    process.exit(missing.length ? 1 : 0);
  } else {
    console.log("\n素材摆放规则（唯一事实源）  共 " + ruleKeys.length + " 条");
    console.log("─".repeat(78));
    console.log("素材".padEnd(18) + "场所".padEnd(10) + "可挂载层".padEnd(16) + "碰撞".padEnd(7) + "说明");
    ruleKeys.sort().forEach(k => {
      const r = ASSET_RULES[k];
      console.log(k.padEnd(18) + String(r.place).padEnd(10) + r.mount.join("/").padEnd(16) + String(r.body).padEnd(7) + (r.note || ""));
    });
    console.log("─".repeat(78) + "\n");
  }
}
