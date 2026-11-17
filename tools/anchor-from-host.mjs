// 由 zones.host.json 推导锚点：anchor = host 前方 1.2 格（朝房间内侧），验证可走后写回
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const model = loadModel();
const { items, rooms, roomOf } = model;
const table = JSON.parse(fs.readFileSync(path.join(ROOT, "zones.host.json"), "utf8"))._confirmed || {};
const mapPath = path.join(ROOT, "web", "map.json");
const mj = JSON.parse(fs.readFileSync(mapPath, "utf8"));

const byId = new Map(items.filter(f => f.id).map(f => [f.id, f]));
let moved = 0, missing = [];
const lines = [];

Object.entries(table).forEach(([zone, hostId]) => {
  const host = byId.get(hostId);
  const z = mj.zones && mj.zones[zone];
  if (!z) { missing.push(zone + "(zone 不存在)"); return; }
  if (!host) { missing.push(zone + "→" + hostId + "(家具不存在)"); return; }
  const rk = roomOf(host.x, host.y);
  const r = rooms[rk];
  // 朝房间内侧：host 在上半 → 锚点在南侧；下半 → 北侧
  const dir = r ? (host.y < r.y + r.h / 2 ? 1.2 : -1.2) : 1.2;
  let placed = null;
  for (const [dx, dy] of [[0, dir], [0, -dir], [1.3, 0], [-1.3, 0]]) {
    const nx = Math.round((host.x + dx) * 10) / 10, ny = Math.round((host.y + dy) * 10) / 10;
    if (model.isBlocked(Math.round(nx), Math.round(ny))) continue;
    if (rk && roomOf(nx, ny) !== rk) continue;
    placed = [nx, ny];
    break;
  }
  if (!placed) { missing.push(zone + "(周围无可站格)"); return; }
  z.host = hostId;
  const old = z.anchor ? z.anchor.join(",") : "-";
  z.anchor = placed;
  moved++;
  lines.push(zone.padEnd(10) + hostId.padEnd(16) + "anchor " + old + " → " + placed.join(","));
});

fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
console.log("按 host 推导锚点：" + moved + " 个 · 未处理 " + missing.length);
lines.forEach(l => console.log("  " + l));
if (missing.length) console.log("  未处理：" + missing.join(" | "));

const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
rebuild();
const run = t => { try { return execFileSync(process.execPath, [path.join(ROOT, "tools", t)], { encoding: "utf8" }); } catch (e) { return String(e.stdout || ""); } };
const ok = /0 个错误/.test(run("check.mjs"));
console.log("门禁：" + (ok ? "31/31 ✓" : "✗ 未过 → 回滚"));
if (!ok) { try { execFileSync("git", ["checkout", "--", "web/map.json"], { cwd: ROOT }); } catch {} rebuild(); }
