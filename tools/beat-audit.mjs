#!/usr/bin/env node
/**
 * 节奏审计（v2.7-b）：回答一个问题 —— 「随便抽 3 分钟看，能看到一件事的概率是多少？」
 *
 * 为什么需要这个工具：小镇的事件源分散在三处（排班 / 微事件 / 随机事件），
 * 光看代码里的常数（180s、2~6h、11 班/天）根本算不出观众实际体验到什么。
 * 这个脚本把三处参数读进同一个时间轴做离线仿真，输出「3 分钟窗口命中率」。
 *
 *   node tools/beat-audit.mjs               # 按当前配置跑 7 天，打印命中率与各来源占比
 *   node tools/beat-audit.mjs --sweep       # 扫 OFFICE_MICRO_MIN 60~300s，看阈值曲线
 *   node tools/beat-audit.mjs --days=30     # 拉长样本
 *
 * 被 tools/check.mjs 第 23 项 import 用作门禁（确定性 seed，不会随机通过/失败）。
 *
 * 口径说明：
 *   - 只统计「清醒时段」(schedule.json 的 wake，默认 8:00–23:00)，因为夜里没人看、也没事件；
 *   - 窗口 3 分钟、步长 1 分钟、覆盖整个清醒时段；
 *   - 四层事件源：排班（小时级）/ 生活决策（v2.8-a，4 分钟级，改状态）/ 微事件（3 分钟级，只播报）/ 随机事件（2~6h）；\n *   - 微事件按 micro_events.json 的 hours 窗口过滤（天气条件不模拟 —— 只会更少，不会更多）；
 *   - 不含「日常摘要行」（本地生活模拟），那是前端在 idle 时才有的，属于额外覆盖。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULTS = {
  microMinSec: Number(process.env.OFFICE_MICRO_MIN || 180),  // 微事件基准间隔（秒）
  microJitter: 0.4,        // ±40%（与 hub.mjs 的 (0.6 + rand*0.8) 对齐）
  lifeMinSec: Number(process.env.OFFICE_LIFE_MIN || 240),    // 生活决策基准间隔（秒，v2.8-a）
  lifeJitter: 0.2,         // ±20%（与 hub.mjs 的 (0.8 + rand*0.4) 对齐）
  needEveryMin: 120,       // 数值驱动事件：2h 冷却（hub.mjs 的 NEED_EVENT_COOLDOWN）
  randomMinMin: 120,       // 随机事件 2~6h（hub.mjs 的 scheduleRandomEvents）
  randomMaxMin: 360,
  windowMin: 3,            // 判定窗口 3 分钟
  days: 7,
  seed: 20261117
};

export function loadSources(root = ROOT) {
  const read = f => JSON.parse(fs.readFileSync(path.join(root, "hub", f), "utf8"));
  const schedule = read("schedule.json");
  const micro = read("micro_events.json");
  const random = read("random_events.json");
  return {
    shifts: (schedule.shifts || []).filter(s => s && s.at && !s.silent),
    wake: Array.isArray(schedule.wake) ? schedule.wake : [8, 23],
    beats: (micro.beats || []).filter(b => b && b.key),
    randoms: (random.events || []).filter(e => e && e.key)
  };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hhmm(at) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(at || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function hourIn(h, w) {
  if (!w) return true;
  return w[0] <= w[1] ? (h >= w[0] && h < w[1]) : (h >= w[0] || h < w[1]);
}

/**
 * 仿真的核心：把一天里所有会"广播出去"的事件时刻排出来（单位：分钟的浮点数）。
 * 只关心"有没有事"，所以不需要状态机 —— 谁先谁后不影响命中率统计。
 */
export function simulateDay(day, src, opt, rnd) {
  const out = [];   // [{ min, src }]
  const dow = (day + 1) % 7;   // day=0 设为周一：周一=1 … 周日=0（只影响 weekday 班次）

  // 1) 排班：到点就有一条（静默班次不算 —— 观众看不到）
  src.shifts.forEach(s => {
    if (s.weekday != null && Number(s.weekday) !== dow) return;
    const m = hhmm(s.at);
    if (m != null) out.push({ min: m, src: "schedule" });
  });

  // 2) 微事件：清醒时段内按 基准 × (1-抖动 ~ 1+抖动) 推进；条目自己的 hours 窗口不满足则跳过
  const [ws, we] = src.wake;
  let t = ws * 60;
  const end = we * 60;
  while (t < end) {
    const step = (opt.microMinSec / 60) * (1 - opt.microJitter + rnd() * opt.microJitter * 2);
    t += Math.max(0.5, step);
    if (t >= end) break;
    const h = Math.floor(t / 60);
    if (src.beats.some(b => hourIn(h, b.hours))) out.push({ min: t, src: "micro" });
  }

  // 3) 生活决策（v2.8-a）：hub 自己决定她做什么，4 分钟级
  //    注：真实运行时会被"正事/睡觉不插话"挡住，这里按理想密度算 —— 口径偏乐观，用作上界
  {
    let lt = ws * 60 + (opt.lifeMinSec / 60) * (1 - opt.lifeJitter + rnd() * opt.lifeJitter * 2);
    while (lt < end) {
      out.push({ min: lt, src: "life" });
      lt += (opt.lifeMinSec / 60) * (1 - opt.lifeJitter + rnd() * opt.lifeJitter * 2);
    }
  }

  // 4) 数值驱动事件：2h 冷却，清醒时段
  for (let m = ws * 60 + opt.needEveryMin * (0.5 + rnd()); m < end; m += opt.needEveryMin) {
    out.push({ min: m, src: "need" });
  }

  // 5) 随机事件：2~6h
  for (let m = opt.randomMinMin + rnd() * (opt.randomMaxMin - opt.randomMinMin); m < 24 * 60; m += opt.randomMinMin + rnd() * (opt.randomMaxMin - opt.randomMinMin)) {
    out.push({ min: m, src: "random" });
  }
  return out.sort((a, b) => a.min - b.min);
}

