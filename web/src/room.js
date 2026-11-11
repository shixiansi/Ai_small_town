  // ---------- 房间底图（v39：全部用 assets/tiles 贴图，不再用 Graphics 一块块画） ----------
  /* 材质分布：先按区域铺地板，再叠道路/池塘/农田/隔墙，最后画顶部墙带（墙 + 窗 + 天空）。
   * 全部贴进一张 RenderTexture（一次性），之后每帧只是一张图，draw call 反而比原来更省。
   * 图源：office/tools/gen_tiles.mjs 生成的 web/assets/tiles/*.png（48×48）。 */
  var roadsVisible = true;
  var TILE_MATS = ["wood", "tile", "stone", "grass", "road", "wall", "window", "window-night", "sky", "water", "bank", "farm"];

  function tileTex(mat) { return "tile-" + mat; }

  /* 基础地板材质（按格子）—— 与旧 buildRoom 的矩形分区一一对应 */
  function baseMaterialAt(tx, ty) {
    if (tx <= 26) {                                         // 西北大屋：办公室/卧室/卫浴/厨房
      if (ty < 15 && tx >= 10 && tx <= 15) return "tile";   // 卫浴瓷砖
      if (ty < 15 && tx >= 17 && tx <= 24) return "tile";   // 厨房地砖
      return "wood";
    }
    if (tx <= 38) return "grass";                            // 花园草地
    if (ty >= 19) {                                          // 三户邻居室内
      if (tx >= 40 && tx <= 45) return "wood";
      if (tx >= 46 && tx <= 50) return "tile";
      if (tx >= 51) return "stone";
    }
    return "stone";                                          // 小镇石板街
  }

  /* 道路（v43：数据驱动）——map.json 的 roads 里每条矩形铺一种路面；没有 roads 字段的老地图走兜底。
   * 可整体关掉：调试台「道路层」/ toggleRoads。 */
  function paintRoads(s, rt) {
    if (!roadsVisible) return;
    var roads = (s.mapdata && s.mapdata.roads) || [];
    if (roads.length) {
      roads.forEach(function (rr) {
        for (var ty = rr.y; ty < rr.y + rr.h; ty++) {
          for (var tx = rr.x; tx < rr.x + rr.w; tx++) {
            if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
            rt.batchDraw(tileTex("road"), tx * TILE, WALL_H + ty * TILE);
          }
        }
      });
      return;
    }
    // 兜底（老地图）：街心主路 + 从 y19 门洞往北接主路
    for (var ty2 = 8; ty2 <= 9; ty2++) {
      for (var tx2 = 39; tx2 < COLS; tx2++) rt.batchDraw(tileTex("road"), tx2 * TILE, WALL_H + ty2 * TILE);
    }
    (s.mapdata.walls || []).forEach(function (wl) {
      if (wl.x0 === undefined || wl.y !== 19 || !wl.gap) return;
      for (var gx = wl.gap[0]; gx <= wl.gap[1]; gx++)
        for (var gy = 10; gy <= 19; gy++) rt.batchDraw(tileTex("road"), gx * TILE, WALL_H + gy * TILE);
    });
  }

  /* 池塘（v38.1 起可整层隐藏）：水面 + 沙岸 + 木栈道 */
  function paintPond(rt) {
    var cx = (POND.x0 + POND.x1) / 2, cy = (POND.y0 + POND.y1) / 2;
    var rx = (POND.x1 - POND.x0) / 2 + 0.12, ry = (POND.y1 - POND.y0) / 2 + 0.12;
    for (var ty = 0; ty < ROWS; ty++) {
      for (var tx = 0; tx < COLS; tx++) {
        // v39.2：用户手动铺过的格子以用户为准 —— 水面刷子加水、草地/地板刷子填掉多余的水，就能改形状
        if (floorEdits[tx + "," + ty] || terrainEdits[tx + "," + ty]) continue;
        var nx = (tx + 0.5 - cx) / rx, ny = (ty + 0.5 - cy) / ry;
        var d = nx * nx + ny * ny;
        if (d <= 1) rt.batchDraw(tileTex("water"), tx * TILE, WALL_H + ty * TILE);
        else if (d <= 1.12) rt.batchDraw(tileTex("bank"), tx * TILE, WALL_H + ty * TILE);   // v43：沙岸收窄成一圈
      }
    }
    var dockX = Math.floor(POND.x0 * TILE - 26), dockY = Math.floor(WALL_H + cy * TILE - 24);
    rt.batchDraw(tileTex("road"), dockX, dockY);
    rt.batchDraw(tileTex("road"), dockX + TILE, dockY);
  }

  /* 农田：花园里的耕地格 */
  function paintFarm(rt) {
    for (var i = 0; i < FARM.cols * FARM.rows; i++) {
      var t = plotTile(i);
      rt.batchDraw(tileTex("farm"), t.x * TILE, WALL_H + t.y * TILE);
    }
  }

  /* 隔墙（mapdata.walls）：一格一块墙贴图，门洞（gap）跳过 */
  function paintWalls(s, rt) {
    (s.mapdata.walls || []).forEach(function (wl) {
      var isH = wl.x0 !== undefined;
      var gapLo = wl.gap ? wl.gap[0] : -1e9, gapHi = wl.gap ? wl.gap[1] : -1e9;
      if (isH) {
        for (var x = wl.x0; x <= wl.x1; x++) {
          if (x >= gapLo && x <= gapHi) continue;
          rt.batchDraw(tileTex("wall"), x * TILE, WALL_H + wl.y * TILE);
        }
      } else {
        for (var y = wl.y; y < wl.y + wl.h; y++) {
          if (y >= gapLo && y <= gapHi) continue;
          rt.batchDraw(tileTex("wall"), wl.x * TILE, WALL_H + y * TILE);
        }
      }
    });
  }

  /* 顶部墙带（0–48px）：室内段是墙，花园往东是天空；只留大门门洞。
   * v39.5：原来代码里画死的三扇窗（办公室大窗/卧室窗/卫浴高窗）已删除 ——
   * 窗现在是物品层里可摆放的 "window"，想在哪扇自己放。 */
  function paintTopBand(s, rt) {
    var door = s.mapdata.door;
    var indoorRight = 26.5;                                  // 室内北墙到 x=26.5，往东露天
    for (var tx = 0; tx < COLS; tx++) {
      var mat = tx < indoorRight ? "wall" : "sky";
      rt.batchDraw(tileTex(mat), tx * TILE, 0);
    }
    // 大门门洞：墙带断开铺路
    for (var dx = 0; dx < door.tw; dx++) rt.batchDraw(tileTex("road"), (door.tx + dx) * TILE, 0);
  }

  function buildRoom(s) {
    if (s.baseGfx) { try { s.baseGfx.destroy(); } catch (e) {} }   // rebuildRoomBase 旧层先拆
    var rt = s.add.renderTexture(0, 0, W, H).setOrigin(0, 0).setDepth(-100);
    rt._isBaseGfx = true;    // 兼容 rebuildRoomBase 的可见性自愈
    s.baseGfx = rt;
    rt.beginDraw();
    for (var ty = 0; ty < ROWS; ty++) {
      for (var tx = 0; tx < COLS; tx++) {
        rt.batchDraw(tileTex(baseMaterialAt(tx, ty)), tx * TILE, WALL_H + ty * TILE);
      }
    }
    paintRoads(s, rt);
    paintPond(rt);
    paintFarm(rt);
    paintWalls(s, rt);
    paintTopBand(s, rt);
    rt.endDraw();
  }

  function toggleRoads(force) {
    if (!scene || !scene.mapdata) return roadsVisible;
    if (force === true && roadsVisible) return true;          // 已开
    if (force === false && !roadsVisible) return false;       // 已关
    roadsVisible = !roadsVisible;
    rebuildRoomBase();   // 整层贴图重画（一次性，代价很小）
    return roadsVisible;
  }

  /* 重画整层底图（道路层开关 / 隐藏窗、池塘后调用） */
  function rebuildRoomBase() {
    if (!scene || !scene.mapdata) return;
    buildRoom(scene);
    if (scene.baseGfx) scene.baseGfx.setVisible(true);
  }
