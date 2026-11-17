#!/usr/bin/env node
/**
 * AI 小镇 · 状态中转 hub
 * 架构位置：任意事件源 --HTTP POST--> hub(本文件, 127.0.0.1:4321) --WebSocket--> 浏览器(Phaser)
 * hub 不认识任何业务方：谁想驱动小镇，就往 POST /api/event 推一条状态事件即可；
 * 小镇自己的作息见 hub/schedule.json，没有事件时由前端跑本地生活模拟。
 * 职责：
 *   - POST /api/event   状态事件入口（默认仅本机可调，状态须在 hub/states.json 白名单内）
 *   - POST /api/heartbeat 同义入口（兼容旧命名）
 *   - POST /api/stats   五项内在数值的增量加减（hunger/mood/energy/social/hygiene）
 *   - GET  /api/status  当前状态快照（调试用）
 *   - GET  /api/map     自定义家具层（编辑器读写）
 *   - GET  /health      探活
 *   - WS   任意路径 upgrade（nginx /office-ws/ 反代进来）
 * 内存态：当前状态 + 最近 50 条事件环形缓冲；每次有效事件落盘 hub/state.json，重启可恢复。
 * 状态清单：hub/states.json 是唯一事实源，与前端 web/office.js 的 STATE_MAP 由 tools/check.mjs 双向校验。
 */
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { WebSocketServer } from "ws"

const PORT = Number(process.env.OFFICE_PORT || 4321)
const HOST = process.env.OFFICE_HOST || "127.0.0.1"
const MAX_RECENT = 50
const STARTED_AT = Date.now()
const STATE_FILE = process.env.OFFICE_STATE_FILE
  ? path.resolve(process.env.OFFICE_STATE_FILE)
  : fileURLToPath(new URL("./state.json", import.meta.url))
// 恢复上限：太久之前的状态不"复活"，避免服务重启后一直挂着昨天那条状态
const MAX_AGE = Number(process.env.OFFICE_STATE_MAX_AGE_MS || 6 * 3600 * 1000)
/* 空档回落：没有任何真实事件（刚启动 / 状态超过 MAX_AGE）时显示什么，按北京时间决定。
 * 旧版一律回落 "sleeping"，于是 19 点打开页面看到鱼躺在床上 —— 用户问「怎么 19 点就睡觉了」。
 * 那不是它真的睡了，只是"没有事件 + 默认态"的假象。现在清醒时段回落成 idle（摸鱼等活，黄点），
 * 只有夜里才回落到睡觉；时间窗与前端 SCHEDULE.wake、hub/schedule.json 的 wake 一致（check.mjs 会核对）。 */
const WAKE_START = Number(process.env.OFFICE_WAKE_START || 8)
const WAKE_END = Number(process.env.OFFICE_WAKE_END || 23)
function beijingHour() {
  return new Date(Date.now() + 8 * 3600 * 1000).getUTCHours()
}
function isAwakeHour() {
  const h = beijingHour()
  return WAKE_START <= WAKE_END ? (h >= WAKE_START && h < WAKE_END) : (h >= WAKE_START || h < WAKE_END)
}
const initialState = () => (isAwakeHour()
  ? { state: "idle", task: "这个点没有排班", detail: "空档期 · 等下一班（页面上挂着今日作息表）", ts: Date.now() }
  : { state: "sleeping", task: "小镇还没开灯…", detail: "夜里没有排班 · 明早 08:00 起床", ts: Date.now() })

// ---------- 内在状态层（数值系统）----------
/* 五项词条驱动 AI 的自由行为选择（方案 docs/自主生活升级方案-v1.md §1）：
 *   hunger 饱食 / mood 心情 / energy 精力 / social 社交 / hygiene 卫生
 * hub 是真相源：每 60s tick 衰减一次；外部钩子经 POST /api/stats 增减；
 * 广播报文带 stats 字段，前端只读显示。落盘到 state.json 的 stats 字段，重启时按
 * updatedAt 补算离线衰减（地板 15，不清零，避免"每次重启都饿死"）。 */
const STAT_KEYS = ["hunger", "mood", "energy", "social", "hygiene"]
const STAT_FLOOR = 15
const STAT_CEIL = 100
/* 每小时衰减量。清醒时段全额衰减，睡眠时段（23-8 点）减半（睡眠也在消耗，但缓慢）。 */
const DECAY_PER_HOUR = { hunger: 1.2, mood: 0.35, energy: 2.0, social: 0.8, hygiene: 1.0 }
/* mood 缓慢回归均值 60：每小时向 60 靠拢 3% */
const MOOD_SETPOINT = 60
const MOOD_REGRESS = 0.03

let stats = null   // { hunger, mood, energy, social, hygiene, updatedAt }
try {
  const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  if (j.stats && typeof j.stats === "object") stats = j.stats
} catch {}
if (!stats) {
  // 首次：给一个"刚睡醒"的合理初值
  stats = { hunger: 70, mood: 65, energy: 80, social: 55, hygiene: 75, updatedAt: Date.now() }
}

/* 把 stats 推进到 now 时刻：按 elapsed 小时衰减。离线很久也只衰减一次，地板 15。 */
function tickStats(now = Date.now()) {
  const prev = Number(stats.updatedAt) || now
  const hours = Math.min(72, Math.max(0, (now - prev) / 3600e3))   // 上限 72h，防时钟跳变
  if (hours <= 0) { stats.updatedAt = now; return }
  const awake = isAwakeHour()
  const k = awake ? 1 : 0.5
  for (const key of STAT_KEYS) {
    let v = Number(stats[key]) || 0
    v -= DECAY_PER_HOUR[key] * hours * k
    if (key === "mood") {
      // mood 不低于地板后向 60 回归（衰减与回归取净效果）
      const drift = (MOOD_SETPOINT - v) * MOOD_REGRESS * hours
      v += Math.max(0, drift)
    }
    stats[key] = Math.round(Math.min(STAT_CEIL, Math.max(STAT_FLOOR, v)))
  }
  stats.updatedAt = now
}
/* 事件钩子调用：增量加减（可负），立即落盘+广播 */
function applyStatDelta(deltas) {
  tickStats()
  for (const key of STAT_KEYS) {
    if (typeof deltas[key] === "number" && Number.isFinite(deltas[key])) {
      stats[key] = Math.round(Math.min(STAT_CEIL, Math.max(STAT_FLOOR, stats[key] + deltas[key])))
    }
  }
  stats.updatedAt = Date.now()
  saveDiskDebounced()
  broadcast({ type: "stats", stats })
}
/* 广播给前端的精简形态（连同 state 一起带时间戳） */
function statsSnapshot() {
  let real = 0
  for (const c of clients) { if (!c.isBot) real++ }   // v85.5：排除 headless/自动化，围观人数只算真人
  return { ...stats, ts: stats.updatedAt, viewers: real }   // v85 P8.3：观众数随 stats 广播（前端做访客彩蛋）
}

// 每 60s：衰减 + 广播一次（与现有 ts 广播共用节奏）
setInterval(() => {
  tickStats()
  saveDiskDebounced()
  broadcast({ type: "stats", stats: statsSnapshot() })
}, 60000).unref?.()

// ---------- B 层随机事件（方案 §2.2）----------
/* 每 2~6 小时加权抽 1 条符合条件的事件，转成一条带 eventKey 的 state 广播。
 * 事件走状态白名单外的独立通道：不污染 cur/recent（activity 流由前端登记），但广播给浏览器编排表演。 */
let RANDOM_EVENTS = []
try {
  const j = JSON.parse(fs.readFileSync(new URL("./random_events.json", import.meta.url), "utf8"))
  if (Array.isArray(j.events)) RANDOM_EVENTS = j.events
} catch (e) {
  console.warn(new Date().toISOString(), `[office-hub] 未读到 random_events.json (${e.message})，随机事件层停用`)
}
let lastRandomEvent = null

function hourInWindow(h, w) {
  if (!w) return true
  return w[0] <= w[1] ? (h >= w[0] && h < w[1]) : (h >= w[0] || h < w[1])
}
function eventQualifies(ev, weather) {
  if (!hourInWindow(beijingHour(), ev.hours)) return false
  const c = ev.cond || {}
  if (c.weather && c.weather !== weather) return false
  if (c.stats) for (const [k, min] of Object.entries(c.stats)) if ((stats[k] ?? 100) < min) return false
  if (ev.key === lastRandomEvent) return false   // 不连发同一条
  return true
}
function pickRandomEvent(weather) {
  const pool = RANDOM_EVENTS.filter(e => eventQualifies(e, weather))
  if (!pool.length) return null
  const total = pool.reduce((s, e) => s + (e.w || 1), 0)
  let r = Math.random() * total
  for (const e of pool) { r -= e.w || 1; if (r <= 0) return e }
  return pool[pool.length - 1]
}
/* 天气：P6 天气接入——hub 每小时拉一次 wttr.in（上海），映射成 sunny/rainy/snowy/cloudy
 * 并广播给前端（前端 R 键仍可手动切换，真实天气只作初始值与整点刷新）。
 * 抓取失败静默沿用上次结果；事件条件的 weather gate 从此吃真实天气。 */
