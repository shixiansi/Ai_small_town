// 房间重排 v1（先做 office）：家具贴南北两排 + 锚点同步前移到"墙前 1 格站立位"
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const ROOM = process.argv.includes("--room") ? process.argv[process.argv.indexOf("--room") + 1] : "office";
const model = loadModel();
const { items, cellsOf, solid, anchorCells, roadCells, rooms, roomOf } = model;
const r = rooms[ROOM];
const anchorsObj = model.anchors;

const BACK = new Set(["cabinet", "bookshelf-office", "filing-cabinet", "wardrobe", "toilet", "sink", "stove-kitchen",
  "kitchen-counter", "locker", "double-bed", "bed", "office-desk", "desk-wood", "school-desk", "printer", "whiteboard", "blackboard", "arcade-cabinet", "water-cooler"]);
const SEAT = new Set(["sofa", "armchair", "chair", "office-chair", "bench-park", "table", "round-table", "dining-table"]);

const inRoom = items.filter(f => solid(f) && roomOf(f.x, f.y) === ROOM);
const wallItems = inRoom.filter(f => BACK.has(f.a));
const seatItems = inRoom.filter(f => SEAT.has(f.a));

const occ = except => {
  const m = new Map();
  items.forEach(f => { if (f === except || !solid(f)) return; cellsOf(f).forEach(k => { if (!m.has(k)) m.set(k, []); m.get(k).push(f); }); });
  return m;
};
const free = (f, x, y, occMap) => {
  const pc = cellsOf({ ...f, x, y });
  if (pc.some(k => anchorCells.has(k) || roadCells.has(k))) return false;
  return !pc.some(k => (occMap.get(k) || []).some(g => g.a !== f.a));
};

// 先全部抬到"待定"，再按 x 顺序排进南北两排
const moves = [];
const place = (list, bandY, tag) => {
  let cursor = r.x + 1.0;
  list.sort((a, b) => a.x - b.x).forEach(f => {
    const occMap = occ(f);
    for (let x = cursor; x <= r.x + r.w - 0.5; x += 0.5) {
      if (!free(f, x, bandY, occMap)) continue;
      const d = Math.hypot(x - f.x, bandY - f.y);
      if (d < 0.4) { cursor = x + 1.5; return; }
      moves.push([f.id || f.a, f.x, f.y, x, bandY, tag]);
      f.x = x; f.y = bandY; cursor = x + 1.5;
      return;
    }
  });
};
const half = Math.ceil(wallItems.length / 2);
place(wallItems.slice(0, half), r.y + 1.2, "北排");
place(wallItems.slice(half), r.y + r.h - 1.2, "南排");

// 座具/桌子：南北排之间留 2 格动线，塞到 y 中部两带
seatItems.sort((a, b) => a.x - b.x);
let ci = 0;
seatItems.forEach(f => {
  const occMap = occ(f);
  for (let x = r.x + 1.0; x <= r.x + r.w - 0.5; x += 0.5) {
    const y = ci % 2 === 0 ? r.y + 3.4 : r.y + r.h - 3.4;
    if (!free(f, x, y, occMap)) continue;
    if (Math.hypot(x - f.x, y - f.y) < 0.4) { ci++; return; }
    moves.push([f.id || f.a, f.x, f.y, x, y, "中排"]);
    f.x = x; f.y = y; ci++;
    return;
  }
});

// 锚点跟随：原锚点离某件被移动家具 ≤2.4 格 → 移到该家具"朝向房间内侧 1.3 格"
const anchorMoves = [];
Object.entries(anchorsObj).forEach(([k, a]) => {
  if (roomOf(a.raw[0], a.raw[1]) !== ROOM) return;
  const m = moves.find(mv => Math.hypot(mv[1] - a.raw[0], mv[2] - a.raw[1]) <= 2.4);
  if (!m) return;
  // 家具在房间上半 → 锚点放它南侧；下半 → 北侧
  const dir = m[4] < r.y + r.h / 2 ? 1.3 : -1.3;
  const nx = Math.round(m[3]), ny = Math.round(m[4] + dir);
  if (model.isBlocked(nx, ny)) return;
  anchorMoves.push([k, a.raw.slice(), [nx, ny]]);
});

console.log(ROOM + "：家具移动 " + moves.length + " 件 · 锚点跟随 " + anchorMoves.length + " 个");
moves.slice(0, 6).forEach(m => console.log("  " + m[5] + " " + String(m[0]).padEnd(16) + m[1] + "," + m[2] + " → " + m[3] + "," + m[4]));
anchorMoves.slice(0, 6).forEach(a => console.log("  anchor " + a[0] + " " + a[1].join(",") + " → " + a[2].join(",")));

if (moves.length) {
  const mapPath = path.join(ROOT, "web", "map.json"), customPath = path.join(ROOT, "hub", "map.custom.json");
  const mj = JSON.parse(fs.readFileSync(mapPath, "utf8")), cj = JSON.parse(fs.readFileSync(customPath, "utf8"));
  const all = mj.furniture.concat(cj.furniture);
  moves.forEach(([id, ox, oy, nx, ny]) => {
    const f = all.find(v => v.id === id && Math.abs(v.x - ox) < 0.06 && Math.abs(v.y - oy) < 0.06) || all.find(v => v.id === id);
    if (f) { f.x = nx; f.y = ny; }
  });
  anchorMoves.forEach(([k, , to]) => { if (mj.zones && mj.zones[k]) mj.zones[k].anchor = to; });
  fs.writeFileSync(mapPath, JSON.stringify(mj, null, 1));
  fs.writeFileSync(customPath, JSON.stringify(cj, null, 1));
  const rebuild = () => { try { execFileSync(process.execPath, [path.join(ROOT, "tools", "build.mjs")], { encoding: "utf8" }); execFileSync(process.execPath, [path.join(ROOT, "tools", "bust.mjs")], { encoding: "utf8" }); } catch {} };
  rebuild();
  const run = t => { try { return execFileSync(process.execPath, [path.join(ROOT, "tools", t)], { encoding: "utf8" }); } catch (e) { return String(e.stdout || ""); } };
  const ok = /0 个错误/.test(run("check.mjs"));
  console.log("门禁：" + (ok ? "31/31 ✓" : "✗ 未过 → 回滚"));
  if (!ok) { try { execFileSync("git", ["checkout", "--", "web/map.json", "hub/map.custom.json"], { cwd: ROOT }); } catch {} rebuild(); }
}
