// 导出 zone → 候选 host 提案表（只读，不改地图）：给"手工映射表"提供准确底稿
import fs from "node:fs";
import path from "node:path";
import { loadModel } from "./map-model.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1"), "..");
const model = loadModel();
const { items, solid, roomOf } = model;
const mj = JSON.parse(fs.readFileSync(path.join(ROOT, "web", "map.json"), "utf8"));

const solidItems = items.filter(f => solid(f) && f.id);
const out = {};
const lines = [];
Object.entries(mj.zones || {}).forEach(([k, z]) => {
  if (!Array.isArray(z.anchor)) return;
  const rk = roomOf(z.anchor[0], z.anchor[1]) || "outdoor";
  const cands = solidItems
    .filter(f => roomOf(f.x, f.y) === (rk === "outdoor" ? null : rk))
    .map(f => ({ id: f.id, a: f.a, x: f.x, y: f.y, d: +Math.hypot(f.x - z.anchor[0], f.y - z.anchor[1]).toFixed(1) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  out[k] = { room: rk, anchor: z.anchor, sit: (z.sit && z.sit.host) || null, candidates: cands };
  lines.push(k.padEnd(12) + rk.padEnd(9) + "anchor=" + z.anchor.join(",").padEnd(10) + (z.sit ? "sit=" + z.sit : ""));
  cands.forEach(c => lines.push("      " + String(c.d).padStart(4) + "格  " + String(c.id).padEnd(18) + c.a + " @" + c.x + "," + c.y));
});

const f = path.join(ROOT, "zones.host.proposed.json");
fs.writeFileSync(f, JSON.stringify(out, null, 1));
console.log(lines.join("\n"));
console.log("\n提案已写入 " + f + "（" + Object.keys(out).length + " 个 zone，每个给 4 个候选）");
