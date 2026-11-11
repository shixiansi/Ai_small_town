#!/usr/bin/env node
/**
 * 静态资源版本号自动化（v39：源码拆到 web/src/，web/office.js 是 build.mjs 的产物）
 *
 *   node office/tools/bust.mjs          刷新 src 里的 ?v= / ASSET_V / TILE_V → 重拼 office.js → 刷新 index.html / editor.html
 *   node office/tools/bust.mjs --check  只比对，不写；版本过期退出码 1（供 check.mjs / 上线门禁用）
 *
 * 单向顺序：先算不依赖 office.js 的（map.json / manifest / PNG / tiles）
 *          → 改写 src 里的版本号 → 拼出 office.js → 再算 office.js 的 hash → 改写两个 html。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { build, buildRaw, ORDER, HEAD } from "./build.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const SRC = path.join(WEB, "src");
const ASSETS = path.join(WEB, "assets");
const TILES = path.join(ASSETS, "tiles");

const sha = buf => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 8);
const fileHash = f => sha(fs.readFileSync(f));
const readText = f => fs.readFileSync(f, "utf8");

function dirHash(dir, ext) {
  const c = crypto.createHash("sha256");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort() : [];
  for (const f of files) { c.update(f); c.update(fs.readFileSync(path.join(dir, f))); }
  return { v: c.digest("hex").slice(0, 8), count: files.length };
}

/** 带版本号的 src 片段（只有 head/core 里存版本号） */
const VERSION_SRC = new Set(["head.js", "boot.js"]);

function rewriteSrc(src, v) {
  return src
    .replace(/("assets\/manifest\.json\?v=)[A-Za-z0-9]*(")/g, "$1" + v.manifest + "$2")
    .replace(/("map\.json\?v=)[A-Za-z0-9]*(")/g, "$1" + v.map + "$2")
    .replace(/(var ASSET_V = ")[A-Za-z0-9]*(")/g, "$1" + v.assets + "$2")
    .replace(/(var TILE_V = ")[A-Za-z0-9]*(")/g, "$1" + v.tiles + "$2");
}
function rewriteIndex(src, v) {
  return src
    .replace(/(office\.js\?v=)[A-Za-z0-9]*/g, "$1" + v.office)
    .replace(/(debug\.js\?v=)[A-Za-z0-9]*/g, "$1" + v.debug);
}
function rewriteEditor(src, v) {
  return src
    .replace(/(office\.js\?v=)[A-Za-z0-9]*/g, "$1" + v.office)
    .replace(/(editor\.js\?v=)[A-Za-z0-9]*/g, "$1" + v.editor);
}

/** 当前应有的全部版本号（office 的 hash 按"改写后的假想产物"算） */
export function versions() {
  const a = dirHash(ASSETS, ".png");
  const t = dirHash(TILES, ".png");
  const inner = {
    map: fileHash(path.join(WEB, "map.json")),
    manifest: fileHash(path.join(ASSETS, "manifest.json")),
    assets: a.v, assetsCount: a.count,
    tiles: t.v, tilesCount: t.count
  };
  const hypothetical = build(f => {
    const p = path.join(SRC, f);
    const text = readText(p);
    return VERSION_SRC.has(f) ? rewriteSrc(text, inner) : text;
  });
  return {
    ...inner,
    office: sha(Buffer.from(hypothetical, "utf8")),
    debug: fileHash(path.join(WEB, "debug.js")),
    editor: fileHash(path.join(WEB, "editor.js"))
  };
}

/** 每个待改写文件的实际内容与期望内容（不落盘） */
export function dryRun() {
  const v = versions();
  const rows = ORDER.filter(f => VERSION_SRC.has(f)).map(f => {
    const actual = readText(path.join(SRC, f));
    return { file: `web/src/${f}`, actual, expected: rewriteSrc(actual, v) };
  });
  for (const [f, fn] of [["index.html", rewriteIndex], ["editor.html", rewriteEditor]]) {
    const actual = readText(path.join(WEB, f));
    rows.push({ file: `web/${f}`, actual, expected: fn(actual, v) });
  }
  return rows;
}

function main() {
  const v = versions();
  const rows = dryRun();
  if (process.argv.includes("--check")) {
    rows.forEach(r => console.log(`${r.actual === r.expected ? "OK   " : "STALE"} ${r.file}`));
    const stale = rows.filter(r => r.actual !== r.expected);
    if (stale.length) { console.error(`版本号过期 ${stale.length} 处，先跑：node office/tools/bust.mjs`); process.exit(1); }
    return;
  }
  let n = 0;
  rows.forEach(r => {
    if (r.actual === r.expected) return;
    fs.writeFileSync(path.join(ROOT, r.file), r.expected);
    console.log(`updated ${r.file}`);
    n++;
  });
  const built = build();
  const cur = fs.existsSync(path.join(WEB, "office.js")) ? readText(path.join(WEB, "office.js")) : "";
  if (cur !== built) {
    fs.writeFileSync(path.join(WEB, "office.js"), built);
    console.log("rebuilt web/office.js");
  }
  console.log(n ? `已更新 ${n} 个文件` : "版本号已是最新");
  console.log(`  office.js=${v.office} debug.js=${v.debug} editor.js=${v.editor} map.json=${v.map}`);
  console.log(`  manifest.json=${v.manifest} assets(${v.assetsCount} 张)=${v.assets} tiles(${v.tilesCount} 张)=${v.tiles}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();


