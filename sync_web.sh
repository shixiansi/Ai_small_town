#!/usr/bin/env bash
# 同步办公室前端到 Nginx 站点目录（/root 下文件 nginx 的 www 用户读不到）
set -e
SRC="/root/项目/news-site/office/web"
DST="/www/wwwroot/news.shixiansi.pw/office"
TOOLS="$(dirname "$SRC")/tools"

# 注意：本脚本只同步前端。hub/hub.mjs 与 hub/states.json 属于后端服务，
# 改动后需单独同步整个 office/hub/ 并 pm2 restart office-hub。

# 上线门禁：按文件内容刷新 ?v= 哈希，再跑静态自检（任一失败即中止同步）。
# 工具目录还没同步到服务器时只警告，保持旧流程可用。
if [ -f "$TOOLS/bust.mjs" ] && [ -f "$TOOLS/check.mjs" ]; then
  echo "== 刷新资源版本号 =="
  node "$TOOLS/bust.mjs" || exit 1
  echo "== 静态自检 =="
  node "$TOOLS/check.mjs" || { echo "自检未通过，已中止同步"; exit 1; }
else
  echo "warn: 未找到 tools/{bust,check}.mjs，跳过版本号与自检；建议把 office/tools/ 一并同步"
fi

mkdir -p "$DST/assets"
cp -f "$SRC/index.html" "$DST/"
cp -f "$SRC/office.js" "$DST/"
cp -f "$SRC/map.json" "$DST/"
# 调试台：线上默认隐藏入口，但 ?debug=1 仍要能用，旧版漏了这行会 404
cp -f "$SRC/debug.js" "$DST/"
cp -f "$SRC"/assets/*.png "$SRC"/assets/*.json "$SRC"/assets/phaser.min.js "$DST/assets/"
chown -R www:www "$DST"
# 目录必须有 x 才能进入；文件 644
find "$DST" -type d -exec chmod 755 {} +
find "$DST" -type f -exec chmod 644 {} +
echo "synced: $(find "$DST" -type f | wc -l) files -> $DST"
