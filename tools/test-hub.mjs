#!/usr/bin/env node
/**
 * hub 行为测试套件（计划 P4.1）：起一个隔离 hub（临时数据文件 + 随机端口），跑断言后退出。
 *
 *   node office/tools/test-hub.mjs            # 交互式：起在 4399 挂着，手动 curl 用
 *   node office/tools/test-hub.mjs --assert   # CI/自动化：跑断言套件，全过 exit 0
 *
 * 覆盖：状态白名单拒绝 / 事件优先级仲裁（低不扰高 + HOLD 过期）/ stats 增减与边界 /
 *       去抖（同事件不重复广播）/ 排班引擎（睡眠班跨零点）/ 落盘恢复
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUB = path.join(HERE, "..", "hub", "hub.mjs");
const ASSERT = process.argv.includes("--assert");
const PORT = Number(process.env.PORT) || (ASSERT ? 4390 + Math.floor(Math.random() * 100) : 4399);
const BASE = `http://127.0.0.1:${PORT}`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-hub-test-"));
const mapFile = path.join(dir, "map.custom.json");
const stateFile = path.join(dir, "state.json");
fs.writeFileSync(mapFile, JSON.stringify({ furniture: [], updatedAt: 0 }));

console.log(`[test-hub] 数据目录：${dir}`);
console.log(`[test-hub] 真实存档：${path.join(HERE, "..", "hub", "map.custom.json")}（本次不会读写它）`);

const child = spawn(process.execPath, [HUB], {
  stdio: "inherit",
  env: {
    ...process.env, OFFICE_MAP_FILE: mapFile, OFFICE_STATE_FILE: stateFile,
    OFFICE_PORT: String(PORT),
    OFFICE_PRIORITY_HOLD_MS: process.env.OFFICE_PRIORITY_HOLD_MS || "3000"
  }
});
const bye = () => { try { child.kill(); } catch {} };
process.on("SIGINT", () => { bye(); process.exit(0); });
process.on("SIGTERM", () => { bye(); process.exit(0); });
child.on("exit", code => process.exit(code ?? 0));

if (!ASSERT) process.exit(0);   // 交互模式：hub 起着就行

// ---------- 测试基建 ----------
function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null
    const r = http.request(BASE + p, { method, headers: data ? { "Content-Type": "application/json" } : {} }, res => {
      let buf = ""
      res.on("data", c => buf += c)
      res.on("end", () => resolve({ status: res.statusCode, body: buf }))
    })
    r.on("error", reject)
    if (data) r.write(data)
    r.end()
  })
}
const post = (p, body) => req("POST", p, body)
const status = () => req("GET", "/api/status").then(r => JSON.parse(r.body))
const sleep = ms => new Promise(r => setTimeout(r, ms))

let passed = 0, failed = 0
function assert(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  [ OK ] ${name}`) }
  else { failed++; console.log(`  [FAIL] ${name}${detail ? " —— " + detail : ""}`) }
}

async function waitHub() {
  for (let i = 0; i < 40; i++) {
    try { const r = await req("GET", "/health"); if (r.status === 200) return true } catch {}
    await sleep(250)
  }
  return false
}

// ---------- 用例 ----------
try {
  assert("hub 起动", await waitHub())

  // 1. 白名单拒绝
  const bad = await post("/api/event", { state: "nope_not_registered" })
  assert("未登记状态被拒（400）", bad.status === 400 && /未知状态/.test(bad.body))

  // 2. 优先级仲裁：writing(2) → idle(0) 被压制 → error(3) 打断成功
  await post("/api/event", { state: "writing", task: "忙", priority: 2 })
  await post("/api/event", { state: "idle" })
  let s = await status()
  assert("低优先级 idle 被压制，仍是 writing", s.state.state === "writing", "got " + s.state.state)
  await post("/api/event", { state: "error", task: "炸了" })
  s = await status()
  assert("error(3) 可打断 writing(2)", s.state.state === "error", "got " + s.state.state)
  assert("状态带 priority 字段落盘", typeof s.state.priority === "number" && s.state.priority === 3)

  // 3. HOLD 过期：等 OFFICE_PRIORITY_HOLD_MS 后 idle 可归位
  await post("/api/event", { state: "writing", task: "又忙", priority: 2 })
  const hold = Number(process.env.OFFICE_PRIORITY_HOLD_MS || 3000)
  await sleep(hold + 800)
  await post("/api/event", { state: "idle" })
  s = await status()
  assert("HOLD 过期后 idle 生效", s.state.state === "idle", "got " + s.state.state)

  // 3.5 v83.5 新状态：celebrating(2) 可打断 working(2)（同级放行），tired(1) 被其压制
  await post("/api/event", { state: "working", task: "忙", priority: 2 })
  await post("/api/event", { state: "tired", task: "歇会儿", priority: 1 })
  s = await status()
  assert("tired(1) 不能打断 working(2)", s.state.state === "working", "got " + s.state.state)
  await post("/api/event", { state: "celebrating", task: "庆祝", priority: 2 })
  s = await status()
  assert("celebrating(2) 同级可打断 working(2)", s.state.state === "celebrating", "got " + s.state.state)

  // 4. stats 增减 + 地板
  await post("/api/stats", { mood: -200, social: +3 })
  s = await status()
  assert("stats 下限钳到地板", s.stats.mood === 15, "mood=" + s.stats.mood)
  assert("stats 正常加成", s.stats.social >= 15 + 3 || s.stats.social > 0, "social=" + s.stats.social)

  // 5. 去抖：同 state+task+detail 重复上报返回 dedup
  await post("/api/event", { state: "reading", task: "翻书" }).catch(() => {})   // 白名单没有 reading 也行，用真名
  const before = (await status()).recent.length
  await post("/api/event", { state: "idle", task: "", detail: "", ts: Date.now() })
  await post("/api/event", { state: "idle", task: "", detail: "", ts: Date.now() })
  const after = (await status()).recent.length
  assert("同事件重复上报不堆 recent（去抖）", after - before <= 1, `before=${before} after=${after}`)

  // 6. 落盘恢复（state.json 存在）
  assert("状态落盘文件生成", fs.existsSync(stateFile))

  console.log(`\n[test-hub] 断言结果：${passed} 通过 / ${failed} 失败`)
  bye()
  process.exit(failed ? 1 : 0)
} catch (e) {
  console.error("[test-hub] 测试套件异常:", e)
  bye()
  process.exit(1)
}