/** 统计：清醒时段里，所有 3 分钟窗口中有事件的比例 */
export function windowHit(events, src, opt) {
  const [ws, we] = src.wake;
  const win = opt.windowMin, from = ws * 60, to = we * 60 - win;
  let total = 0, hit = 0;
  const mins = events.map(e => e.min);
  for (let s = from; s <= to; s += 1) {
    total++;
    // 事件已按时间排好，双指针即可
    let found = false;
    for (let i = 0; i < mins.length; i++) {
      if (mins[i] < s) continue;
      if (mins[i] < s + win) { found = true; }
      break;
    }
    if (found) hit++;
  }
  return { total, hit, rate: total ? hit / total : 0 };
}

export function simulate(opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const src = loadSources(o.root || ROOT);
  const rnd = mulberry32(o.seed);
  let total = 0, hit = 0;
  const per = { schedule: 0, micro: 0, life: 0, need: 0, random: 0 };
  for (let d = 0; d < o.days; d++) {
    const ev = simulateDay(d, src, o, rnd);
    ev.forEach(e => { per[e.src] = (per[e.src] || 0) + 1; });
    const r = windowHit(ev, src, o);
    total += r.total; hit += r.hit;
  }
  const awakeMin = (src.wake[1] - src.wake[0]) * 60 * o.days;
  const perHour = k => (per[k] || 0) / (awakeMin / 60);
  return {
    days: o.days, windowMin: o.windowMin, wake: src.wake,
    rate: total ? hit / total : 0, total, hit,
    per, perHour: { schedule: perHour("schedule"), micro: perHour("micro"), life: perHour("life"), need: perHour("need"), random: perHour("random") },
    totalPerHour: Object.values(per).reduce((a, b) => a + b, 0) / (awakeMin / 60),
    microMinSec: o.microMinSec, lifeMinSec: o.lifeMinSec
  };
}

function fmtPct(x) { return (x * 100).toFixed(1) + "%"; }

function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith("--days="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : DEFAULTS.days;

  if (args.includes("--sweep")) {
    console.log("\nOFFICE_MICRO_MIN 扫描（3 分钟窗口命中率，清醒时段）\n" + "─".repeat(58));
    console.log("  微事件间隔   命中率    每小时事件数");
    [60, 90, 120, 150, 180, 210, 240, 300].forEach(sec => {
      const r = simulate({ microMinSec: sec, days });
      const mark = sec === DEFAULTS.microMinSec ? "  ← 当前" : "";
      console.log(`  ${String(sec).padStart(3)}s        ${fmtPct(r.rate).padStart(6)}    ${r.totalPerHour.toFixed(1)}${mark}`);
    });
    console.log("─".repeat(58) + "\n");
    return;
  }

  const r = simulate({ days });
  console.log("\n节奏审计（3 分钟窗口 · 清醒时段 " + r.wake[0] + ":00–" + r.wake[1] + ":00 · " + r.days + " 天仿真）");
  console.log("─".repeat(58));
  console.log(`  命中率        ${fmtPct(r.rate)}   （${r.hit}/${r.total} 个窗口里至少有一件事）`);
  console.log(`  每小时事件数  ${r.totalPerHour.toFixed(1)}   排班 ${r.perHour.schedule.toFixed(2)} · 生活 ${r.perHour.life.toFixed(2)} · 微事件 ${r.perHour.micro.toFixed(2)} · 数值 ${r.perHour.need.toFixed(2)} · 随机 ${r.perHour.random.toFixed(2)}`);
  console.log(`  间隔          生活 ${r.lifeMinSec}s（OFFICE_LIFE_MIN）· 微事件 ${r.microMinSec}s（OFFICE_MICRO_MIN）`);
  console.log("─".repeat(58));
  if (r.rate < 0.85) console.log("  ⚠ 命中率低于 85%：观众有 1/" + Math.round(1 / Math.max(1e-6, 1 - r.rate)) + " 的概率打开就看到空窗期");
  else console.log("  ✓ 达到 v2.7 目标（≥85%）");
  console.log("");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
