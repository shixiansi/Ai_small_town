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
  saveDisk()
  broadcast({ type: "stats", stats })
}
/* 广播给前端的精简形态（连同 state 一起带时间戳） */
function statsSnapshot() {
  return { ...stats, ts: stats.updatedAt }
}

// 每 60s：衰减 + 广播一次（与现有 ts 广播共用节奏）
setInterval(() => {
  tickStats()
  saveDisk()
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
/* 天气：hub 不掌握天气（前端 R 键切换），默认晴。事件条件里带 weather 的只在晴天才算"保守通过"，
 * 真正的天气 gate 在前端 EVENT_SCRIPTS 里再做一次（前端知道自己天气）。 */
function scheduleRandomEvents() {
  if (!RANDOM_EVENTS.length) return
  const delay = (2 + Math.random() * 4) * 3600e3   // 2~6 小时
  setTimeout(() => {
    const ev = pickRandomEvent("sunny")
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
      ts: Number(s.ts) || Date.now()
    }
    const recent = (Array.isArray(j.recent) ? j.recent : [])
      .filter(e => e && (allowed ? allowed.has(e.state) : true))
      .slice(-MAX_RECENT)
    return { cur, recent }
  } catch { return { cur: initialState(), recent: [] } }
}
function saveDisk() {
  try {
    fs.writeFileSync(STATE_FILE + ".tmp", JSON.stringify({ state: cur, recent, stats }))
    fs.renameSync(STATE_FILE + ".tmp", STATE_FILE)
  } catch (e) {
    console.warn(new Date().toISOString(), `[office-hub] 状态落盘失败: ${e.message}`)
  }
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
  const next = {
    state,
    task: String(ev.task || "").slice(0, 200),
    detail: String(ev.detail || "").slice(0, 300),
    ts: Number(ev.ts) || now
  }
  const same = cur.state === next.state && cur.task === next.task && cur.detail === next.detail
  cur = next
  if (same) { saveDisk(); return { ok: true, dedup: true } }
  recent.push({ ...next, at: now })
  if (recent.length > MAX_RECENT) recent.shift()
  broadcast({ type: "state", state: cur, stats: statsSnapshot() })
  saveDisk()
  return { ok: true, dedup: false }
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

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
}
const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS).end(); return }
  if (req.method === "POST" && (req.url === "/api/event" || req.url === "/api/heartbeat")) {
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
  if (req.url === "/api/status") {
    res.writeHead(200, { ...CORS, "Content-Type": "application/json; charset=utf-8" })
    tickStats()
    res.end(JSON.stringify({
      state: cur, recent, stats: statsSnapshot(), viewers: clients.size,
      allowedStates: allowed ? allowed.size : null,
      wake: [WAKE_START, WAKE_END],
      persisted: fs.existsSync(STATE_FILE), startedAt: STARTED_AT
    }))
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
wss.on("connection", (ws) => {
  clients.add(ws)
  ws.send(JSON.stringify({
    type: "hello",
    state: cur,
    recent: recent.slice(-20),
    stats: statsSnapshot(),
    customMap: customMap.furniture.length ? customMap.furniture : undefined,
    viewers: clients.size,
    serverTime: Date.now()
  }))
  broadcast({ type: "viewers", viewers: clients.size })
  ws.on("close", () => {
    clients.delete(ws)
    broadcast({ type: "viewers", viewers: clients.size })
  })
  ws.on("error", () => {})
  ws.on("message", () => {}) // 浏览器 ping，仅保活，无需应答
})

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
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { saveDisk(); process.exit(0) })

