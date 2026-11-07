#!/usr/bin/env node
/**
 * 静态资源版本号自动化（替代手写的 ?v=35 / ?v=20 / ?v=3 / ?v=2）。
 *
 *   node office/tools/bust.mjs          按内容 hash 幂等改写 web/office.js + web/index.html
 *   node office/tools/bust.mjs --check  只比对，不写；版本过期退出码 1（供 check.mjs / 上线门禁用）
 *
 * 为什么不是「每个文件 hash 自己」：index.html 里存的是 office.js 的 hash，
 * 而 office.js 里又存着 map.json / manifest.json / 所有 PNG 的 hash。
 * 按「先算不依赖 office.js 的三个 → 虚拟改写 office.js → 再算 office.js 的 hash
 * → 最后改写 index.html」这个单向顺序执行，一次收敛且不产生自引用循环。
 *
 * 本文件被 check.mjs import，顶层不执行任何写操作。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const ASSETS = path.join(WEB, "assets");

const sha = buf => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 8);
const fileHash = f => sha(fs.readFileSync(f));
const readText = f => fs.readFileSync(f, "utf8");

function assetsHash() {
  const c = crypto.createHash("sha256");
  const files = fs.readdirSync(ASSETS).filter(f => f.endsWith(".png")).sort();
  for (const f of files) { c.update(f); c.update(fs.readFileSync(path.join(ASSETS, f))); }
  return { v: c.digest("hex").slice(0, 8), count: files.length };
}

function rewriteOffice(src, v) {
  return src
    .replace(/("assets\/manifest\.json\?v=)[A-Za-z0-9]*(")/g, "$1" + v.manifest + "$2")
    .replace(/("map\.json\?v=)[A-Za-z0-9]*(")/g, "$1" + v.map + "$2")
    .replace(/(var ASSET_V = ")[A-Za-z0-9]*(")/g, "$1" + v.assets + "$2");
}
function rewriteIndex(src, v) {
  return src
    .replace(/(office\.js\?v=)[A-Za-z0-9]*/g, "$1" + v.office)
    .replace(/(debug\.js\?v=)[A-Za-z0-9]*/g, "$1" + v.debug);
}

/** 当前应有的全部版本号（基于「已按 inner 改写后」的 office.js 内容算 hash） */
export function versions() {
  const a = assetsHash();
  const inner = {
    map: fileHash(path.join(WEB, "map.json")),
    manifest: fileHash(path.join(ASSETS, "manifest.json")),
    assets: a.v,
    assetsCount: a.count
  };
  const officeExpected = rewriteOffice(readText(path.join(WEB, "office.js")), inner);
  return {
    ...inner,
    office: sha(Buffer.from(officeExpected, "utf8")),
    debug: fileHash(path.join(WEB, "debug.js"))
  };
}

/** 返回每个待改写文件的实际内容与期望内容（不落盘） */
export function dryRun() {
  const v = versions();
  const officeSrc = readText(path.join(WEB, "office.js"));
  const indexSrc = readText(path.join(WEB, "index.html"));
  return [
    { file: "web/office.js", actual: officeSrc, expected: rewriteOffice(officeSrc, v) },
    { file: "web/index.html", actual: indexSrc, expected: rewriteIndex(indexSrc, v) }
  ];
}

function main() {
  const rows = dryRun();
  const v = versions();
  const stale = rows.filter(r => r.actual !== r.expected);
  if (process.argv.includes("--check")) {
    rows.forEach(r => console.log(`${r.actual === r.expected ? "OK   " : "STALE"} ${r.file}`));
    if (stale.length) {
      console.error(`版本号过期 ${stale.length} 处，先跑：node office/tools/bust.mjs`);
      process.exit(1);
    }
    return;
  }
  stale.forEach(r => {
    fs.writeFileSync(path.join(ROOT, r.file), r.expected);
    console.log(`updated ${r.file}`);
  });
  console.log(stale.length ? `已更新 ${stale.length} 个文件` : "版本号已是最新，无需改动");
  console.log(`  office.js=${v.office} debug.js=${v.debug} map.json=${v.map}`);
  console.log(`  manifest.json=${v.manifest} assets(${v.assetsCount} 张 PNG)=${v.assets}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
