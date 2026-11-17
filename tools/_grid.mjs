import { loadModel } from "./map-model.mjs";
const m = loadModel();
const rk = process.argv[2] || "nbCat";
const r = m.rooms[rk];
const zkey = { nbCat: "living_cat", nbChief: "living_chief", nbDoc: "living_doc" }[rk];
const occ = new Set();
m.items.filter(f => m.solid(f) && m.roomOf(f.x, f.y) === rk).forEach(f => m.cellsOf(f).forEach(k => occ.add(k)));
const a = m.map.zones[zkey] ? m.map.zones[zkey].anchor : null;
const ax = a ? Math.round(a[0]) : -1, ay = a ? Math.round(a[1]) : -1;
console.log("\n" + rk + "  x" + r.x + ".." + (r.x + r.w - 1) + "  y" + r.y + ".." + (r.y + r.h - 1) +
  (a ? "   living 锚点 " + ax + "," + ay : ""));
let hdr = "    ";
for (let x = r.x; x < r.x + r.w; x++) hdr += String(x % 10);
console.log(hdr);
for (let y = r.y; y < r.y + r.h; y++) {
  let line = String(y).padStart(3) + " ";
  for (let x = r.x; x < r.x + r.w; x++) {
    const k = x + "," + y;
    if (m.wallCells.has(k)) line += "#";
    else if (x === ax && y === ay) line += "*";
    else if (occ.has(k)) line += "X";
    else line += ".";
  }
  console.log(line);
}
const edge = [];
for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
  const k = x + "," + y; if (m.wallCells.has(k)) continue;
  if (m.wallCells.has((x + 1) + "," + y) || m.wallCells.has((x - 1) + "," + y) ||
      m.wallCells.has(x + "," + (y + 1)) || m.wallCells.has(x + "," + (y - 1))) edge.push(k);
}
console.log("   靠墙空闲: " + edge.filter(k => !occ.has(k)).join(" "));
