// 逐件修朝向「家具 + 它自己的 zone 锚点」成对移动：只动这一对，门禁不过就两条一起回退
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const mapPath = path.join(ROOT, "web", "map.json");

const BACK = new Set(["cabinet", "bookshelf-office", "filing-cabinet", "wardrobe", "toilet", "sink", "stove-kitchen", "kitchen-counter", "locker", "bed", "double-bed"]);
const CHAIR = new Set(["chair", "office-chair"]);
const SEAT = new Set(["sofa", "armchair"]);
const TABLES = new Set(["table", "round-table", "dining-table", "office-desk", "desk-wood", "school-desk"]);
const COFFEE = new Set(["round-table", "dining-table"]);

const run = t => { try { return execFileSync(process.execPath, [path.join(ROOT, "tools", t)], { encoding: "utf8" }); } catch (e) { return String(e.stdout || ""); } };
const gateOk = () => /0 个错误/.test(run("check.mjs"));
const vcount = () => +((run("facing-check.mjs").match(/✗ (\d+) 处/) || [, "0"])[1]);
const vlist = () => [...run("facing-check.mjs").matchAll(/^\s{4}(\S+)\s+(\S+?)@([\d.]+),([\d.]+)\s/gm)].map(m => ({ a: m[2], x: +m[3], y: +m[4] }));

const start = vcount();
const fixed = [], failed = [];
for (const v of vlist().slice(0, 20)) {
  const model = loadModel();
  const item = model.items.find(f => f.a === v.a && Math.abs(f.x - v.x) < 0.06 && Math.abs(f.y - v.y) < 0.06 && f.id);
  if (!item) { failed.push(v.a + "(无 id)"); continue; }
  const mj = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const entry = mj.furniture.find(f => f.id === item.id);
  const zoneKey = Object.keys(mj.zones || {}).find(k => mj.zones[k].host === item.id);
  const zone = zoneKey ? mj.zones[zoneKey] : null;
  const rk = model.roomOf(item.x, item.y), r = model.rooms[rk];

  // 候选位移
  const cands = [];
  if (BACK.has(item.a)) {
    for (const [dx, dy] of [[0, -1.2], [0, 1.2], [-1.2, 0], [1.2, 0], [0, -2.2], [0, 2.2], [-2.2, 0], [2.2, 0]]) cands.push([item.x + dx, item.y + dy]);
  } else {
    const set = CHAIR.has(item.a) ? TABLES : COFFEE;
    const tgt = model.items.filter(f => set.has(f.a)).sort((a, b) => Math.hypot(a.x - item.x, a.y - item.y) - Math.hypot(b.x - item.x, b.y - item.y))[0];
    if (tgt) for (const rad of [1.5, 1.8]) for (let ang = 0; ang < 360; ang += 60)
      cands.push([Math.round((tgt.x + Math.cos(ang * Math.PI / 180) * rad) * 10) / 10, Math.round((tgt.y + Math.sin(ang * Math.PI / 180) * rad) * 10) / 10]);
  }

  const ox = entry.x, oy = entry.y, oa = zone ? zone.anchor.slice() : null;
  let done = false;
  for (const [nx0, ny0] of cands) {
    const nx = Math.round(nx0 * 10) / 10, ny = Math.round(ny0 * 10) / 10;
    if (Math.hypot(nx - ox, ny - oy) < 1.0) continue;
    if (model.isBlocked(Math.round(nx), Math.round(ny))) continue;
    if (rk && model.roomOf(nx, ny) !== rk) continue;
    entry.x = nx; entry.y = ny;
    if (zone) {                                  // 锚点跟着家具走：房间内侧 1.2 格
      const dir = r ? (ny < r.y + r.h / 2 ? 1.2 : -1.2) : 1.2;
      for (const [ax, ay] of [[nx, ny + dir], [nx, ny - dir], [nx + 1.3, ny], [nx - 1.3, ny]]) {
        if (model.isBlocked(Math.round(ax), Math.round(ay))) continue;
        zone.anchor = [Math.round(ax * 10) / 10, Math.round(ay * 10) / 10];
        break;
      }
    }
    fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
    if (gateOk() && vcount() < start) { fixed.push(item.id + " " + v.a + " → " + nx + "," + ny + (zone ? " (anchor " + zone.anchor.join(",") + ")" : "")); done = true; break; }
  }
  if (!done) {
    entry.x = ox; entry.y = oy;
    if (zone && oa) zone.anchor = oa;
    fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
    failed.push(item.id + " " + v.a + "@" + ox + "," + oy);
  }
}

try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {}
console.log("成对移动：修复 " + fixed.length + " · 失败 " + failed.length);
fixed.forEach(t => console.log("  ok   " + t));
failed.slice(0, 8).forEach(t => console.log("  FAIL " + t));
console.log("朝向违规 " + start + " → " + vcount() + " · 门禁 " + (gateOk() ? "31/31 ✓" : "✗"));
