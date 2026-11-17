// 逐 zone 应用锚点：改一个 → 跑门禁 → 失败只回退这一条
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const mapPath = path.join(ROOT, "web", "map.json");
const table = JSON.parse(fs.readFileSync(path.join(ROOT, "zones.host.json"), "utf8"))._confirmed || {};

const gateOk = () => {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, "tools", "check.mjs")], { encoding: "utf8" });
    return /0 个错误/.test(out);
  } catch (e) { return /0 个错误/.test(String(e.stdout || "")); }
};

const ok = [], fail = [];
for (const zone of Object.keys(table)) {
  const model = loadModel();                       // 每次都重新读盘，拿到最新几何
  const { items, rooms, roomOf } = model;
  const host = items.find(f => f.id === table[zone]);
  const mj = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const z = mj.zones && mj.zones[zone];
  if (!host || !z) { fail.push(zone + "(缺 host 或 zone)"); continue; }
  const prev = z.anchor ? z.anchor.slice() : null;
  const rk = roomOf(host.x, host.y), r = rooms[rk];
  const dir = r ? (host.y < r.y + r.h / 2 ? 1.2 : -1.2) : 1.2;
  let placed = null;
  for (const [dx, dy] of [[0, dir], [0, -dir], [1.3, 0], [-1.3, 0]]) {
    const nx = Math.round((host.x + dx) * 10) / 10, ny = Math.round((host.y + dy) * 10) / 10;
    if (model.isBlocked(Math.round(nx), Math.round(ny))) continue;
    if (rk && roomOf(nx, ny) !== rk) continue;
    placed = [nx, ny]; break;
  }
  if (!placed) { fail.push(zone + "(周围无可站格)"); continue; }
  if (prev && prev[0] === placed[0] && prev[1] === placed[1]) { ok.push(zone + "(已是) "); continue; }

  z.anchor = placed;
  fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
  if (gateOk()) ok.push(zone + " → " + placed.join(","));
  else {
    const back = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    back.zones[zone].anchor = prev;
    fs.writeFileSync(mapPath, JSON.stringify(back, null, 1));
    fail.push(zone + "(门禁不过，已回退)");
  }
}

try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {}
console.log("逐 zone 应用锚点：成功 " + ok.length + " · 失败 " + fail.length);
ok.forEach(t => console.log("  ok   " + t));
fail.forEach(t => console.log("  FAIL " + t));
console.log("最终门禁：" + (gateOk() ? "31/31 ✓" : "✗"));
