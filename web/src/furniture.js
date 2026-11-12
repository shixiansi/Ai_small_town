  // ---------- 家具 ----------
  /* 家具层（静态 map.json + hub 自定义层）只由这两个函数创建/销毁：
   *   buildFurniture()      首次进场景
   *   rebuildCustomLayer()  编辑后刷新自定义层（v37 修复）
   * 旧版重建时只把 s.props 过滤成「只剩鱼」，上一层的精灵和阴影对象还留在 displayList 里，
   * 于是每重建一次全屋家具就多叠一份（实测：displayList 148 组重复、sprite 313 个而 props 只有 152）。
   * 现在所有 placement 都登记进 s.placed（含阴影），重建前一次性 destroy。 */
  function disposeFurnitureLayer(s) {
    (s.placed || []).forEach(function (p) {
      if (p.spr) { try { p.spr.destroy(); } catch (e) {} }
      if (p.shadow) { try { p.shadow.destroy(); } catch (e) {} }
    });
    s.placed = [];
    customPlaceholders = [];   // 指向被销毁的实例，必须一起清
    s.props = s.props ? s.props.filter(function (p) { return p.isFish; }) : [];   // 深度排序列表（含鱼）
    s.fxDirect = {};           // 工作特效：{ pc, printer, chair }
    s.hostMap = {};            // id → placement（供 on: 引用）
  }
  /* ---------- 灯的开关（v50）---------- */
  var SWITCH_ROOMS = { office: 1, bedroom: 1, bath: 1, kitchen: 1, nbCat: 1, nbChief: 1, nbDoc: 1 };
  var SWITCH_ROOM_RECTS = {
    office:  [0, 15, 26, 15],
    bedroom: [1, 1, 9, 13],
    bath:    [10, 1, 6, 13],
    kitchen: [16, 1, 9, 13],
    nbCat:   [39, 1, 8, 13],    // v83：喵酱家（右上左新房）
    nbChief: [48, 1, 7, 13],    // v83：村长家（右上右新房）
    nbDoc:   [51, 20, 4, 9]     // v83：博士家（右下）
  };
  /* 一个开关控制哪个房间：优先用条目里的 room，否则按它所在位置取最近的房间 */
  function roomOfProp(p) {
    var want = p.f && p.f.room;
    if (want === "none") return null;
    if (want && SWITCH_ROOMS[want]) return want;
    var tx = (p.x - TILE / 2) / TILE, ty = (p.y - WALL_H - TILE / 2) / TILE;
    var best = null, bestD = 1e9;
    Object.keys(SWITCH_ROOM_RECTS).forEach(function (k) {
      var r = SWITCH_ROOM_RECTS[k];
      var dx = Math.max(r[0] - tx, 0, tx - (r[0] + r[2]));
      var dy = Math.max(r[1] - ty, 0, ty - (r[1] + r[3]));
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = k; }
    });
    return best;
  }
  /* v52: 会变化的素材 —— 按 manifest.states 声明的分类 */
  var LIGHT_STATE_ASSETS = { switch: 1, "wall-lamp": 1 };   // 随房间灯亮灭
  var NIGHT_STATE_ASSETS = { window: 1 };                    // 随昼夜（窗内天色）
  function applyPropStates(s) {
    if (!s || !s.placed) return;
    s.placed.forEach(function (p) {
      var a = p.f && p.f.a;
      var man = MAN[a];
      if (!a || !man || !man.states || !p.spr || !p.spr.setTexture) return;
      var key = null;
      if (LIGHT_STATE_ASSETS[a]) {
        var room = roomOfProp(p);
        var on = room ? (roomLights[room] !== false) : (lightsOn === true);
        key = on ? man.states.on : (man.states.off || a);
        p.room = room; p.switchOn = on;
      } else if (NIGHT_STATE_ASSETS[a]) {
        key = isNightHour() ? man.states.night : (man.states.day || a);
      }
      if (key && s.textures.exists(key) && p.spr.texture && p.spr.texture.key !== key) p.spr.setTexture(key);
    });
  }
  /* 开关外观跟着灯状态走 */
  function syncSwitchVisuals(s) { applyPropStates(s); }   // v52: 统一入口

  /* v55：点中开关时闪一下，避免"看不出变化"（编辑器里画布气泡是被屏蔽的） */
  function flashAt(s, x, y, color) {
    try {
      var ring = s.add.circle(x, y - 14, 16, 0xfff3c4, 0.55).setDepth(97000);
      var ring2 = s.add.circle(x, y - 14, 6, 0xffffff, 0.8).setDepth(97001);
      s.tweens.add({ targets: ring, scale: 2.2, alpha: 0, duration: 480, onComplete: function () { ring.destroy(); } });
      s.tweens.add({ targets: ring2, scale: 1.6, alpha: 0, duration: 380, onComplete: function () { ring2.destroy(); } });
    } catch (e) {}
  }
  /* 点开关 = 切换它那个房间的灯 */
  function toggleSwitchAt(worldX, worldY) {
    var s = scene;
    if (!s || !s.placed) return false;
    var hit = null;
    s.placed.forEach(function (p) {
      if (!p.f || (p.f.a !== "switch" && p.f.a !== "wall-lamp") || !p.spr) return;
      var bb = p.bbox || [0, 0, 24, 24];
      var halfW = (bb[2] || 24) / 2 + 8, top = p.y - (bb[3] || 24) - 8, bottom = p.y + 8;
      if (worldX > p.x - halfW && worldX < p.x + halfW && worldY > top && worldY < bottom) hit = p;
    });
    if (!hit) return false;
    var room = hit.room || roomOfProp(hit);
    if (!room) { showBubble("这个开关没连到房间（编辑器里给它选一个）", "error"); return true; }
    roomLights[room] = roomLights[room] === false ? true : false;
    lightsOn = ["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"].some(function (k) { return roomLights[k] !== false; });
    applyRoomLights(s);
    syncSwitchVisuals(s);
    flashAt(s, hit.spr.x, hit.spr.y, roomLights[room] ? 0xfff3c4 : 0x6b7385);
    showBubble((roomLights[room] ? "💡 开灯：" : "⚫ 关灯：") + ({ office: "办公室", bedroom: "起居", bath: "卫浴", kitchen: "厨房", nbCat: "喵酱家", nbChief: "村长家", nbDoc: "博士家" }[room] || room), "idle");
    return true;
  }

  function buildFurnitureLayer(s) {
    disposeFurnitureLayer(s);
    // 第一遍：落地家具（有 id 的先注册）
    s.mapdata.furniture.forEach(function (f) {
      if (!f.on) {
        var p = makePlacement(f, null);
        if (!p) return;   // 资产名不在 manifest 里：跳过而不是炸整层
        p.f = f;
        s.hostMap[f.id] = p;
      }
    });
    // 第二遍：全部创建（on: 引用此时可用）
    s.mapdata.furniture.forEach(function (f) {
      var p = makePlacement(f, s.hostMap);
      if (!p) return;
      p.f = f;
      var m = p.m;
      // 可动物件（有动画数据）用 sprite 以便按需 play；其余用 image
      // "frame": N 可指定初始帧（如椅子用 North 行首帧 24 = 面朝北/靠背朝南）
      var f0 = f.frame || 0;
      var spr;
      if (m.anim && m.rows && m.rows.East > 1) {
        spr = s.add.sprite(p.x, p.y, f.a, f0).setOrigin(p.originX, p.originY).setDepth(p.depth);
      } else {
        spr = s.add.image(p.x, p.y, f.a, f0).setOrigin(p.originX, p.originY).setDepth(p.depth);
      }
      if (p.scale !== 1) spr.setScale(p.scale);   // 大小关系：按格子归一化
      // 接触阴影（评审 #3）：落地物件底部椭圆软影，宽=内容宽×1.1、深棕 25%
      // 注意：阴影也要登记到 p.shadow，否则重建时销毁不掉（v37 家具重影的第二个来源）
      if (!p.wall && !p.o && !f.on) {
        var shW = p.bbox[2] * (p.scale || 1) * 1.1;
        p.shadow = s.add.ellipse(p.x, p.y + 1, shW, 8, 0x3a2a1a, 0.25).setDepth(p.depth - 1);
      }
      p.spr = spr;
      s.props.push(p);
      s.placed.push(p);
      if (f.id) s.hostMap[f.id] = p;   // 叠加物也可能被别人叠（如书架上的书）
      if (f._custom) customPlaceholders.push(p);

      if (f.a === "computer") s.fxDirect.pc = { spr: spr, m: m, f: f };
      if (f.a === "printer") s.fxDirect.printer = { spr: spr, m: m, f: f };
      if (f.a === "office-chair") s.fxDirect.chair = { spr: spr, m: m, f: f };
    });

    syncSwitchVisuals(s);   // v50：建完家具层同步开关外观（必须在 return 之前）
    buildBlockedGrid(s);
    return s;
  }
  function buildFurniture(s) {
    s.props = [];
    s.placed = [];
    applyCustomFurniture(s);   // 自定义层必须先并进 mapdata：放在两遍创建之后会漏掉它们的精灵
    buildFurnitureLayer(s);
  }

  // ---------- 碰撞：bbox 底部投影 → 格子 ----------
  function buildBlockedGrid(s) {
    var grid = [];
    for (var y = 0; y < ROWS; y++) grid.push(new Array(COLS).fill(0));
    for (var x0 = 0; x0 < COLS; x0++) grid[0][x0] = 1;   // 贴墙根不可走

    // 房间隔墙：竖墙 {x,y,h,gap[行]}；横墙 {y,x0,x1,gap[列]}——v24 回字形平面布局
    // 判据必须用 x0（横墙专有字段）：竖墙对象自带 y，用 y 判会把竖墙送进横墙分支（第三轮评审 P0-1）
    (s.mapdata.walls || []).forEach(function (wl) {
      var isH = wl.x0 !== undefined;   // 横墙带 x0/x1；竖墙带 x/y/h
      if (!isH) {   // 竖墙 {x, y, h, gap}
        for (var wy = wl.y; wy < wl.y + wl.h; wy++) {
          if (wl.gap && wy >= wl.gap[0] && wy <= wl.gap[1]) continue;
          if (grid[wy]) grid[wy][wl.x] = 1;
        }
      } else {      // 横墙 {y, x0, x1, gap}
        for (var wx = wl.x0; wx <= wl.x1; wx++) {
          if (wl.gap && wx >= wl.gap[0] && wx <= wl.gap[1]) continue;
          if (grid[wl.y]) grid[wl.y][wx] = 1;
        }
      }
    });

    var propBlocked = {};   // 家具压住的格子：地板贴片不能把这些格放行
    s.props.forEach(function (p) {
      if (p.isFish || p.wall || p.o || p.f?.on) return;   // 鱼/墙饰/叠加物不产生碰撞（v37：rebuildCustomLayer 保留鱼重跑本函数时，鱼对象没有 bbox）
      var m = p.m, bbox = p.bbox;
      var footH = Math.min(12, bbox[3]);
      var left = p.x - m.frameW / 2 + bbox[0];
      var right = left + bbox[2];
      var top = p.y - footH;
      for (var gy = Math.floor((top - WALL_H) / TILE); gy <= Math.floor((p.y - WALL_H - 1) / TILE); gy++) {
        for (var gx = Math.floor(left / TILE); gx <= Math.floor((right - 1) / TILE); gx++) {
          if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) { grid[gy][gx] = 1; propBlocked[gy + "," + gx] = 1; }
        }
      }
    });

    // 阻挡区块（v37）：水面等椭圆区域不可走，A* 天然绕开；岸边保持可走（钓鱼 zone 在塘西）
    (s.mapdata.blockers || []).forEach(function (b) {
      if (b.t !== "pond") return;
      var bx0 = Math.max(0, Math.floor(b.x0)), bx1 = Math.min(COLS - 1, Math.ceil(b.x1) - 1);
      var by0 = Math.max(0, Math.floor(b.y0)), by1 = Math.min(ROWS - 1, Math.ceil(b.y1) - 1);
      var ex = (b.x0 + b.x1) / 2, ey = (b.y0 + b.y1) / 2;
      var rx = (b.x1 - b.x0) / 2 + 0.12, ry = (b.y1 - b.y0) / 2 + 0.12;
      for (var py = by0; py <= by1; py++) {
        if (!grid[py]) continue;
        for (var px = bx0; px <= bx1; px++) {
          var cx = px + 0.5, cy = py + 0.5;
          if (Math.pow((cx - ex) / rx, 2) + Math.pow((cy - ey) / ry, 2) <= 1) grid[py][px] = 1;
        }
      }
    });
    // 编辑层（v38）：地形墙/水阻挡；地板贴片把该格改成可走（家具压着的格除外，第 0 行贴墙根也保留）
    // v83.1：先收集地形墙/水格——地板放行必须跳过它们（用户先铺地板后画墙时，floor 条目
    // 与 wall 同格共存，原逻辑会让地板把墙格重新放行 = 墙没有碰撞、鱼穿墙）。
    var solidTerrain = {};
    Object.keys(terrainEdits).forEach(function (k) {
      var e = terrainEdits[k];
      if (e.t !== "wall" && e.t !== "water") return;
      solidTerrain[e.y + "," + e.x] = 1;
    });
    Object.keys(floorEdits).forEach(function (k) {
      var e = floorEdits[k];
      if (!grid[e.y] || grid[e.y][e.x] === undefined) return;
      if (e.y === 0) return;
      if (propBlocked[e.y + "," + e.x]) return;
      if (solidTerrain[e.y + "," + e.x]) return;   // v83.1：墙/水格不许地板放行
      grid[e.y][e.x] = 0;
    });
    // 地形墙/水最后写入（v83.1）：同格 floor 不再能放行墙格
    Object.keys(solidTerrain).forEach(function (k) {
      var p = k.split(",");
      var gy = Number(p[0]), gx = Number(p[1]);
      if (grid[gy] && grid[gy][gx] !== undefined) grid[gy][gx] = 1;
    });
    s.grid = grid;
    try { window.__dbgGrid = { terr: Object.keys(terrainEdits).length, floor: Object.keys(floorEdits).length, sample48_8: grid[8] ? grid[8][48] : "?", sample46_1: grid[1] ? grid[1][46] : "?", ts: Date.now() }; } catch (e) {}
  }

