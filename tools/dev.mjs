#!/usr/bin/env node
/**
 * 本地一键运行小镇界面：静态页(4322) + 状态 hub(4321)。
 * 用法：node tools/dev.mjs  [--web=4322] [--hub=4321]   （或在 office/ 下 npm run dev）
 * 打开：http://127.0.0.1:4322/?debug=1  （?debug=1 自动展开调试工作台）
 *
 * 说明：本地开发时 office.js 会把 WebSocket 直连 ws://127.0.0.1:<hub>/，
 * 因此不需要 Nginx 的 /office-ws/ 反代；hub 已允许 CORS，调试台可直接推事件。
 *
 * 配套命令（改完 STATE_MAP / map.json / hub/schedule.json 后建议跑一次）：
 *   node tools/check.mjs   静态自检（不开浏览器，失败退出码 1）
 *   node tools/bust.mjs    按文件内容刷新 ?v= 哈希，勿再手改版本号
 * 本静态服务固定 no-store，所以本地不用关心缓存；版本号主要服务于线上 Nginx。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB = path.join(ROOT, "web");
const arg = Object.fromEntries(process.argv.slice(2).map(a => {
  const i = a.indexOf("=");
  return i > 2 ? [a.slice(2, i), a.slice(i + 1)] : [a.slice(2), true];
}));
const WEB_PORT = Number(arg.web || 4322);
const HUB_PORT = Number(arg.hub || 4321);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

// hub 已在跑就不重复启动（例如先手动起过，或 pm2 管着）
async function hubAlive() {
  try {
    const r = await fetch(`http://127.0.0.1:${HUB_PORT}/health`, { signal: AbortSignal.timeout(700) });
    return r.ok;
  } catch { return false; }
}

let child = null;
if (!(await hubAlive())) {
  child = spawn(process.execPath, [path.join(ROOT, "hub", "hub.mjs")], {
    cwd: path.join(ROOT, "hub"),
    env: { ...process.env, OFFICE_PORT: String(HUB_PORT) },
    stdio: "inherit"
  });
  child.on("exit", code => console.log(`[dev] hub 退出 (${code})`));
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || "/").split("?")[0]);
  if (rel === "/") rel = "/index.html";
  const file = path.join(WEB, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!file.startsWith(WEB)) { res.writeHead(403).end("forbidden"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 " + rel); return; }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"     // 本地改完刷新即生效，不跟缓存较劲
    });
    res.end(buf);
  });
});
server.listen(WEB_PORT, "127.0.0.1", () => {
  console.log(`\n[dev] 办公室界面: http://127.0.0.1:${WEB_PORT}/`);
  console.log(`[dev] 调试工作台: http://127.0.0.1:${WEB_PORT}/?debug=1  （或页面右下角 🛠 / 按 D）`);
  console.log(`[dev] 状态 hub:    http://127.0.0.1:${HUB_PORT}/api/status`);
  console.log(`[dev] 静态目录:    ${WEB}\n`);
});

function stop() {
  server.close();
  if (child && !child.killed) child.kill();
  process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
