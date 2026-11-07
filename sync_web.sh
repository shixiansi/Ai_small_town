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

# ---- 自动 git 快照（用户要求：每次更新都上传 git）----
GIT_DIR="/root/项目/news-site"
if command -v git >/dev/null 2>&1 && [ -d "$GIT_DIR/.git" ]; then
  cd "$GIT_DIR"
  if ! git diff --quiet HEAD 2>/dev/null || [ -n "$(git status --porcelain 2>/dev/null | head -1)" ]; then
    git add -A
    git commit -m "v$(date +%Y%m%d-%H%M) 上线快照：office.js=$(git hash-object office/web/office.js 2>/dev/null | cut -c1-8) map=$(git hash-object office/web/map.json 2>/dev/null | cut -c1-8)" >/dev/null 2>&1       && echo "git: 已提交快照 $(git rev-parse --short HEAD)"       || echo "git: 无变化，跳过"
  else
    echo "git: 工作区干净，跳过"
  fi
fi
