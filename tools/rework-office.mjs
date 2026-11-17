// 办公室布局重排（按"北墙一排 / 中间 2 格动线 / 南墙一排"）—— 用唯一模型做校验，冲突就跳过
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const model = loadModel();
const { items, cellsOf, solid, anchorCells, roadCells, map } = model;

// 办公室内部：x1..25 / y16..29（y=15 是隔墙，y=29 南墙裙，x=25 东墙）
const X0 = 1, X1 = 25, YN = 17.4, YS = 27.6;

const wall = model.wallCells;   // 墙格唯一实现在 map-model（第 0 行墙带 + 隔墙 + 地形墙 + 外墙裙）

const inOffice = f => f.x >= 0.5 && f.x <= 25.5 && f.y >= 15.5 && f.y <= 29.5;
const distToWall = f => {
  const tx = Math.round(f.x), ty = Math.round(f.y);
  let d = Infinity;
  for (let k = 1; k <= 8; k++) {
    if (wall.has((tx + k) + "," + ty) || wall.has((tx - k) + "," + ty) || wall.has(tx + "," + (ty + k)) || wall.has(tx + "," + (ty - k))) { d = k; break; }
  }
  return d;
};

const targets = items.filter(f => solid(f) && inOffice(f));
const scattered = targets.filter(f => distToWall(f) > 2.5);
console.log("办公室落地件 " + targets.length + " · 距墙 >2.5 格的散点件 " + scattered.length);

// 按 x 排序后交替塞进南北两条带（贴墙），每个位置都用模型验证
const occ = except => {
  const m = new Map();
  items.forEach(f => { if (f === except || !solid(f)) return; cellsOf(f).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(f); }); });
  return m;
};
const ok = f => {
  const pc = cellsOf(f);
  if (pc.some(k => anchorCells.has(k) || roadCells.has(k))) return false;
  const o = occ(f);
  return !pc.some(k => (o.get(k) || []).some(g => g.a !== f.a));
};

const moves = [];
let n = 0;
scattered.sort((a, b) => a.x - b.x).forEach(f => {
  const band = n % 2 === 0 ? YN : YS;
  for (let x = X0 + 0.5; x <= X1 - 0.5; x += 1.5) {
    const probe = { ...f, x, y: band };
    if (!ok(probe)) continue;
    moves.push([f.id || f.a, f.x, f.y, x, band]);
    f.x = x; f.y = band; n++;
    break;
  }
});
console.log("挪进南北带 " + moves.length + " 件");

if (moves.length) {
  const mapPath = path.join(ROOT, "web", "map.json");
  const customPath = path.join(ROOT, "hub", "map.custom.json");
  const mj = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const cj = JSON.parse(fs.readFileSync(customPath, "utf8"));
  const all = mj.furniture.concat(cj.furniture);
  moves.forEach(([id, ox, oy, nx, ny]) => {
    const f = all.find(v => v.id === id && Math.abs(v.x - ox) < 0.06 && Math.abs(v.y - oy) < 0.06) || all.find(v => v.id === id);
    if (f) { f.x = nx; f.y = ny; }
  });
  fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
  fs.writeFileSync(customPath, JSON.stringify(cj, null, 1));
  const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
  rebuild();
  let g = ""; try { g = execFileSync(process.execPath, [path.join(ROOT, "tools", "check.mjs")], { encoding: "utf8" }); } catch (e) { g = String(e.stdout || ""); }
  const pass = /0 个错误/.test(g);
  console.log("门禁：" + (pass ? "31/31 ✓" : "✗ 未过 → 回滚"));
  if (!pass) { try { execFileSync("git", ["checkout", "--", "web/map.json", "hub/map.custom.json"], { cwd: ROOT }); } catch {} rebuild(); }
}
