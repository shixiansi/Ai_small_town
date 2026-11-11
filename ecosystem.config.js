// AI 小镇（office/）自己的 pm2 配置 —— 不再挂在 news-site 的 ecosystem.config.js 里
//
// 启动：pm2 start ecosystem.config.js && pm2 save
// 说明：
//   - 路径全部按本文件所在目录推导（__dirname），整目录搬到哪台机器都能直接起
//   - 端口/宿主/落盘文件都走 OFFICE_* 环境变量（默认值见 hub/hub.mjs），这里只是显式写出来
//   - 静态页面不由 pm2 管：由 sync_web.sh 同步到站点目录，Nginx 静态服务 + /office-ws/ 反代
const path = require("node:path")

const ROOT = __dirname
const NODE_BIN = process.env.OFFICE_NODE_BIN || "node"
const PORT = process.env.OFFICE_PORT || "4321"
const HOST = process.env.OFFICE_HOST || "127.0.0.1"

module.exports = {
  apps: [
    {
      // 小镇状态中转：HTTP 事件进来 → WebSocket 广播给浏览器（详见 README）
      name: "office-hub",
      script: path.join(ROOT, "hub", "hub.mjs"),
      cwd: path.join(ROOT, "hub"),
      interpreter: NODE_BIN,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "150M",
      env: {
        TZ: process.env.TZ || "Asia/Shanghai",
        OFFICE_PORT: PORT,
        OFFICE_HOST: HOST
      },
      out_file: path.join(ROOT, "logs", "office-hub-out.log"),
      error_file: path.join(ROOT, "logs", "office-hub-err.log"),
      time: true
    }
  ]
}