/* ---------- v85 P8.1 今日剧本：每天一份小镇剧情梗概（纯模板拼装，零 AI 成本）----------
 * 数据源：hub/schedule.json 的今日班次 + 随机事件调剂。前端状态栏上方展示，
 * 每天变一次（按日期 seed 固定，同一天多次请求返回同一份）。 */
let SCHEDULE = (() => {
  try { return JSON.parse(fs.readFileSync(fileURLToPath(new URL("./schedule.json", import.meta.url)), "utf8")) } catch { return { shifts: [] } }
})()
function dailyScript() {
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })  // YYYY-MM-DD
  // 按日期做确定性 seed：同一天返回同一份剧本
  const seedNum = [...day].reduce((a, c) => a + c.charCodeAt(0) * 31, 0)
  const rnd = (n) => ((seedNum * 9301 + 49297 * n) % 233280) / 233280
  const bjHour = Number(new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", hour: "2-digit", hour12: false }))
  const shifts = (SCHEDULE.shifts || []).filter(sh => {
    const wd = sh.weekday
    if (wd !== undefined && wd !== new Date().getDay()) return false
    return true
  })
  const today = shifts.filter(sh => { const h = Number(sh.at.slice(0, 2)); return h <= 23 })  // 全部
  const past = today.filter(sh => { const h = Number(sh.at.slice(0, 2)); return h <= bjHour }).slice(-1)
  const upcoming = today.filter(sh => { const h = Number(sh.at.slice(0, 2)); return h > bjHour }).slice(0, 3)

  // v85.1 真实事件织入：最近 24h 的高亮事件（真实发生的事）进剧本
  const dayAgo = Date.now() - 24 * 3600e3
  const seenStates = new Set()
  const realActs = []
  for (const e of (recent || [])) {
    if ((e.ts || e.at || 0) <= dayAgo) continue
    const t = String(e.task || "")
    if (!t || /验收|心跳|庆祝|转发|评论视频《/.test(t)) continue   // 庆祝/回评是派生动作，不进剧本
    if (seenStates.has(e.state)) continue                          // 一类状态只取一件
    seenStates.add(e.state)
    realActs.push(t.slice(0, 24))
    if (realActs.length >= 2) break
  }
  // v85.4 天气开场：剧本第一句随真实天气变化（realWeather 来自 wttr.in，fail-open sunny）
  const WEATHER_OPEN = {
    sunny: ["阳光晒得屋顶发亮，", "难得的大晴天，", "今天小镇挺热闹。"],
    cloudy: ["云层压得有点低，", "天灰蒙蒙的，"],
    rainy: ["雨点敲着窗，", "下雨了，NPC 们都不出门，"],
    snowy: ["落雪了！全镇都在看窗外，"],
    storm: ["雷雨大作，谁也别想出门，"]
  }
  const WO = WEATHER_OPEN[realWeather] || WEATHER_OPEN.cloudy
  const OPENINGS = WO
  const CLOSERS = ["大肥鱼说今晚想早点睡。", "喵酱预告傍晚有蟋蟀出没。", "博士说要核对潮汐表，谁都别打扰她。"]
  // 句感：开场 + 正在做的 + 接下来（顿号连接）+ 收尾，拼成一段自然的话
  const open = OPENINGS[Math.floor(rnd(1) * OPENINGS.length)]
  const close = CLOSERS[Math.floor(rnd(2) * CLOSERS.length)]
  let mid = ""
  if (upcoming.length) {
    const items = upcoming.map(sh => `${sh.at} ${sh.label || sh.state}`)
    mid = past.length
      ? `「${past[0].label || past[0].state}」刚过，接下来是${items.join("、")}。`
      : `今天安排：${items.join("、")}。`
  } else {
    mid = past.length
      ? `「${past[0].label || past[0].state}」也结束了，今天的班都跑完，各自回屋。`
      : "夜深了，镇上的灯一盏一盏熄了。"
  }
  let real = ""
  if (realActs.length) real = ` 真实发生的事：${realActs.join("、")}。`
  return { day, line: `${open}${mid}${close}${real}`, upcoming }
}
let realWeather = "sunny"
let weatherCity = process.env.OFFICE_WEATHER_CITY || "Shanghai"
async function fetchRealWeather() {
  try {
    const res = await fetch(`https://wttr.in/${weatherCity}?format=j1`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error("HTTP " + res.status)
    const d = await res.json()
    const c = d.current_condition?.[0] || {}
    const code = Number(c.weatherCode ?? 9999)
    const desc = (c.weatherDesc?.[0]?.value || "").toLowerCase()
    let w = "sunny"
    if ([71, 73, 75, 77, 85, 86].includes(code) || desc.includes("snow")) w = "snowy"
    else if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 353, 356, 359, 386, 389].includes(code) || desc.includes("rain") || desc.includes("drizzle") || desc.includes("shower") || desc.includes("thunder")) w = "rainy"
    else if (code > 2 || desc.includes("overcast") || desc.includes("cloud") || desc.includes("mist") || desc.includes("fog")) w = "cloudy"
    const changed = w !== realWeather
    realWeather = w
    if (changed) {
      broadcast({ type: "weather", weather: realWeather, ts: Date.now() })
      console.log(new Date().toISOString(), `[office-hub] 真实天气变化: ${realWeather}`)
    }
    console.log(new Date().toISOString(), `[office-hub] 天气刷新: ${realWeather} (${desc || "code" + code}, ${c.temp_C}°C)`)
  } catch (e) {
    console.warn(new Date().toISOString(), `[office-hub] 天气抓取失败（沿用 ${realWeather}）: ${e.message.slice(0, 60)}`)
  }
}
setInterval(fetchRealWeather, 3600e3).unref?.()
fetchRealWeather()

function scheduleRandomEvents() {
  if (!RANDOM_EVENTS.length) return
  const delay = (2 + Math.random() * 4) * 3600e3   // 2~6 小时
  setTimeout(() => {
    const ev = pickRandomEvent(realWeather)
    if (ev) {
      lastRandomEvent = ev.key
      broadcast({ type: "event", eventKey: ev.key, label: ev.label, text: ev.text, ts: Date.now() })
      console.log(new Date().toISOString(), `[office-hub] 随机事件: ${ev.key} (${ev.label})`)
    }
    scheduleRandomEvents()
  }, delay).unref?.()
}
scheduleRandomEvents()

// ---------- 状态白名单 ----------
let allowed = null
try {
  const j = JSON.parse(fs.readFileSync(new URL("./states.json", import.meta.url), "utf8"))
  if (Array.isArray(j.states) && j.states.length) allowed = new Set(j.states)
} catch (e) {
  // 漏同步 states.json 时不能把全部真实事件拒之门外：降级为不校验并明确告警
  console.warn(new Date().toISOString(), `[office-hub] 未读到 hub/states.json (${e.message})，本次不启用白名单校验`)
}

// ---------- 轻量持久化 ----------
function loadDisk() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    const s = j.state
    if (!s || typeof s.state !== "string" || (allowed && !allowed.has(s.state))) return { cur: initialState(), recent: [] }
    if (MAX_AGE > 0 && Date.now() - (Number(s.ts) || 0) > MAX_AGE) return { cur: initialState(), recent: [] }
    const cur = {
      state: s.state,
      task: String(s.task || "").slice(0, 200),
      detail: String(s.detail || "").slice(0, 300),
      ts: Number(s.ts) || Date.now(),
      priority: Number(s.priority) || STATE_PRIORITY[s.state] || 0
    }
    let recent = (Array.isArray(j.recent) ? j.recent : [])
      .filter(e => e && (allowed ? allowed.has(e.state) : true))
      .slice(-MAX_RECENT)
    // v85.5 历史折叠：载入磁盘状态时，相邻同 state+task 条目合并为一条（detail 取最新）——
    // 修复 3 分钟降噪窗口外的历史打字机连发仍占多条面板位
    recent = recent.filter((e, i) => {
      if (i === 0) return true
      const prev = recent[i - 1]
      return !(prev && e.state === prev.state && e.task === prev.task)
    })
    // v2.6 降噪：arrive 折叠——「到办公室，开始干活」后面紧跟同 task 的工作态时，arrive 没信息量。
    // 规则：arrive 条目的 task 与下一条的 task 相同（如都是「回复博客评论」）→ 删 arrive。
    recent = recent.filter((e, i) => {
      if (e.state !== "arrive" || i === recent.length - 1) return true
      const next = recent[i + 1]
      return !(next && next.task === e.task)
    })
    return { cur, recent }
  } catch { return { cur: initialState(), recent: [] } }
}
function saveDisk() {
  try {
    // v85.5 写前备份（同 memory.json 策略：每小时 1 份保留 3 份）——小镇状态/事件流水坏掉有回滚点
    try {
      if (fs.existsSync(STATE_FILE) && fs.statSync(STATE_FILE).size > 500) {
        const bakDir = path.dirname(STATE_FILE) + "/backups"
        fs.mkdirSync(bakDir, { recursive: true })
        const stamp = new Date().toISOString().slice(0, 13)
        const bak = bakDir + "/hubstate-" + stamp + ".json"
        if (!fs.existsSync(bak)) {
          fs.copyFileSync(STATE_FILE, bak)
          const olds = fs.readdirSync(bakDir).filter(f => f.startsWith("hubstate-")).sort()
          while (olds.length > 3) fs.unlinkSync(bakDir + "/" + olds.shift())
        }
      }
    } catch {}
    fs.writeFileSync(STATE_FILE + ".tmp", JSON.stringify({ state: cur, recent, stats }))
    fs.renameSync(STATE_FILE + ".tmp", STATE_FILE)
  } catch (e) {
    console.warn(new Date().toISOString(), `[office-hub] 状态落盘失败: ${e.message}`)
  }
}
// 评审修复[高危]：事件风暴下的落盘防抖——1s 合并窗口内的多次 saveDisk 只写一次盘，
// 退出信号时 flush 落盘（状态文件本来就小，最坏丢 1s 内事件，可接受）
let saveTimer = null
function saveDiskDebounced() {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; saveDisk() }, 1000)
  saveTimer.unref?.()
}

