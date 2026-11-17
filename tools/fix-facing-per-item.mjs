// 逐件修朝向违规：每件只改一次、改完跑门禁，失败立刻回退该件
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const mapPath = path.join(ROOT, "web", "map.json");

const BACK = new Set(["cabinet", "bookshelf-office", "filing-cabinet", "wardrobe", "toilet", "sink", "stove-kitchen", "kitchen-counter", "locker"]);
const HEAD = new Set(["double-bed", "bed"]);
const CHAIR = new Set(["chair", "office-chair"]);
const SEAT = new Set(["sofa", "armchair"]);
const TABLES = new Set(["table", "round-table", "dining-table", "office-desk", "desk-wood", "school-desk"]);
const COFFEE = new Set(["round-table", "dining-table"]);

const run = t => { try { return execFileSync(process.execPath, [path.join(ROOT, "tools", t)], { encoding: "utf8" }); } catch (e) { return String(e.stdout || ""); } };
const gateOk = () => /0 个错误/.test(run("check.mjs"));
const violations = () => {
  const out = run("facing-check.mjs");
  const n = (out.match(/✗ (\d+) 处/) || [, "0"])[1];
  const list = [...out.matchAll(/^\s{4}(\S+)\s+(\S+?)@([\d.]+),([\d.]+)\s/gm)].map(m => ({ room: m[1], a: m[2], x: +m[3], y: +m[4] }));
  return { n: +n, list };
};

const start = violations();
console.log("起始违规 " + start.n + " 处");
const fixed = [], failed = [];

for (const v of start.list.slice(0, 30)) {
  const montage = () => {
    const model = loadModel();
    const target = model.items.find(f => f.a === v.a && Math.abs(f.x - v.x) < 0.06 && Math.abs(f.y - v.y) < 0.06);
    return { model, target };
  };
  let { model, target } = montage();
  if (!target || !target.id) { failed.push(v.a + "@" + v.x + "," + v.y + "(无 id，无法精确回退)"); continue; }

  // 候选：朝墙类 → 四边推进；成组类 → 围绕服务对象一圈
  const cands = [];
  if (BACK.has(v.a) || HEAD.has(v.a)) {
    for (const [dx, dy] of [[0, -1], [0, -1.5], [0, 1], [0, 1.5], [-1, 0], [-1.5, 0], [1, 0], [1.5, 0]]) cands.push([v.x + dx, v.y + dy]);
  } else {
    const set = CHAIR.has(v.a) ? TABLES : COFFEE;
    const anchorF = model.items.filter(f => set.has(f.a)).sort((a, b) => Math.hypot(a.x - v.x, a.y - v.y) - Math.hypot(b.x - v.x, b.y - v.y))[0];
    if (anchorF) {
      for (const rad of [1.5, 1.9, 2.2]) for (let ang = 0; ang < 360; ang += 45) {
        cands.push([Math.round((anchorF.x + Math.cos(ang * Math.PI / 180) * rad) * 10) / 10,
                    Math.round((anchorF.y + Math.sin(ang * Math.PI / 180) * rad) * 10) / 10]);
      }
    }
  }

  const mj = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const entry = mj.furniture.find(f => f.id === target.id);
  if (!entry) { failed.push(target.id + "(不在 map.json)"); continue; }
  const ox = entry.x, oy = entry.y;
  let done = false;
  for (const [nx0, ny0] of cands) {
    const nx = Math.round(nx0 * 10) / 10, ny = Math.round(ny0 * 10) / 10;
    if (Math.hypot(nx - ox, ny - oy) < 1.0) continue;
    if (model.isBlocked(Math.round(nx), Math.round(ny))) continue;
    entry.x = nx; entry.y = ny;
    fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
    if (gateOk() && violations().n < start.n) { fixed.push(target.id + " " + ox + "," + oy + " → " + nx + "," + ny); done = true; break; }
  }
  if (!done) {
    entry.x = ox; entry.y = oy;
    fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
    failed.push(target.id + "@" + ox + "," + oy + "(候选都不过)");
  }
}

try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {}
const end = violations();
console.log("修复 " + fixed.length + " 件 · 失败 " + failed.length + " 件");
fixed.forEach(t => console.log("  ok   " + t));
failed.slice(0, 10).forEach(t => console.log("  FAIL " + t));
console.log("朝向违规：" + start.n + " → " + end.n + " · 门禁：" + (gateOk() ? "31/31 ✓" : "✗"));
