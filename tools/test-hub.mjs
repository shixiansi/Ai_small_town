#!/usr/bin/env node
/**
 * 测试专用 hub（v47）：永远不会碰你的真实存档 office/hub/map.custom.json
 *
 *   node office/tools/test-hub.mjs            # 起在 4321，但数据文件指向临时目录
 *   PORT=4399 node office/tools/test-hub.mjs  # 自定义端口
 *
 * 原理：hub.mjs 早就支持 OFFICE_MAP_FILE 环境变量；这里把它指向 os.tmpdir() 下的一份副本，
 * 备份也落在同目录，做完测试随手删掉即可。任何自动化/Chat 里的验证都该用这个入口。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HUB = path.join(HERE, "..", "hub", "hub.mjs");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "office-hub-test-"));
const mapFile = path.join(dir, "map.custom.json");
fs.writeFileSync(mapFile, JSON.stringify({ furniture: [], updatedAt: 0 }));

console.log(`[test-hub] 数据文件：${mapFile}`);
console.log(`[test-hub] 真实存档：${path.join(HERE, "..", "hub", "map.custom.json")}（本次不会读写它）`);

const child = spawn(process.execPath, [HUB], {
  stdio: "inherit",
  env: { ...process.env, OFFICE_MAP_FILE: mapFile, OFFICE_PORT: String(Number(process.env.PORT) || 4399) }
});
const bye = () => { try { child.kill(); } catch {} };
process.on("SIGINT", () => { bye(); process.exit(0); });
process.on("SIGTERM", () => { bye(); process.exit(0); });
child.on("exit", code => process.exit(code ?? 0));