const disk = loadDisk()
let cur = disk.cur
const recent = disk.recent
const clients = new Set()

function broadcast(msg) {
  const s = JSON.stringify(msg)
  for (const ws of clients) {
    try { if (ws.readyState === 1) ws.send(s) } catch {}
  }
}

// ---------- 事件优先级仲裁（P1.2）----------
/* 优先级：0=排班/回落，1=小镇自主（tick 决策），2=外部打点（news agent 等），3=错误。
 * 规则：低优先级事件在 PRIORITY_HOLD_MS 内不能打断高优先级正在播的状态——
 * 老版本"后到赢"，agent 下班归位一条 idle 能把刚排上的「睡觉」拽起来。 */
const PRIORITY_HOLD_MS = Number(process.env.OFFICE_PRIORITY_HOLD_MS || 10 * 60 * 1000)
const STATE_PRIORITY = {
  error: 3,                        // 错误最高：必须可见
  arrive: 2, working: 2, browsing: 2, watching: 2, organizing: 2,
  writing: 2, rewriting: 2, diary: 2, designing: 2, posting: 2,
  mailing: 2, replying: 2, commenting: 2, weekly: 2,   // 外部业务态
  celebrating: 2, tired: 1,   // celebrating=运营喜报（外部打点）；tired=自主疲惫态（tick/告警，生活作息级）
  sleeping: 1, washing: 1, eating: 1, snacking: 1, recovering: 1,
  relaxing: 1, strolling: 1, browsing_market: 1,       // 生活作息态
  listening: 1, gaming: 1,
  idle: 0                            // 摸鱼最低：谁都拦不住它被换掉
}
function eventPriority(ev, state) {
  // 显式指定优先用显式值（外部可以传 priority=1..3）；没传按状态查表，未知状态按 1
  const p = Number(ev.priority)
  if (Number.isFinite(p) && p >= 0 && p <= 3) return p
  return STATE_PRIORITY[state] != null ? STATE_PRIORITY[state] : 1
}

// ---------- 排班自主引擎（P1.1）----------
/* 小镇「0 外部依赖也能活」的核心：hub 自己按 hub/schedule.json 的班次推进状态——
 * 到点把对应状态设为当前（优先级 1），不依赖任何外部打点。外部打点（优先级 2/3）
 * 仍可随时打断；班次推进时若外部状态还在 HOLD 期内且优先级更高，则不打断。 */
