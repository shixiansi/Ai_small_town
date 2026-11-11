#!/usr/bin/env bash
# 把 AI 小镇前端同步到站点目录（该目录由 Nginx 静态服务，并把 /office-ws/ 反代到 hub）
#
# 目录约定（都可覆盖，脚本不假设本项目放在哪里）：
#   SRC   = 本脚本所在目录下的 web/
#   DST   = ${OFFICE_DEPLOY_DIR:-/www/wwwroot/ai-town}
#   OWNER = ${OFFICE_DEPLOY_OWNER:-www:www}   （仅 root 时生效）
#
# 用法：
#   bash sync_web.sh
#   OFFICE_DEPLOY_DIR=/srv/www/town bash sync_web.sh
#   OFFICE_AUTO_PUSH=1 bash sync_web.sh      # 同步完顺手推 git 远程（需先 git remote add origin）
#
# 边界：本脚本只同步「前端静态文件」。
# hub（hub/hub.mjs、hub/states.json、hub/random_events.json）属于后端服务：
# 改了它要单独部署并 `pm2 restart office-hub`（见 ecosystem.config.js）。
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$SELF_DIR/web"
TOOLS="$SELF_DIR/tools"
DST="${OFFICE_DEPLOY_DIR:-/www/wwwroot/ai-town}"
OWNER="${OFFICE_DEPLOY_OWNER:-www:www}"

if [ ! -d "$SRC" ]; then
  echo "找不到前端目录：$SRC" >&2
  exit 1
fi

# 上线门禁：按文件内容刷新 ?v= 哈希，再跑静态自检（任一失败即中止同步）
if [ -f "$TOOLS/bust.mjs" ] && [ -f "$TOOLS/check.mjs" ]; then
  echo "== 刷新资源版本号 =="
  node "$TOOLS/bust.mjs" || exit 1
  echo "== 静态自检 =="
  node "$TOOLS/check.mjs" || { echo "自检未通过，已中止同步"; exit 1; }
else
  echo "warn: 未找到 tools/{bust,check}.mjs，跳过版本号与自检"
fi

mkdir -p "$DST/assets" "$DST/assets/tiles"
cp -f "$SRC/index.html" "$DST/"
cp -f "$SRC/office.js" "$DST/"
cp -f "$SRC/map.json" "$DST/"
# 调试台：线上默认隐藏入口，但 ?debug=1 仍要能用
cp -f "$SRC/debug.js" "$DST/"
# 独立地图编辑器：editor.html + editor.js
cp -f "$SRC/editor.html" "$DST/"
cp -f "$SRC/editor.js" "$DST/"
cp -f "$SRC"/assets/*.png "$SRC"/assets/*.json "$SRC"/assets/phaser.min.js "$DST/assets/"
cp -f "$SRC"/assets/tiles/*.png "$DST/assets/tiles/"

# 只有 root 才 chown（普通用户本地跑不该报错）
if [ "$(id -u)" = "0" ] && id "$(echo "$OWNER" | cut -d: -f1)" >/dev/null 2>&1; then
  chown -R "$OWNER" "$DST"
fi
# 目录必须有 x 才能进入；文件 644
find "$DST" -type d -exec chmod 755 {} +
find "$DST" -type f -exec chmod 644 {} +
echo "synced: $(find "$DST" -type f | wc -l) files -> $DST"

# ---- 自动 git 快照（本项目自己的仓库）----
if command -v git >/dev/null 2>&1 && [ -d "$SELF_DIR/.git" ]; then
  cd "$SELF_DIR"
  if [ -n "$(git status --porcelain 2>/dev/null | head -1)" ]; then
    git add -A
    git commit -m "v$(date +%Y%m%d-%H%M) 上线快照：office.js=$(git hash-object web/office.js 2>/dev/null | cut -c1-8) map=$(git hash-object web/map.json 2>/dev/null | cut -c1-8)" >/dev/null 2>&1 \
      && echo "git: 已提交快照 $(git rev-parse --short HEAD)" \
      || echo "git: 提交失败（跳过）"
  else
    echo "git: 工作区干净，跳过"
  fi
  # 推远程是可选项：只有显式 OFFICE_AUTO_PUSH=1 且配了 origin 才推
  if [ "${OFFICE_AUTO_PUSH:-0}" = "1" ]; then
    if git remote get-url origin >/dev/null 2>&1; then
      git push -q origin HEAD || echo "warn: git push 失败（不影响本次同步）"
    else
      echo "warn: 没配 git remote origin，跳过推送"
    fi
  fi
fi
