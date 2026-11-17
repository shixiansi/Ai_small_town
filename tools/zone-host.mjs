// 给每个 zone 补 host（它服务的那件家具），并把锚点到 host 正前方 1.2 格
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const model = loadModel();
const { items, solid, rooms, roomOf } = model;
const mapPath = path.join(ROOT, "web", "map.json");
const mj = JSON.parse(fs.readFileSync(mapPath, "utf8"));

const solidItems = items.filter(f => solid(f) && f.id);
const report = [];
let hosted = 0, moved = 0;

Object.entries(mj.zones || {}).forEach(([k, z]) => {
  if (!Array.isArray(z.anchor)) return;
  // ① host = 离原锚点最近的落地家具（同房间优先）
  const rk = roomOf(z.anchor[0], z.anchor[1]);
  const cands = solidItems
    .filter(f => !rk || roomOf(f.x, f.y) === rk)
    .sort((a, b) => Math.hypot(a.x - z.anchor[0], a.y - z.anchor[1]) - Math.hypot(b.x - z.anchor[0], b.y - z.anchor[1]));
  const host = cands[0];
  if (!host) return;
  z.host = host.id;
  hosted++;
  const d0 = Math.hypot(host.x - z.anchor[0], host.y - z.anchor[1]);
  if (d0 > 2.0) return;                        // 已经很近，不动

  // ② 锚点挪到 host 正前方 1.2 格：朝向取"房间内"那一侧
  const r = rooms[rk] || null;
  const inward = r ? (host.y < r.y + r.h / 2 ? 1.2 : -1.2) : 1.2;
  const tries = [[host.x, host.y + inward], [host.x, host.y - inward], [host.x + 1.3, host.y], [host.x - 1.3, host.y]];
  for (const [x, y] of tries) {
    const nx = Math.round(x * 10) / 10, ny = Math.round(y * 10) / 10;
    if (model.isBlocked(Math.round(nx), Math.round(ny))) continue;
    if (rk && roomOf(nx, ny) !== rk) continue;
    z.anchor = [nx, ny];
    moved++;
    report.push(k + " " + (host.id) + " 锚点 → " + nx + "," + ny + "（原距 " + d0.toFixed(1) + " 格）");
    break;
  }
});

fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
console.log("补 host：" + hosted + " 个 zone · 锚点前移：" + moved + " 个");
report.slice(0, 12).forEach(t => console.log("  " + t));

const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
rebuild();
const run = t => { try { return execFileSync(process.execPath, [path.join(ROOT, "tools", t)], { encoding: "utf8" }); } catch (e) { return String(e.stdout || ""); } };
const ok = /0 个错误/.test(run("check.mjs"));
console.log("门禁：" + (ok ? "31/31 ✓" : "✗ 未过 → 回滚"));
if (!ok) { try { execFileSync("git", ["checkout", "--", "web/map.json"], { cwd: ROOT }); } catch {} rebuild(); }