let schedule = null
try {
  const j = JSON.parse(fs.readFileSync(new URL("./schedule.json", import.meta.url), "utf8"))
  if (Array.isArray(j.shifts)) schedule = j
} catch (e) {
  console.warn(new Date().toISOString(), `[office-hub] 未读到 schedule.json (${e.message})，排班引擎停用`)
}
let lastShiftKey = null
/* 北京时间当前分钟数（0..1439）+ 周几 */
function bjNow() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return { min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay(), clock: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` }
}
/* 班次是否适用于现在：weekday 过滤 + every 展开成今天的全部时刻 */
function shiftOccurrences(shift, now) {
  if (shift.weekday != null && shift.weekday !== now.dow) return []
  const [h, m] = String(shift.at || "").split(":").map(Number)
  const base = (h || 0) * 60 + (m || 0)
  const step = (Number(shift.every) || 0) * 60
  if (!step) return [base]
  const n = Math.max(1, Math.round(1440 / step))
  const out = []
  for (let k = 0; k < n; k++) out.push((base + k * step) % 1440)
  return out
}
/* 每 30s 查一次班次；进入新班次（且不打断更高优先级状态）时推进状态 */
function scheduleTick() {
  if (!schedule || !allowed) return
  const now = bjNow()
  let hit = null
  for (const shift of schedule.shifts) {
    if (shift.silent) continue
    if (!shift.state || !allowed.has(shift.state)) continue
    for (const occ of shiftOccurrences(shift, now)) {
      const dur = Math.max(1, Number(shift.dur) || 1) * 60
      // 跨零点班次（如 23:00 睡觉 dur=9h）：min>=occ 覆盖当晚，min < occ+dur-1440 覆盖次日凌晨
      const inWin = occ + dur <= 1440
        ? (now.min >= occ && now.min < occ + dur)
        : (now.min >= occ || now.min < occ + dur - 1440)
      if (inWin) { hit = { shift, occ }; break }
    }
    if (hit) break
  }
  if (!hit) return
  const key = hit.shift.at + "|" + hit.shift.label
  if (key === lastShiftKey) return          // 同一班次别反复重报
  const prio = eventPriority({}, hit.shift.state)
  const curPrio = cur.priority || 0
  if (prio < curPrio && Date.now() - (Number(cur.ts) || 0) < PRIORITY_HOLD_MS) {
    lastShiftKey = key                       // 记住这班已处理过，避免每 30s 重试
    return
  }
  lastShiftKey = key
  applyEvent({
    state: hit.shift.state,
    task: hit.shift.label,
    detail: hit.shift.note || "排班时间到了（hub 自主推进）",
    ts: Date.now(),
    priority: prio
  })
  console.log(new Date().toISOString(), `[office-hub] 排班推进: ${hit.shift.at} ${hit.shift.label} → ${hit.shift.state}`)
}
/* OFFICE_SCHEDULE_OFF=1 可只关掉作息引擎（调试生活决策层时用：不然作息表一直在占状态，
 * lifeTick 会被 LIFE_BLOCKED 挡住，看不出它到底会不会自己动起来）。 */
if (schedule && process.env.OFFICE_SCHEDULE_OFF !== "1") setInterval(scheduleTick, 30000).unref?.()

// ---------- 数值驱动的排班外行为（v2.6）----------
/* 作息表是"计划"，数值是"生理"。数值跌破阈值时插入一次性行为事件（优先级 1，不打断
 * 业务态但占住空档）：hunger<35 → 加餐；energy<25 → 趴一会；hygiene<30 → 洗把脸。
 * 每 2h 至多触发一次（NEED_EVENT_COOLDOWN），冷却结束还低就再触发。 */
const NEED_EVENT_COOLDOWN = 2 * 3600e3
let lastNeedEventAt = 0
function needEventTick() {
  if (!allowed || Date.now() - lastNeedEventAt < NEED_EVENT_COOLDOWN) return
  if (!isAwakeHour()) return                                    // 夜里让作息表管
  const curPrio = cur.priority || 0
  const curAge = Date.now() - (Number(cur.ts) || 0)
  if (curPrio >= 2 && curAge < PRIORITY_HOLD_MS) return         // 业务态进行中不打断
  tickStats()
  let need = null
  if (stats.hunger < 35) need = { state: "snacking", task: "加餐", detail: "饿了，先找点吃的垫垫", stat: "hunger", value: stats.hunger }
  else if (stats.energy < 25) need = { state: "recovering", task: "趴一会儿", detail: "太累了，眯 20 分钟", stat: "energy", value: stats.energy }
  else if (stats.hygiene < 30) need = { state: "washing", task: "洗把脸", detail: "有点邋遢了，清爽一下", stat: "hygiene", value: stats.hygiene }
  else if (stats.social < 25) need = { state: "replying", task: "找人聊天", detail: "好几天没跟人说话了…", stat: "social", value: stats.social }
  if (!need) return
  lastNeedEventAt = Date.now()
  applyEvent({ ...need, ts: Date.now(), priority: 1 })
  console.log(new Date().toISOString(), `[office-hub] 数值驱动事件: ${need.state}（${need.stat}=${need.value}）`)
}
if (allowed) setInterval(needEventTick, 60e3).unref?.()

// ---------- 微事件层（v2.7-b）：保证「3 分钟内一定有事」 ----------
/* 三层事件源的分工：
 *   排班（scheduleTick）  小时级 · 决定"这一段时间她在干什么"（优先级 1，会占住状态）
 *   微事件（本层）         分钟级 · 只广播 type:"beat"，**不改状态机**，所以不会打断上面那层
 *   随机事件（2~6h）       稀有大事件，走 type:"event"，由前端排队演出
 * 为什么单独一层而不是塞进排班：排班改状态会让她走去另一个房间；而"伸了个懒腰""接了杯水"
 * 这类事应该是原地发生的呼吸。两者混在一起就会出现"她在工位上突然走去冰箱再走回来"。
 * 频率由 OFFICE_MICRO_MIN 控制（默认 180s，±40% 抖动 —— 固定节拍会被人听出来）。 */
const MICRO_MIN_MS = Math.max(30, Number(process.env.OFFICE_MICRO_MIN || 180)) * 1000
let MICRO = []
try {
  const j = JSON.parse(fs.readFileSync(new URL("./micro_events.json", import.meta.url), "utf8"))
  if (Array.isArray(j.beats)) MICRO = j.beats.filter(b => b && b.key && b.task)
} catch (e) {
  console.warn(new Date().toISOString(), `[office-hub] 未读到 micro_events.json (${e.message})，微事件层停用`)
}
let lastBeatKey = null
let nextBeatAt = 0
function planNextBeat() {
  nextBeatAt = Date.now() + MICRO_MIN_MS * (0.6 + Math.random() * 0.8)
}
function pickBeat(weather) {
  const h = beijingHour()
  const pool = MICRO.filter(b => {
    if (b.weather && b.weather !== weather) return false
    if (b.hours && !hourInWindow(h, b.hours)) return false
    if (b.key === lastBeatKey) return false        // 不连发同一条
    return true
  })
  if (!pool.length) return null
  const total = pool.reduce((s, b) => s + (Number(b.w) || 1), 0)
  let r = Math.random() * total
  for (const b of pool) { r -= (Number(b.w) || 1); if (r <= 0) return b }
  return pool[pool.length - 1]
}
function beatTick() {
  if (!MICRO.length) return
  if (!nextBeatAt) { planNextBeat(); return }
  if (Date.now() < nextBeatAt) return
  if (!isAwakeHour()) { nextBeatAt = Date.now() + 60e3; return }   // 夜里闭嘴，别把睡着的人吵醒
  const b = pickBeat(realWeather)
  planNextBeat()
  if (!b) return
  lastBeatKey = b.key
  const at = Date.now()
  broadcast({ type: "beat", key: b.key, task: b.task, detail: b.detail || "", state: cur.state, ts: at })
  recent.push({ state: "beat", task: String(b.task || "").slice(0, 200), detail: String(b.detail || "").slice(0, 300), ts: at, at, kind: "beat" })
  if (recent.length > MAX_RECENT) recent.shift()
  saveDiskDebounced()
  console.log(new Date().toISOString(), `[office-hub] 微事件: ${b.key}（${b.task}）`)
}
setInterval(beatTick, 20e3).unref?.()
planNextBeat()

// ---------- 生活决策层（v2.8-a）：她自己决定做什么，由 hub 说了算 ----------
/* 为什么必须搬到服务端：这段逻辑原来在每个浏览器里各跑一份（web/src/life.js 的 LOCAL_EVENTS），
 * 于是两个观众 = 两条鱼的不同人生；而且每个浏览器都把结算量 POST 回 /api/stats，
 * 人越多她越不饿（数值被叠加成 N 倍）。搬上来之后：
 *   1) 动作由 hub 决定 → 所有观众必然看到同一件事（SSE/WS 天然同步）
 *   2) 数值由 hub 结算 → 一份真相，不再随观众数漂移
 *   3) 事件流里出现的是真事，不是旁白
 * 前端从此只负责"怎么演"，离线（hub 不通）时才退回本地生活模拟。
 *
 * 与其它层的关系：
 *   作息（小时级，改状态，会占住）
 *   生活（本层，4 分钟级，改状态）        ← 只在"非正事"时插话
 *   微事件（3 分钟级，只播报不改状态）
 *   随机事件（2~6h，稀有）
 */
const LIFE_MIN_MS = Math.max(60, Number(process.env.OFFICE_LIFE_MIN || 240)) * 1000
let LIFE = []
try {
  const j = JSON.parse(fs.readFileSync(new URL("./life_events.json", import.meta.url), "utf8"))
  if (Array.isArray(j.events)) LIFE = j.events.filter(e => e && e.key && e.state && e.task)
} catch (e) {
  console.warn(new Date().toISOString(), `[office-hub] 未读到 life_events.json (${e.message})，生活决策层停用`)
}
/* 这些状态下不插话：正事（外部业务态）、睡觉、出错、以及刚到的"到岗" */
const LIFE_BLOCKED = new Set([
  "working", "writing", "rewriting", "designing", "diary", "weekly", "posting",
  "replying", "commenting", "organizing", "browsing", "watching",
  "error", "sleeping", "arrive", "celebrating"
])
let lastLifeKey = null
let nextLifeAt = 0
function planNextLife() { nextLifeAt = Date.now() + LIFE_MIN_MS * (0.8 + Math.random() * 0.4) }
/* 需求曲线：与前端 life.js 的 needBoost 同形（越低越想吃/睡/洗），
 * 单因子乘进去就够了 —— 多因子连乘会把所有候选一起压扁（utility AI 的补偿问题）。 */
function lifeNeedBoost(need) {
  if (!need) return 1
  const v = Number(stats[need])
  if (!Number.isFinite(v)) return 1
  if (v >= 88) return 0.05;
  if (v >= 75) return 0.3;
  if (v >= 65) return 0.75;
  if (v >= 40) return 1;
  if (v >= 25) return 2.2;
  if (v >= 15) return 3.5;
  return 5
}
function pickLife(weather) {
  const h = beijingHour()
  const pool = LIFE.filter(e => {
    if (allowed && !allowed.has(e.state)) return false       // 白名单外的状态推出去会被自己拒掉
    if (e.hours && !hourInWindow(h, e.hours)) return false
    if (e.weather && e.weather !== weather) return false
    if (e.key === lastLifeKey) return false                  // 不连着做同一件事
    return true
  })
  if (!pool.length) return null
  const weights = pool.map(e => (Number(e.w) || 1) * lifeNeedBoost(e.need))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i] }
  return pool[pool.length - 1]
}
function lifeTick() {
  if (!LIFE.length) return
  if (!nextLifeAt) { planNextLife(); return }
  if (Date.now() < nextLifeAt) return
  planNextLife()
  if (!isAwakeHour()) return
  if (LIFE_BLOCKED.has(cur.state)) return                    // 正事/睡觉中不打扰
  const curAge = Date.now() - (Number(cur.ts) || 0)
  if (curAge < 90e3) return                                  // 刚排上的动作别两秒就换掉
  if ((cur.priority || 0) >= 2 && curAge < PRIORITY_HOLD_MS) return
  const e = pickLife(realWeather)
  if (!e) return
  lastLifeKey = e.key
  if (e.fills) applyStatDelta(e.fills)                       // 数值由 hub 自己结算（前端不再上报）
  applyEvent({ state: e.state, task: e.task, detail: e.detail || "", ts: Date.now(), priority: 1 })
  console.log(new Date().toISOString(), `[office-hub] 生活决策: ${e.state}（${e.task}）`)
}
setInterval(lifeTick, 20e3).unref?.()
planNextLife()

/**
 * 去抖规则：state + task + detail 三者全同 = 心跳重发，只刷新 ts，不广播也不进 recent，
 * 免得浏览器里的鱼反复重走路、最近事件列表堆满重复项；detail 变化仍会广播（状态条要更新）。
 */
function applyEvent(ev) {
  const now = Date.now()
  const state = String(ev.state || "").slice(0, 32)
  if (allowed && !allowed.has(state)) {
    return { ok: false, status: 400, error: `未知状态 "${state}"；请同步 hub/states.json 与前端 STATE_MAP` }
  }
  const prio = eventPriority(ev, state)
  // 优先级仲裁（P1.2）：外部打点只在 ≥ 当前优先级时打断。
  // 避免一条低优先级 idle（下班归位）把正在播的高优先级状态拽走；同优先级仍按"后到赢"。
  const curPrio = cur.priority || 0
  if (prio < curPrio && now - (Number(cur.ts) || 0) < PRIORITY_HOLD_MS) {
    return { ok: true, dedup: true, suppressed: true, currentPriority: curPrio }
  }
  const next = {
    state,
    task: String(ev.task || "").slice(0, 200),
    detail: String(ev.detail || "").slice(0, 300),
    ts: Number(ev.ts) || now,
    priority: prio
  }
  const same = cur.state === next.state && cur.task === next.task && cur.detail === next.detail
  // 工作消耗（v2.6）：业务态切换时按上一状态持续时长扣 energy——干得越久越累。
  // 只有 5 分钟以上的工作态才算"干过活"（心跳重发不重复扣）；12 分钟扣 1 点，封顶 8 点。
  const durMin = Math.min(120, (now - (Number(cur.ts) || now)) / 60000)
  const WORK_STATES = new Set(["working", "writing", "rewriting", "designing", "diary", "weekly", "posting", "replying", "commenting", "organizing"])
  if (WORK_STATES.has(cur.state) && durMin >= 5 && !same) {
    applyStatDelta({ energy: -Math.min(8, Math.round(durMin / 12)) })
  }
  cur = next
  if (same) { saveDiskDebounced(); return { ok: true, dedup: true } }
  // v85.5 降噪：打字机类高频事件（同 state+task、仅 detail 变化、3 分钟内）不再逐条刷屏
  const last = recent[recent.length - 1]
  if (last && last.state === next.state && last.task === next.task &&
      Date.now() - (last.ts || 0) < 3 * 60000) {
    last.ts = next.ts; last.detail = next.detail; last.at = now   // 原地更新：面板显示最新一次而不堆条目
    saveDiskDebounced()
    return { ok: true, dedup: true }
  }
  // v2.6 降噪：新工作态事件进列时，把刚被它打断的同 task「arrive」折叠掉（arrive 无信息量）
  if (next.state !== "arrive") {
    const lastRec = recent[recent.length - 1]
    if (lastRec && lastRec.state === "arrive" && lastRec.task === next.task) {
      recent.pop()
    }
  }
  recent.push({ ...next, at: now })
  if (recent.length > MAX_RECENT) recent.shift()
  broadcast({ type: "state", state: cur, stats: statsSnapshot() })
  saveDiskDebounced()
  return { ok: true, dedup: false }
}

// ---------- NPC 对话素材（v2.6）----------
/* 读外部事件源的落盘文件，聚合成 NPC 台词可引用的"鱼最近生活"快照。
 * 默认值按「本文件位置推导」找兄弟项目目录（office/ 与 agent/ 同级），整目录搬迁不用改；
 * 也可以经 OFFICE_SOCIAL_FILE / OFFICE_QQ_STATE_FILE 环境变量显式覆盖。
 * 全部 fail-open（读不到就少几个字段），hub 绝不因外部文件故障挂掉。 */
const NPC_FEED_FILES = {
  social: process.env.OFFICE_SOCIAL_FILE || fileURLToPath(new URL("../../agent/state/social_memory.json", import.meta.url)),
  qq: process.env.OFFICE_QQ_STATE_FILE || fileURLToPath(new URL("../../agent/state/qq_state.json", import.meta.url)),
}
function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) } catch { return null }
}
function npcFeedSnapshot() {
  const now = Date.now()
  const social = readJsonSafe(NPC_FEED_FILES.social) || {}
  const qq = readJsonSafe(NPC_FEED_FILES.qq) || {}
  // 最近 24h 的事件（挑有画面感的）
  const dayAgo = now - 24 * 3600e3
  const recentEvents = (social.events || [])
    .filter(e => new Date(e.at || 0).getTime() > dayAgo)
    .slice(-6)
    .map(e => ({ at: e.at, who: e.who, text: e.content }))
  // 最近互动过的人（QQ 群友）
  const friends = Object.values(social.friends || {})
    .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""))
    .slice(0, 3)
    .map(f => ({ name: f.name, intimacy: f.intimacy || 0, lastText: (f.topics || []).slice(-1)[0] || "" }))
  // 最新文章（从 PB 拿太重，改由事件流里的 publish 事件覆盖；这里给最近发的说说/动态）
  const lastShares = (social.shares || []).slice(-3).map(s => ({ type: s.type, item: s.item, at: s.at }))
  // 心情（双系统：QQ 侧 mood + 小镇 stats）
  return {
    ts: now,
    recentEvents,
    friends,
    lastShares,
    memes: (social.memes || []).slice(-3).map(m => m.name),
    qqMood: Math.round(qq.mood || 60),
    qqChatLog: (qq.chatLog || []).slice(-3).map(c => ({ who: c.who, reply: c.reply })),
  }
}

// ---------- 地图自定义层（v37 编辑地图界面）----------
/* 浏览器编辑模式的增删改存到这里：map.custom.json（与只读的 web/map.json 分离）。
 * 编辑在本地（127.0.0.1）或 ?debug=1 下进行；保存时 hub 校验资产存在/坐标范围/条数上限，
 * 广播 {type:"map"} 让所有在线页面热重载家具层，重启由 loadCustomMap() 恢复。 */
const MAP_FILE = process.env.OFFICE_MAP_FILE
  ? path.resolve(process.env.OFFICE_MAP_FILE)
  : fileURLToPath(new URL("./map.custom.json", import.meta.url))
const MAP_MAX_ITEMS = 6000   // v74：56×30=1680 格，地板+地形各铺满就 3360 条，400 太小

/* v47：每次覆盖 map.custom.json 之前先备份（用户的编辑不能被一次误操作全抹掉）。
 * 备份放在同目录 map.backups/map-<时间戳>-<条数>.json，保留最近 30 份。 */
const MAP_BACKUP_DIR = path.join(path.dirname(MAP_FILE), "map.backups")
const MAP_BACKUP_KEEP = 30
function backupMapFile() {
  try {
    if (!fs.existsSync(MAP_FILE)) return null
    fs.mkdirSync(MAP_BACKUP_DIR, { recursive: true })
    let n = 0
    try { n = (JSON.parse(fs.readFileSync(MAP_FILE, "utf8")).furniture || []).length } catch {}
    const d = new Date()
    const pad = v => String(v).padStart(2, "0")
    const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
    const name = `map-${stamp}-${n}条.json`
    fs.copyFileSync(MAP_FILE, path.join(MAP_BACKUP_DIR, name))
    const all = fs.readdirSync(MAP_BACKUP_DIR).filter(f => /^map-.*\.json$/.test(f)).sort()
    while (all.length > MAP_BACKUP_KEEP) {
      try { fs.unlinkSync(path.join(MAP_BACKUP_DIR, all.shift())) } catch {}
    }
    return name
  } catch (e) {
    console.warn(new Date().toISOString(), "[office-hub] 备份失败:", e.message)
    return null
  }
}
function listMapBackups() {
  try {
    return fs.readdirSync(MAP_BACKUP_DIR).filter(f => /^map-.*\.json$/.test(f)).sort().reverse().map(f => {
      const st = fs.statSync(path.join(MAP_BACKUP_DIR, f))
      let count = null
      try { count = (JSON.parse(fs.readFileSync(path.join(MAP_BACKUP_DIR, f), "utf8")).furniture || []).length } catch {}
      return { name: f, bytes: st.size, mtime: st.mtimeMs, count }
    })
  } catch { return [] }
}
function loadCustomMap() {
  try {
    const j = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"))
    if (Array.isArray(j.furniture)) return { furniture: j.furniture, updatedAt: j.updatedAt || 0 }
  } catch {}
  return { furniture: [], updatedAt: 0 }
}
let customMap = loadCustomMap()

/* 校验一条自定义家具：资产必须在 manifest、坐标在地图内、可选 id 不冲突 */
function validateMapItem(it, existingIds) {
  if (!it || typeof it !== "object") return "条目必须是对象"
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(String(it.a || ""))) return "资产名非法"
  const x = Number(it.x), y = Number(it.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 56 || y < 0 || y > 30) return "坐标越界（0..56 / 0..30）"
  if (it.id && !/^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(String(it.id))) return "id 非法"
  if (it.id && existingIds.has(String(it.id))) return "id 重复: " + it.id
  if (it.frame != null && (!Number.isInteger(it.frame) || it.frame < 0 || it.frame > 63)) return "frame 非法"
  return null
}

function applyMapEdit(action, item) {
  if (action === "set") {
    if (!Array.isArray(item)) return { ok: false, status: 400, error: "furniture 数组缺失" }
    if (item.length > MAP_MAX_ITEMS) return { ok: false, status: 400, error: `超过上限 ${MAP_MAX_ITEMS} 条` }
    const ids = new Set()
    for (const it of item) {
      const err = validateMapItem(it, ids)
      if (err) return { ok: false, status: 400, error: err }
      if (it.id) ids.add(String(it.id))
    }
    customMap = { furniture: item, updatedAt: Date.now() }
  } else if (action === "add") {
    const ids = new Set(customMap.furniture.map(f => String(f.id || "")).filter(Boolean))
    const err = validateMapItem(item, ids)
    if (err) return { ok: false, status: 400, error: err }
    if (customMap.furniture.length >= MAP_MAX_ITEMS) return { ok: false, status: 400, error: `超过上限 ${MAP_MAX_ITEMS} 条` }
    if (!item.id) item.id = "cu" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
    customMap.furniture.push(item)
    customMap.updatedAt = Date.now()
  } else if (action === "move" || action === "update") {
    const it = customMap.furniture.find(f => f.id === item.id)
    if (!it) return { ok: false, status: 404, error: "未找到 " + item.id }
    if (action === "move") {
      const x = Number(item.x), y = Number(item.y)
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 56 || y < 0 || y > 30) return { ok: false, status: 400, error: "坐标越界" }
      it.x = Math.round(x * 100) / 100; it.y = Math.round(y * 100) / 100
    } else {
      for (const k of ["a", "x", "y", "sc", "o", "wall", "frame", "on", "dx", "dy", "ox", "oy", "room", "band"]) {
        if (item[k] !== undefined) it[k] = item[k]
      }
      const ids = new Set(customMap.furniture.filter(f => f !== it && f.id).map(f => String(f.id)))
      const err = validateMapItem(it, ids)
      if (err) return { ok: false, status: 400, error: err }
    }
    customMap.updatedAt = Date.now()
  } else if (action === "remove") {
    const n = customMap.furniture.length
    customMap.furniture = customMap.furniture.filter(f => f.id !== item.id)
    if (customMap.furniture.length === n) return { ok: false, status: 404, error: "未找到 " + (item && item.id) }
    customMap.updatedAt = Date.now()
  } else {
    return { ok: false, status: 400, error: "未知 action: " + action }
  }
  const bak = backupMapFile()          // v47：先备份再覆盖
  try {
    fs.writeFileSync(MAP_FILE + ".tmp", JSON.stringify(customMap, null, 1))
    fs.renameSync(MAP_FILE + ".tmp", MAP_FILE)
  } catch (e) {
    console.warn(new Date().toISOString(), `[office-hub] 地图落盘失败: ${e.message}`)
  }
  broadcast({ type: "map", furniture: customMap.furniture, updatedAt: customMap.updatedAt })
  console.log(new Date().toISOString(), `[office-hub] 地图 ${action} · 现 ${customMap.furniture.length} 条 · 备份 ${bak || "无"}`)
  return { ok: true, count: customMap.furniture.length }
}

// ---------- 农场（v2.8-a2）：从 localStorage 搬到 hub ----------
/* 为什么搬：原来是每个浏览器一份 localStorage，两个观众就是两个农场；而且种子只减不增
 * （初始 wheat×2 + carrot×1），种三次之后永久停摆、其余 17 格永远空着。
 * 现在：一份真相在 hub/farm.json，所有人共享；并且补上闭环 ——
 *   · 每天清晨市集补 2 粒种子（按星期轮换作物）
 *   · 收割 60% 概率返 1 粒同种种子
 *   · 每两天补 1 份肥料（钓鱼仍会捞到）
 * 前端 farm.js 在线时只负责画和发动作，数值以 hub 返回的为准（离线退回 localStorage）。 */
const FARM_FILE = process.env.OFFICE_FARM_FILE
  ? path.resolve(process.env.OFFICE_FARM_FILE)
  : fileURLToPath(new URL("./farm.json", import.meta.url))
const FARM_COLS = 5, FARM_ROWS = 4, FARM_PLOTS = FARM_COLS * FARM_ROWS
const FERTILIZER_BOOST = 0.5
const CROPS = {
  wheat:   { name: "小麦",   stages: 4, growMin: 90 },
  tomato:  { name: "番茄",   stages: 4, growMin: 110 },
  carrot:  { name: "胡萝卜", stages: 3, growMin: 80 },
  corn:    { name: "玉米",   stages: 4, growMin: 130 },
  cabbage: { name: "卷心菜", stages: 3, growMin: 100 }
}
const CROP_IDS = Object.keys(CROPS)
function bjDayKey() {
  return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
}
function farmNew() {
  const plots = []
  for (let i = 0; i < FARM_PLOTS; i++) plots.push({ soil: false, watered: false, fed: false, crop: null, stage: 0, progress: 0 })
  return { plots, inv: { seeds: { wheat: 2, carrot: 1 }, crops: {}, feed: 1 }, day: bjDayKey(), fish: 0 }
}
function loadFarm() {
  try {
    const j = JSON.parse(fs.readFileSync(FARM_FILE, "utf8"))
    if (j && Array.isArray(j.plots) && j.plots.length === FARM_PLOTS && j.inv) return j
  } catch {}
  return farmNew()
}
function saveFarm() {
  try {
    fs.writeFileSync(FARM_FILE + ".tmp", JSON.stringify(farm))
    fs.renameSync(FARM_FILE + ".tmp", FARM_FILE)
  } catch (e) { console.warn(new Date().toISOString(), `[office-hub] 农场落盘失败: ${e.message}`) }
}
let farm = loadFarm()
const farmThrottle = Object.create(null)   // 每个 IP 的动作节流（150ms）

/* 跨天结算 + v2.8 闭环：浇过水的地干掉；生长按存活天数推进；清晨市集补种子 */
function farmRollDay() {
  const today = bjDayKey()
  if (farm.day === today) return false
  const days = Math.max(1, Math.round((Date.parse(today) - Date.parse(farm.day || today)) / 86400e3) || 1)
  farm.plots.forEach(p => {
    p.watered = false; p.fed = false
    if (p.crop) p.progress = Math.min(1, p.progress + 0.5 * Math.min(days, 3))
  })
  // 市集每天补 2 粒种子（按星期轮换，保证五种作物都拿得到）+ 每两天 1 份肥料
  const crop = CROP_IDS[new Date(Date.now() + 8 * 3600e3).getDay() % CROP_IDS.length]
  farm.inv.seeds[crop] = (farm.inv.seeds[crop] || 0) + 2
  if (new Date(Date.now() + 8 * 3600e3).getDate() % 2 === 0) farm.inv.feed = (farm.inv.feed || 0) + 1
  farm.day = today
  saveFarm()
  console.log(new Date().toISOString(), `[office-hub] 农场跨天：浇水清除 · 市集补 ${crop}×2 · 肥料 ${farm.inv.feed}`)
  return true
}
farmRollDay()

/* 生长 tick：浇过水才长，肥料加速（与前端 farmTick 同一套公式，30s 一跳） */
function farmGrow() {
  let dirty = false
  farm.plots.forEach(p => {
    if (!p.crop || p.progress >= 1 || !p.watered) return
    const cd = CROPS[p.crop] || { stages: 3, growMin: 100 }
    p.progress = Math.min(1, p.progress + 1 / (cd.growMin * (p.fed ? FERTILIZER_BOOST : 1)) * 3)
    p.stage = Math.min(cd.stages - 1, Math.floor(p.progress * cd.stages))
    dirty = true
  })
  if (dirty) {
    saveFarm()
    broadcast({ type: "farm", farm })
  }
}
setInterval(() => { farmRollDay(); farmGrow() }, 30e3).unref?.()

function farmSnapshot() {
  let tilled = 0, growing = 0, ready = 0
  farm.plots.forEach(p => { if (p.soil) tilled++; if (p.crop) growing++; if (p.crop && p.progress >= 1) ready++ })
  return { plots: farm.plots, inv: farm.inv, day: farm.day, fish: farm.fish || 0, tilled, growing, ready, max: FARM_PLOTS }
}
function farmAct(act, slot, prefer) {
  farmRollDay()
  const order = (typeof slot === "number" && farm.plots[slot]) ? [slot] : farm.plots.map((_, i) => i)
  const pickIds = () => Object.keys(farm.inv.seeds).filter(id => farm.inv.seeds[id] > 0)
  for (const i of order) {
    const p = farm.plots[i]
    if (act === "till" && !p.soil && !p.crop) { p.soil = true; break }
    if (act === "water" && p.soil && !p.watered) { p.watered = true; p.progress = Math.min(1, p.progress + 0.12); break }
    if (act === "sow" && p.soil && !p.crop) {
      const ids = pickIds()
      if (!ids.length) return { ok: false, text: "种子用完了（市集每天清晨会补）" }
      // 前端本地已经随机挑过一次：它把选择一起发上来，两边就不会种出不同的作物
      const id = (prefer && (farm.inv.seeds[prefer] || 0) > 0) ? prefer : ids[Math.floor(Math.random() * ids.length)]
      farm.inv.seeds[id]--
      p.crop = id; p.stage = 0; p.progress = 0; p.watered = false
      break
    }
    if (act === "feed" && p.crop && !p.fed) {
      if (!(farm.inv.feed > 0)) return { ok: false, text: "没有肥料了（钓鱼有时能捞到）" }
      farm.inv.feed--; p.fed = true; p.progress = Math.min(1, p.progress + 0.2)
      break
    }
    if (act === "harvest" && p.crop && p.progress >= 1) {
      farm.inv.crops[p.crop] = (farm.inv.crops[p.crop] || 0) + 1
      // v2.8 闭环：收割 60% 返 1 粒同种种子，农场才能自己转起来
      let extra = ""
      if (Math.random() < 0.6) { farm.inv.seeds[p.crop] = (farm.inv.seeds[p.crop] || 0) + 1; extra = "，留下 1 粒种子" }
      p.crop = null; p.stage = 0; p.progress = 0; p.watered = false; p.fed = false
      return finishFarm({ ok: true, text: "收获了×1" + extra })
    }
    if (act === "fish") break
  }
  if (act === "fish") {
    /* 概率与前端 fishReel 对齐：78% 鱼 / 15% 肥料 / 7% 河童的旧怀表（肥料×2） */
    const roll = Math.random()
    if (roll < 0.78) { farm.fish = (farm.fish || 0) + 1; return finishFarm({ ok: true, text: "钓到了鲜鱼！" }) }
    if (roll < 0.93) { farm.inv.feed = (farm.inv.feed || 0) + 1; return finishFarm({ ok: true, text: "钓到了肥料！" }) }
    farm.inv.feed = (farm.inv.feed || 0) + 2
    return finishFarm({ ok: true, text: "钓到了河童的旧怀表！（肥料×2）" })
  }
  return finishFarm({ ok: true })
}
function finishFarm(res) {
  saveFarm()
  broadcast({ type: "farm", farm })
  return { ...res, farm: farmSnapshot() }
}

// ---------- 命名交互（v2.8-b1）：数值只由 hub 写 ----------
/* 为什么要有这一层：烹饪/聊天/串门/钓鱼/农活原来都是前端算出 delta 再 POST /api/stats。
 * 两个问题：① 数值的"真相"在浏览器里（前端说什么就是什么）；② 前端把路径写死成
 * "/office-hub-api/stats"，本地开发（dev.mjs 起在 4322）根本没有这个前缀，于是本地一直静默失败。
 * 现在前端只发"我做了什么事"（kind + 少量参数），金额由 hub 这张表决定。 */
const RECIPE_STATS = {
  bread:     { hunger: 22, mood: 3 },
  salad:     { hunger: 16, mood: 6 },
  soup:      { hunger: 20, mood: 4 },
  fishgrill: { hunger: 30, mood: 6 },
  sushi:     { hunger: 34, mood: 8 },
  popcorn:   { hunger: 10, mood: 8 },
  juice:     { hunger: 8,  mood: 7 },
  stew:      { hunger: 38, mood: 5 }
}
const INTERACT = {
  fish:       { mood: 5, hunger: 1 },     // 钓上来了：小确幸
  chat:       { social: 10, mood: 3 },    // 和邻居搭上话
  visit_home: { social: 6 },              // 串门，主人在家
  visit_away: { social: 2 },              // 串门，扑了个空
  farm_work:  { mood: 2, energy: -1 }     // 下地干了一会儿
}
function applyInteract(kind, extra) {
  if (kind === "cook") {
    const id = String((extra && extra.dish) || "")
    const st = RECIPE_STATS[id]
    if (!st) return { ok: false, status: 400, error: "未知菜品 " + id }
    applyStatDelta(st)
    return { ok: true, kind, delta: st }
  }
  const delta = INTERACT[kind]
  if (!delta) return { ok: false, status: 400, error: "未知交互 " + kind }
  applyStatDelta(delta)
  if (kind === "chat") bumpAffinity(extra && extra.npc)   // v2.9：聊天累计关系值
  return { ok: true, kind, delta }
}

// ---------- NPC 关系值（v2.9）：她记得你和她说过的每一句话 ----------
/* 三个档位，直接决定台词与主动程度：
 *   stranger (<3)  刚搬来，客气；familiar (3~7) 熟面，会多聊两句；close (>=8) 亲近，会主动凑过来。
 * 存 hub/npc.json（OFFICE_NPC_FILE 可改），随 /api/npc-feed 下发给前端选台词。
 * 关系值只增不减（上限 20）：这不是养成游戏的压力系统，而是"越住越熟"的记账。 */
const NPC_FILE = process.env.OFFICE_NPC_FILE
  ? path.resolve(process.env.OFFICE_NPC_FILE)
  : fileURLToPath(new URL("./npc.json", import.meta.url))
const NPC_IDS = ["cat", "chief", "doc"]
const AFFINITY_CAP = 20
let npcRel = {}
try {
  const j = JSON.parse(fs.readFileSync(NPC_FILE, "utf8"))
  NPC_IDS.forEach(id => { if (j && j[id]) npcRel[id] = j[id] })
} catch {}
NPC_IDS.forEach(id => {
  if (!npcRel[id]) npcRel[id] = { affinity: 0, chats: 0, lastAt: 0 }
})
function npcTier(a) {
  const v = Number(a) || 0
  return v >= 8 ? "close" : v >= 3 ? "familiar" : "stranger"
}
let npcSaveTimer = null
function saveNpcRel() {
  if (npcSaveTimer) return
  npcSaveTimer = setTimeout(() => {
    npcSaveTimer = null
    try {
      fs.writeFileSync(NPC_FILE + ".tmp", JSON.stringify(npcRel))
      fs.renameSync(NPC_FILE + ".tmp", NPC_FILE)
    } catch (e) { console.warn(new Date().toISOString(), "[office-hub] 关系值落盘失败: " + e.message) }
  }, 500)
  npcSaveTimer.unref?.()
}
function bumpAffinity(id) {
  const key = String(id || "")
  if (!npcRel[key]) return null
  const r = npcRel[key]
  const before = npcTier(r.affinity)
  r.affinity = Math.min(AFFINITY_CAP, (Number(r.affinity) || 0) + 1)
  r.chats = (Number(r.chats) || 0) + 1
  r.lastAt = Date.now()
  const tier = npcTier(r.affinity)
  saveNpcRel()
  broadcast({ type: "npc", npc: key, affinity: r.affinity, tier, becameFriend: before !== tier })
  if (before !== tier) console.log(new Date().toISOString(), "[office-hub] 关系升级: " + key + " " + before + " → " + tier + "（" + r.affinity + "）")
  return { affinity: r.affinity, tier }
}
function affinitySnapshot() {
  const out = {}
  NPC_IDS.forEach(id => { out[id] = { value: npcRel[id].affinity, chats: npcRel[id].chats, tier: npcTier(npcRel[id].affinity) } })
  return out
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
}
// v85.5 安全修复：外网经 nginx 反代可触达 hub——写操作（地图编辑/恢复）只允许本地直连
// （nginx 反代请求带 X-Forwarded-For 时拒绝）。GET 不受限（观众面板需要）。
const mapWriteRate = new Map()   // ip → [时间戳]
function isLocalWrite(req) {
  if (req.headers["x-forwarded-for"] || req.headers["x-real-ip"]) return false   // 反代透传 = 外网来源
  const addr = req.socket?.remoteAddress || ""
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1"
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS).end(); return }
  if (req.method === "POST" && (req.url === "/api/event" || req.url === "/api/heartbeat")) {
    // v85.5 安全修复：NPC 状态注入只允许本地（agent 直连 127.0.0.1）——外网可伪造「大肥鱼正在做的事」污染面板信任
    if (!isLocalWrite(req)) { res.writeHead(403, CORS).end(JSON.stringify({ error: "事件注入仅限本地" })); return }
    let body = ""
    req.on("data", c => { body += c; if (body.length > 4096) req.destroy() })
    req.on("end", () => {
      let ev
      try { ev = JSON.parse(body || "{}") }
      catch { res.writeHead(400, CORS).end("bad json"); return }
      const r = applyEvent(ev)
      if (!r.ok) {
        res.writeHead(r.status, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
        res.end(JSON.stringify({ error: r.error, allowed: allowed ? [...allowed] : null }))
        return
      }
      res.writeHead(204, CORS).end()
    })
    return
  }
  if (req.method === "POST" && req.url === "/api/random-event") {
    // 调试 / 外部触发：body {key} 指定事件，或 {} 随机抽
    let body = ""
    req.on("data", c => { body += c; if (body.length > 1024) req.destroy() })
    req.on("end", () => {
      let d = {}
      try { d = JSON.parse(body || "{}") } catch {}
      const ev = d.key ? RANDOM_EVENTS.find(e => e.key === d.key) : pickRandomEvent(d.weather || "sunny")
      if (!ev) { res.writeHead(404, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify({ error: "no such event or none qualifies" })); return }
      lastRandomEvent = ev.key
      broadcast({ type: "event", eventKey: ev.key, label: ev.label, text: ev.text, ts: Date.now() })
      res.writeHead(200, { ...CORS, "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, fired: ev.key }))
    })
    return
  }
  if (req.method === "POST" && req.url === "/api/stats") {
    let body = ""
    req.on("data", c => { body += c; if (body.length > 2048) req.destroy() })
    req.on("end", () => {
      let d
      try { d = JSON.parse(body || "{}") }
      catch { res.writeHead(400, CORS).end("bad json"); return }
      applyStatDelta(d)
      res.writeHead(204, CORS).end()
    })
    return
  }
  if (req.method === "POST" && req.url === "/api/interact") {
    let body = ""
    req.on("data", c => { body += c; if (body.length > 1024) req.destroy() })
    req.on("end", () => {
      let d
      try { d = JSON.parse(body || "{}") }
      catch { res.writeHead(400, CORS).end("bad json"); return }
      const r = applyInteract(String(d.kind || ""), d)
      res.writeHead(r.ok ? 200 : (r.status || 400), { ...CORS, "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(r))
    })
    return
  }
  if (req.url === "/api/farm" && req.method === "GET") {

    farmRollDay()
    res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
    res.end(JSON.stringify(farmSnapshot()))
    return
  }
  if (req.url === "/api/farm" && req.method === "POST") {
    // 动作来自玩家点击：同一个 IP 150ms 内只放一条，防止连点把存档写爆
    const ip = String(req.socket.remoteAddress || "?")
    const now = Date.now()
    if (farmThrottle[ip] && now - farmThrottle[ip] < 150) { res.writeHead(429, CORS).end(); return }
    farmThrottle[ip] = now
    let body = ""
    req.on("data", c => { body += c; if (body.length > 2048) req.destroy() })
    req.on("end", () => {
      let d
      try { d = JSON.parse(body || "{}") }
      catch { res.writeHead(400, CORS).end("bad json"); return }
      const act = String(d.act || d.action || "")
      const slot = Number.isInteger(d.slot) ? d.slot : null
      if (!["till", "water", "sow", "feed", "harvest", "fish"].includes(act)) {
        res.writeHead(400, { ...CORS, "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ error: "未知动作 " + act }))
        return
      }
      const r = farmAct(act, slot, typeof d.crop === "string" && CROPS[d.crop] ? d.crop : null)
      res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify(r))
    })
    return
  }
  if (req.url === "/api/script") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
    res.end(JSON.stringify({ script: dailyScript(), ts: Date.now() }))
    return
  }
  if (req.url === "/api/status") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
    tickStats()
    res.end(JSON.stringify({
      state: cur, recent, stats: statsSnapshot(), viewers: clients.size, weather: realWeather,
      allowedStates: allowed ? allowed.size : null,
      wake: [WAKE_START, WAKE_END],
      persisted: fs.existsSync(STATE_FILE), startedAt: STARTED_AT
    }))
    return
  }
  // NPC 对话素材（v2.6）：前端 npc.js 挑对话时取这里，让 NPC 的台词「知道鱼最近在干嘛」。
  // 读外部事件源的落盘（social_memory.json / qq_state.json / posts 最近一条），fail-open。
  if (req.url === "/api/npc-feed") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
    // v2.9：把三个邻居的关系值/档位一起下发，前端据此挑台词与决定要不要主动凑过来
    res.end(JSON.stringify({ ...npcFeedSnapshot(), affinity: affinitySnapshot() }))
    return
  }
  // 地图自定义层（v37 编辑地图界面）：GET 读全量，POST 增删改（仅本机/调试用）
  /* v47：历史存档（每次覆盖前的自动备份）+ 一键恢复 */
  if (req.url === "/api/map/backups" && req.method === "GET") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
    res.end(JSON.stringify({ dir: MAP_BACKUP_DIR, list: listMapBackups() }))
    return
  }
  if (req.url === "/api/map/restore" && req.method === "POST") {
    // restore 会整张覆盖地图——高危，只允许本地直连（本地编辑器/脚本），线上编辑器仅读备份列表
    if (!isLocalWrite(req)) { res.writeHead(403, CORS).end(JSON.stringify({ error: "地图恢复仅限本地直连" })); return }
    let body = ""
    req.on("data", c => { body += c; if (body.length > 8192) req.destroy() })
    req.on("end", () => {
      let d = {}
      try { d = JSON.parse(body || "{}") } catch {}
      const name = String(d.name || "")
      if (!/^map-[0-9]{8}-[0-9]{6}-[0-9]+条\.json$/.test(name)) {
        res.writeHead(400, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
        res.end(JSON.stringify({ error: "文件名非法" }))
        return
      }
      try {
        const j = JSON.parse(fs.readFileSync(path.join(MAP_BACKUP_DIR, name), "utf8"))
        if (!Array.isArray(j.furniture)) throw new Error("备份内容不合法")
        backupMapFile()
        customMap = { furniture: j.furniture, updatedAt: Date.now() }
        fs.writeFileSync(MAP_FILE + ".tmp", JSON.stringify(customMap, null, 1))
        fs.renameSync(MAP_FILE + ".tmp", MAP_FILE)
        broadcast({ type: "map", furniture: customMap.furniture, updatedAt: customMap.updatedAt })
        console.log(new Date().toISOString(), `[office-hub] 恢复备份 ${name} · 现 ${customMap.furniture.length} 条`)
        res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
        res.end(JSON.stringify({ ok: true, count: customMap.furniture.length, name }))
      } catch (e) {
        res.writeHead(500, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  if (req.url === "/api/map" && req.method === "GET") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
    res.end(JSON.stringify({ furniture: customMap.furniture, updatedAt: customMap.updatedAt, max: MAP_MAX_ITEMS }))
    return
  }
  if (req.url === "/api/map" && req.method === "POST") {
    // v85.5 外网写入限频：合法编辑器走反代不能拦，但同 IP 10s 只允许 1 次写（防脚本刷屏摆家具）
    const wip = req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim() : (req.socket?.remoteAddress || "?")
    const now = Date.now()
    mapWriteRate.set(wip, (mapWriteRate.get(wip) || []).filter(t => now - t < 10000))
    const stamps = mapWriteRate.get(wip)
    if (stamps.length >= 1 && !isLocalWrite(req)) {
      res.writeHead(429, CORS).end(JSON.stringify({ error: "编辑太快，稍等 10 秒" })); return
    }
    stamps.push(now)
    let body = ""
    req.on("data", c => { body += c; if (body.length > 262144) req.destroy() })
    req.on("end", () => {
      let d
      try { d = JSON.parse(body || "{}") }
      catch { res.writeHead(400, CORS).end("bad json"); return }
      const r = applyMapEdit(String(d.action || ""), d.item)
      if (!r.ok) {
        res.writeHead(r.status, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
        res.end(JSON.stringify({ error: r.error }))
        return
      }
      res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
      res.end(JSON.stringify({ ok: true, count: r.count, updatedAt: customMap.updatedAt }))
    })
    return
  }
  if (req.url === "/health") { res.writeHead(200, CORS).end("ok"); return }
  res.writeHead(404, CORS).end()
})

const wss = new WebSocketServer({ server })
// 评审修复[高危]：WS 心跳保活——弱网/休眠产生的僵尸连接 30s 无 pong 即踢除
const HEARTBEAT_MS = 30000
wss.on("connection", (ws, req) => {
  clients.add(ws)
  // v85.5 真实观众标记：headless 浏览器/自动化工具不计入「围观人数」（访客彩蛋和状态条只算真人）
  const ua = String(req?.headers?.["user-agent"] || "")
  ws.isBot = /HeadlessChrome|Puppeteer|Playwright|python-requests|curl|bot/i.test(ua)
  ws.isAlive = true
  ws.on("pong", () => { ws.isAlive = true })
  ws.send(JSON.stringify({
    type: "hello",
    state: cur,
    recent: recent.slice(-20),
    stats: statsSnapshot(),
    customMap: customMap.furniture.length ? customMap.furniture : undefined,
    viewers: clients.size,
    weather: realWeather,
    serverTime: Date.now()
  }))
  broadcast({ type: "viewers", viewers: clients.size })
  ws.on("close", () => {
    clients.delete(ws)
    broadcast({ type: "viewers", viewers: clients.size })
  })
  ws.on("error", () => { try { ws.terminate() } catch {} })
  ws.on("message", () => {}) // 浏览器 ping，仅保活，无需应答
})
// 心跳巡检：没 pong 的踢掉；存活的下发 ping
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { try { ws.terminate() } catch {} clients.delete(ws); continue }
    ws.isAlive = false
    try { ws.ping() } catch {}
  }
  broadcast({ type: "viewers", viewers: clients.size })
}, HEARTBEAT_MS).unref?.()

server.listen(PORT, HOST, () => {
  console.log(new Date().toISOString(),
    `[office-hub] listening on http://${HOST}:${PORT} · 白名单 ${allowed ? allowed.size + " 态" : "未启用"} · 持久化 ${STATE_FILE}`)
  console.log(new Date().toISOString(),
    `[office-hub] 空档回落：${WAKE_START}:00–${WAKE_END}:00 显示「${initialState().state}」（${initialState().task}）`)
  console.log(new Date().toISOString(),
    `[office-hub] 数值层：${STAT_KEYS.map(k => `${k}=${stats[k]}`).join(" ")} · 每 60s 衰减 · 睡眠时段减半`)
})

// 每 60s 给所有浏览器广播一次服务器时间（驱动"刚刚 / N 分钟前上报"的相对时间显示）
setInterval(() => broadcast({ type: "ts", ts: Date.now() }), 60000).unref?.()
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (npcSaveTimer) { clearTimeout(npcSaveTimer); npcSaveTimer = null }
  saveDisk()
  // 退出前把"去抖写"的存档刷一次：刚聊完的那句话、刚浇的那块地不能丢
  try { fs.writeFileSync(NPC_FILE, JSON.stringify(npcRel)) } catch {}
  try { saveFarm() } catch {}
  process.exit(0)
})