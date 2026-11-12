  /* ============ 独立地图编辑器（v38，editor.html?editor=1） ============
   * 三层：地板层（地板/道路贴片）· 物品层（家具：放置/移动/删除/隐藏）· 地形层（墙/水/农田）。
   * 这一层只负责"画布上的语义"；面板 UI 在 web/editor.js，数据持久化复用 saveEditMap（hub /api/map）。 */
  /* 独立地图编辑器：editor.html 自带侧栏（web/editor.js）。判定同时认 ?editor=1 和页面路径，
   * 否则用 /editor.html 直接打开时会漏掉编辑器语义（点了没反应）。 */
  var editorMode = /[?&]editor=1/.test(location.search) || /(^|\/)editor\.html$/i.test(location.pathname);
  var ME = { layer: "object", tool: "paint", asset: null, floor: "wood", terrain: "wall", painting: false, lastCell: "", continuous: false };
  var meFlushTimer = null;
  var meEditing = 0;
  /* v46：撤销/重做 —— 每次写操作前把整个自定义层快照压栈（一层数组，几十条记录的量级，够用） */
  var meUndoStack = [], meRedoStack = [];
  var ME_HISTORY_MAX = 80;
  var meApplyingHistory = false;
  var meSyncLock = false;      // 本笔已压过快照：紧接着的 saveEditMap 别再压第二次
  /* 改数据之前调用：压快照 + 锁住下一次 saveEditMap 的自动压栈 */
  function meBeginMutation() { mePushHistory(); meSyncLock = true; }
  function meSnapshot() { return JSON.parse(JSON.stringify(customFurniture)); }
  function mePushHistory() {
    if (meApplyingHistory) return;
    meUndoStack.push(meSnapshot());
    if (meUndoStack.length > ME_HISTORY_MAX) meUndoStack.shift();
    meRedoStack.length = 0;
  }
  function meApplySnapshot(list) {
    meApplyingHistory = true;
    saveEditMap(false, { action: "set", item: JSON.parse(JSON.stringify(list)) }, function () { meApplyingHistory = false; });
  }
  function meUndo() {
    if (!meUndoStack.length) return { ok: false, why: "没有可撤销的操作" };
    meRedoStack.push(meSnapshot());
    var prev = meUndoStack.pop();
    meApplySnapshot(prev);
    return { ok: true, undo: meUndoStack.length, redo: meRedoStack.length, count: prev.length };
  }
  function meRedo() {
    if (!meRedoStack.length) return { ok: false, why: "没有可重做的操作" };
    meUndoStack.push(meSnapshot());
    var next = meRedoStack.pop();
    meApplySnapshot(next);
    return { ok: true, undo: meUndoStack.length, redo: meRedoStack.length, count: next.length };
  }
  /* 按层清空：floor / terrain / object / light / shadow / all */
  function meClearLayer(kind) {
    meBeginMutation();
    var before = customFurniture.length;
    var keep = customFurniture.filter(function (f) {
      if (!f || !f.a) return false;
      if (kind === "all") return false;
      if (kind === "floor") return !isFloorEntry(f);
      if (kind === "terrain") return !isTerrainEntry(f);
      if (kind === "light") return !isLightEntry(f);
      if (kind === "shadow") return !isShadowEntry(f);
      if (kind === "object") return !(!isHideEntry(f) && !isMoveEntry(f) && !isFloorEntry(f) && !isTerrainEntry(f) && !isLightEntry(f) && !isShadowEntry(f));
      return true;
    });
    if (kind !== "object" && keep.length === before) { meSyncLock = false; return { ok: false, removed: 0 }; }
    customFurniture = keep;
    meQueueSave();
    return { ok: true, removed: before - keep.length, left: keep.length };
  }
  var ME_LIGHTMODE = "light";     // v41：光照层子模式 —— "light"（灯源）/ "shadow"（拉框阴影）
  var ME_DRAW = null;             // 正在拉的框 {x0,y0,x1,y1}
  var ME_DRAG_SHADOW = null;      // 正在拖动的阴影块 {id,dx,dy}
  var ME_SHADOW_SEL = null;       // 选中的阴影块 id      // 1 = 本地正有一笔贴片/灯改动还没落盘：期间忽略 hub 广播
  function meTileAt(wx, wy) {
    return { tx: Math.floor(wx / TILE), ty: Math.floor((wy - WALL_H) / TILE) };
  }
  /* v51：窗 / 开关这类挂墙资产允许落在顶部墙带（ty = -1） */
  function meWallAsset(a) {
    var ex = placeExtraFor(a);
    return !!(ex && ex.wall);
  }
  function meInBounds(c) { return c.tx >= 0 && c.ty >= 0 && c.tx < COLS && c.ty < ROWS; }
  /* 贴片/橡皮只重画叠加层 + 碰撞格，不重建家具（拖动刷子时才不会卡） */
  function meRefreshTiles() {
    if (!scene) return;
    var gridWasOn = !!gridOverlay;
    splitCustomLayer();
    renderEditOverlays(scene);
    renderCustomLights(scene);
    buildBlockedGrid(scene);
    if (gridOverlay) { gridOverlay.destroy(); gridOverlay = null; }
    if (gridWasOn) toggleGrid(true);
  }
  /* 一笔刷完再合并成一次 POST（hub 一次 set 全量），避免拖拽时打几十个请求 */
  function meQueueSave() {
    mirrorPending = true;
    meEditing = 1;                    // 从改动发生到 POST 返回，忽略 hub 的 map 广播
    meRefreshTiles();
    saveLocalMirror();
    clearTimeout(meFlushTimer);
    meFlushTimer = setTimeout(function () {
      meFlushTimer = null;
      var snapshot = customFurniture.slice();   // 快照：避免这 120ms 里被广播换掉
      saveEditMap(true, { action: "set", item: snapshot }, function (ok, err) {
        meEditing = 0;
        if (!ok) addEditLog("同步失败：" + err);
      });
    }, 120);
  }
  /* ---------- 光照层（v40） ---------- */
  function meLightAt(tx, ty) {
    var best = null, bestD = 1.2;   // 1.2 格内算点到
    lightEdits.forEach(function (L) {
      var d = Math.max(Math.abs(L.x - tx), Math.abs(L.y - ty));
      if (d < bestD) { bestD = d; best = L; }
    });
    return best;
  }
  function meAddLight(tx, ty) {
    meBeginMutation();
    var p = lightPreset();
    var id = "lt" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    customFurniture = customFurniture.concat([{ a: "light", x: Math.round((tx + 0.5) * 10) / 10, y: Math.round((ty + 0.5) * 10) / 10,
                                               r: p.r, al: p.a, tint: p.tint, id: id }]);
    selectedLight = id;
    meQueueSave();
    return { id: id, x: tx + 0.5, y: ty + 0.5 };
  }
  function meRemoveLight(id) {
    meBeginMutation();
    var cur = lightEdits.filter(function (L) { return L.id === id; })[0];
    if (!cur) return false;
    if (cur.builtin) {
      // 内置光源：写删除标记
      customFurniture = customFurniture.filter(function (f) { return !(isLightEntry(f) && f.id === id); })
        .concat([{ a: "light", id: id, del: 1, x: cur.x, y: cur.y }]);
    } else {
      customFurniture = customFurniture.filter(function (f) { return !(isLightEntry(f) && f.id === id); });
    }
    if (selectedLight === id) selectedLight = null;
    meQueueSave();
    return true;
  }
  function mePatchLight(id, patch) {
    meBeginMutation();
    var cur = lightEdits.filter(function (L) { return L.id === id; })[0];
    if (!cur) return false;
    var base = { a: "light", id: id, x: cur.x, y: cur.y, r: cur.r, al: cur.a, tint: cur.tint };
    var next = Object.assign(base, patch || {});
    next.a = "light"; next.id = id;
    customFurniture = customFurniture.filter(function (f) { return !(isLightEntry(f) && f.id === id); }).concat([next]);
    meQueueSave();
    return true;
  }
  function meMoveLight(id, tx, ty) {
    return mePatchLight(id, { x: Math.round(tx * 10) / 10, y: Math.round(ty * 10) / 10 });
  }
  /* ---------- 阴影区域（v42）：每块独立三档浓度（夜 / 开灯 / 白天），内置块同样可改可移可删 ---------- */
  function meShadowAt(tx, ty) {
    for (var i = shadowEdits.length - 1; i >= 0; i--) {
      var r = shadowEdits[i];
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
    }
    return null;
  }
  /* 写一条覆盖（内置块：先按当前几何/浓度生成，再打补丁） */
  function meUpsertShadow(id, patch) {
    var cur = shadowEdits.filter(function (r) { return r.id === id; })[0];
    if (!cur) return false;
    var base = { a: "shadow", id: id, x: cur.x, y: cur.y, w: cur.w, h: cur.h,
                 night: cur.night, lit: cur.lit, day: cur.day };
    if (cur.label) base.label = cur.label;
    var next = Object.assign(base, patch || {});
    next.a = "shadow"; next.id = id;
    customFurniture = customFurniture.filter(function (f) { return !(isShadowEntry(f) && f.id === id); }).concat([next]);
    meQueueSave();
    return true;
  }
  function meAddShadow(x0, y0, x1, y1) {
    meBeginMutation();
    var x = Math.max(0, Math.min(x0, x1)), y = Math.max(0, Math.min(y0, y1));
    var w = Math.max(1, Math.abs(x1 - x0) + 1), h = Math.max(1, Math.abs(y1 - y0) + 1);
    w = Math.min(w, COLS - x); h = Math.min(h, ROWS - y);
    var id = "s" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    customFurniture = customFurniture.filter(function (f) { return !(isShadowEntry(f) && f.id === id); })
      .concat([{ a: "shadow", id: id, x: x, y: y, w: w, h: h,
                 night: SHADOW_DEFAULTS.night, lit: SHADOW_DEFAULTS.lit, day: SHADOW_DEFAULTS.day }]);
    ME_SHADOW_SEL = id;
    meQueueSave();
    return { id: id, x: x, y: y, w: w, h: h };
  }
  function mePatchShadow(id, patch) { return meUpsertShadow(id, patch); }
  function meRemoveShadow(id) {
    meBeginMutation();
    var cur = shadowEdits.filter(function (r) { return r.id === id; })[0];
    if (!cur) return false;
    if (cur.builtin) {
      // 内置块：写一条删除标记（几何顺手存一份，方便"恢复"时参考）
      customFurniture = customFurniture.filter(function (f) { return !(isShadowEntry(f) && f.id === id); })
        .concat([{ a: "shadow", id: id, del: 1, x: cur.x, y: cur.y, w: cur.w, h: cur.h }]);
    } else {
      customFurniture = customFurniture.filter(function (f) { return !(isShadowEntry(f) && f.id === id); });
    }
    if (ME_SHADOW_SEL === id) ME_SHADOW_SEL = null;
    meQueueSave();
    return true;
  }
  function meClearShadows() {
    meBeginMutation();
    // 只清"自定义块"，内置块恢复默认（去掉覆盖/删除标记）
    customFurniture = customFurniture.filter(function (f) { return !isShadowEntry(f); });
    meQueueSave();
    return true;
  }
  /* 拉框时的半透明预览 */
  function meDrawPreview() {
    if (!scene) return;
    if (!scene.shadowPreviewGfx || !scene.shadowPreviewGfx.active) {
      scene.shadowPreviewGfx = scene.add.graphics().setDepth(59150);
    }
    var g = scene.shadowPreviewGfx;
    g.clear();
    if (!ME_DRAW) return;
    var x = Math.min(ME_DRAW.x0, ME_DRAW.x1), y = Math.min(ME_DRAW.y0, ME_DRAW.y1);
    var w = Math.abs(ME_DRAW.x1 - ME_DRAW.x0) + 1, h = Math.abs(ME_DRAW.y1 - ME_DRAW.y0) + 1;
    g.fillStyle(0x4a6cf7, 0.22);
    g.fillRect(x * TILE, WALL_H + y * TILE, w * TILE, h * TILE);
    g.lineStyle(2, 0x4a6cf7, 0.95);
    g.strokeRect(x * TILE, WALL_H + y * TILE, w * TILE, h * TILE);
  }
  function meSetNight(patch) {
    if (patch.alpha != null) nightCfg.alpha = Math.max(0, Math.min(0.9, Number(patch.alpha)));
    if (patch.pad != null) nightCfg.pad = Math.max(0, Math.min(96, Number(patch.pad)));
    if (patch.preview) nightCfg.preview = (patch.preview === "day" || patch.preview === "night") ? patch.preview : "auto";
    saveNightCfg();
    if (scene) applyRoomLights(scene);   // 立刻按新参数重画夜间遮罩
    return nightCfg;
  }

  function meSetTile(layer, t, tx, ty, band) {
    meBeginMutation();
    var a = layer === "floor" ? "floor" : "terrain";
    var next = customFurniture.filter(function (e) {
      return !(e.a === a && Number(e.x) === tx && Number(e.y) === ty && !!e.band === !!band);
    });
    next.push(tileEntryFor(layer, t, tx, ty, band));
    customFurniture = next;
    meQueueSave();
    return true;
  }
  function meEraseAt(layer, tx, ty, band) {
    meBeginMutation();
    var a = layer === "floor" ? "floor" : "terrain";
    var before = customFurniture.length;
    // v60：擦除不区分 band，且把"墙带"（ty=-1）折算成 y=0（band 条目存的就是 y=0）
    var tyy = (band || ty < 0) ? 0 : ty;
    customFurniture = customFurniture.filter(function (e) {
      return !(e.a === a && Number(e.x) === tx && Number(e.y) === tyy);
    });
    if (customFurniture.length === before) return false;
    meQueueSave();
    return true;
  }
  function meApplyCell(tx, ty, band) {
    ME.lastCell = tx + "," + ty + (band ? ",band" : "");
    var layer = ME.layer;
    if (layer !== "floor" && layer !== "terrain") return;
    var t = layer === "floor" ? ME.floor : ME.terrain;
    if (ME.tool === "erase") meEraseAt(layer, tx, ty, band);
    else meSetTile(layer, t, tx, ty, band);
  }
  /* 画布按下：物品层沿用原有三件套，贴片层按格刷 */
  function mapEditorPointerDown(wx, wy, pointer) {
    if (pointer && pointer.rightButtonDown && pointer.rightButtonDown()) return false;   // v48：右键只平移
    if (camDragOn) return false;      // 「拖动视角」模式下不落笔（交给 bindCamDrag 平移镜头）
    var c = meTileAt(wx, wy);
    var inBand = (c.ty === -1);
    var bandPaint = inBand && ME.layer === "terrain" && (ME.tool === "erase" || ME.tool === "paint");
    if (!meInBounds(c) && !bandPaint && !(inBand && (meWallAsset(ME.asset) || ME.tool === "select" || ME.tool === "erase" || ME.tool === "move"))) return true;   // v51/v59：墙带里也要能选中/拖动/删除/画墙
    if (ME.layer === "light" && ME_LIGHTMODE === "shadow") {
      var sel = meShadowAt(c.tx, c.ty);
      if (ME.tool === "erase") { if (sel) meRemoveShadow(sel.id); return true; }
      if (ME.tool === "move") {
        if (sel) { ME_DRAG_SHADOW = { id: sel.id, dx: c.tx - sel.x, dy: c.ty - sel.y }; ME_SHADOW_SEL = sel.id; }
        return true;
      }
      ME_DRAW = { x0: c.tx, y0: c.ty, x1: c.tx, y1: c.ty };   // 拉框
      meDrawPreview();
      return true;
    }
    if (ME.layer === "light") {
      var hit = meLightAt(c.tx, c.ty);
      if (ME.tool === "erase") { if (hit) meRemoveLight(hit.id); return true; }
      if (ME.tool === "move") { if (hit) { selectedLight = hit.id; ME.dragLight = hit.id; } return true; }
      meAddLight(c.tx, c.ty);
      return true;
    }
    if (ME.layer === "object") {
      // v54：选择工具点到开关/壁灯 → 直接切灯（顺便选中它，方便改"控制房间"）
      // v55：只要点中的是开关/壁灯，就切灯 —— 不再要求先切到"选择"工具（之前默认还是"放置+选了资产"，点了就变成又放一个）
      if (ME.tool !== "erase" && ME.tool !== "move") {
        var swHit = null;
        (scene.placed || []).forEach(function (p) {
          if (!p.f || (p.f.a !== "switch" && p.f.a !== "wall-lamp") || !p.spr) return;
          var bb = p.bbox || [0, 0, 24, 24];
          var halfW = (bb[2] || 24) / 2 + 8;
          if (wx > p.x - halfW && wx < p.x + halfW && wy > p.y - (bb[3] || 24) - 10 && wy < p.y + 10) swHit = p;
        });
        if (swHit) {
          meToggleSwitchAt(wx, wy);
          if (swHit.f.id) { editSelItem = swHit; if (typeof markEditSelection === "function") markEditSelection(swHit); }
          return true;
        }
      }
      // v44：工具优先级 —— 「选择/移动/删除」永远压过"资产还选着"这件事，避免选了资产后点什么都变成放置
      var tool = ME.tool === "erase" ? "delete"
               : ME.tool === "move" ? "move"
               : ME.tool === "select" ? "select"
               : (ME.asset ? "add" : "select");
      if (editTool !== tool) setEditTool(tool);
      if (tool === "add") editAsset = ME.asset;
      editPointerDown(wx, wy, pointer);
      return true;
    }
    ME.painting = true;
    ME.lastCell = "";
    meApplyCell(c.tx, c.ty, inBand);
    return true;
  }
  function mapEditorPointerMove(wx, wy) {
    if (ME.dragLight && ME.layer === "light") {
      var c0 = meTileAt(wx, wy);
      if (meInBounds(c0)) meMoveLight(ME.dragLight, c0.tx + 0.5, c0.ty + 0.5);
      return;
    }
    if (ME.layer === "light" && ME_LIGHTMODE === "shadow") {
      var cs = meTileAt(wx, wy);
      if (!meInBounds(cs)) return;
      if (ME_DRAW) { ME_DRAW.x1 = cs.tx; ME_DRAW.y1 = cs.ty; meDrawPreview(); return; }
      if (ME_DRAG_SHADOW) {
        mePatchShadow(ME_DRAG_SHADOW.id, { x: Math.max(0, Math.min(COLS - 1, cs.tx - ME_DRAG_SHADOW.dx)),
                                           y: Math.max(0, Math.min(ROWS - 1, cs.ty - ME_DRAG_SHADOW.dy)) });
        return;
      }
      return;
    }
    if (!ME.painting || ME.layer === "object") return;
    var c = meTileAt(wx, wy);
    // v59：地形层在墙带（ty = -1）里也能连续刷
    var inBand2 = (c.ty === -1) && ME.layer === "terrain" && ME.tool !== "select" && ME.tool !== "move";
    if (!meInBounds(c) && !inBand2) return;
    if (c.tx + "," + c.ty + (inBand2 ? ",band" : "") === ME.lastCell) return;
    meApplyCell(c.tx, c.ty, inBand2);
  }
  function mapEditorPointerUp() {
    if (ME_DRAW) {
      var d = ME_DRAW; ME_DRAW = null;
      meDrawPreview();
      meAddShadow(d.x0, d.y0, d.x1, d.y1);      // 只点一下也能落 1×1
    }
    ME_DRAG_SHADOW = null;
    ME.dragLight = null;
    ME.painting = false;
    ME.lastCell = "";
    if (meFlushTimer) { clearTimeout(meFlushTimer); meFlushTimer = null; saveEditMap(true, null, function () {}); }
  }
  /* 静态家具被拖动后：写一条 move 覆盖（map.json 只读也不怕），自定义的直接 move */
  function meMoveTo(p, tx, ty) {
    var f = p.f;
    if (!f) return;
    if (f._custom) {
      saveEditMap(false, { action: "move", item: { id: f.id, x: tx, y: ty } }, function (ok, err) {
        editToast(ok ? "已移动" : "已在本机移动（hub 未同步：" + err + "）");
      });
      return;
    }
    var key = furnitureKeyOf(f);
    var next = customFurniture.filter(function (e) { return !(isMoveEntry(e) && e.k === key); });
    next.push(moveEntryFor(key, tx, ty));
    saveEditMap(false, { action: "set", item: next }, function (ok, err) {
      editToast(ok ? "已移动静态物件 " + f.a : "已在本机移动（hub 未同步：" + err + "）");
    });
  }
  window.__mapEditor = {
    isEditor: editorMode,
    state: function () {
      splitCustomLayer();
      return {
        layer: ME.layer, tool: ME.tool, asset: ME.asset, floor: ME.floor, terrain: ME.terrain,
        floorCount: Object.keys(floorEdits).length, terrainCount: Object.keys(terrainEdits).length,
        objectCount: customFurniture.filter(function (f) { return f.a && !isHideEntry(f) && !isMoveEntry(f) && !isFloorEntry(f) && !isTerrainEntry(f) && !isLightEntry(f) && !isShadowEntry(f); }).length,
        moveCount: Object.keys(moveOverrides).length, hidden: hiddenCount(),
        grid: !!gridOverlay, continuous: !!ME.continuous,
        undoCount: meUndoStack.length, redoCount: meRedoStack.length,
        roomLights: Object.assign({}, roomLights), lightsOn: !!lightsOn,
        selF: editSelItem && editSelItem.f ? { id: editSelItem.f.id || "", a: editSelItem.f.a, room: editSelItem.f.room || "", band: !!editSelItem.f.band } : null,
        rot: EDIT_ROT, rotLabel: ROT_LABEL[EDIT_ROT], canRotate: !!(ME.asset && rotatable(ME.asset)),
        hub: hubMapOk === true, hubError: hubMapErr, mirror: mirrorPending,
        lastSave: { at: lastSave.at, ok: lastSave.ok, count: lastSave.count, err: lastSave.err, hubCount: lastSave.hubCount },
        lightCount: lightEdits.length,
        shadowCount: shadowEdits.length, lightMode: ME_LIGHTMODE, selectedShadow: ME_SHADOW_SEL,
        shadowDefaults: { night: SHADOW_DEFAULTS.night, lit: SHADOW_DEFAULTS.lit, day: SHADOW_DEFAULTS.day },
        night: { alpha: nightCfg.alpha, pad: nightCfg.pad, preview: nightCfg.preview, roomMask: nightCfg.roomMask !== false, ambient: nightCfg.ambient == null ? 0.42 : nightCfg.ambient },
        lightPreset: nightPreset, lightPresets: LIGHT_PRESETS.map(function (p) { return { id: p.id, label: p.label, tint: p.tint, r: p.r, a: p.a }; }),
        selectedLight: selectedLight,
        assets: EDIT_PICKABLE.slice(0), floorStyles: Object.keys(FLOOR_STYLE), floorLabels: FLOOR_LABEL, terrainLabels: TERRAIN_LABEL,
        // v39.3：分类（侧栏按类别分开展示，别 71 件混成一格）
        categories: EDIT_CATS.map(function (c) { return { id: c.id, label: c.label, icon: c.icon, assets: c.assets.slice(0) }; })
      };
    },
    setLayer: function (l) { ME.layer = l; if (l === "object" && editTool === "delete") setEditTool("select"); return ME.layer; },
    setTool: function (t) { ME.tool = t; return ME.tool; },
    /* v44：选定资产立刻进"放置+预览"状态，鼠标一动就能看到跟手的半透明预览 */
    setAsset: function (a) { ME.asset = a; if (a) { ME.tool = "paint"; setEditTool("add"); editAsset = a; } else { setEditTool("select"); clearEditGhost(); } return ME.asset; },
    setContinuous: function (on) { ME.continuous = !!on; return ME.continuous; },
    selfCheck: function () { return meSelfCheck(); },
    listBackups: function () { return meListBackups(); },
    restoreBackup: function (name, cb) { return meRestoreBackup(name, cb); },
    localMirror: function () { return meLocalMirrorInfo(); },
    restoreFromMirror: function (cb) { return meRestoreFromMirror(cb); },
    setRoomLight: function (room, on) { return meSetRoomLight(room, on); },
    patchObject: function (id, patch) { return mePatchObject(id, patch); },
    toggleSwitchAt: function (wx, wy) { return meToggleSwitchAt(wx, wy); },
    focusAt: function (wx, wy) { return meFocusAt(wx, wy); },
    locateObject: function (key) { return meLocateObject(key); },
    locateLight: function (id) { return meLocateLight(id); },
    locateShadow: function (id) { return meLocateShadow(id); },
    undo: function () { return meUndo(); },
    redo: function () { return meRedo(); },
    clearLayer: function (kind) { return meClearLayer(kind || "all"); },
    rotate: function () {
      var r = meRotateSelected();
      if (editGhost) { var fr = editFrameFor(editAsset || (editGhost && editGhost.texture && editGhost.texture.key), r); if (fr && editGhost.setFrame) editGhost.setFrame(fr); }
      return { rot: r, label: ROT_LABEL[r] };
    },
    setRot: function (r) { EDIT_ROT = (Number(r) || 0) & 3; return EDIT_ROT; },
    setFloor: function (t) { ME.floor = t; ME.layer = "floor"; ME.tool = "paint"; return ME.floor; },
    setTerrain: function (t) { ME.terrain = t; ME.layer = "terrain"; ME.tool = "paint"; return ME.terrain; },
    paint: function (layer, t, tx, ty, band) { return meSetTile(layer, t, tx, ty, !!band); },
    /* ---- 光照层（v40）---- */
    lights: function () {
      splitCustomLayer();
      return lightEdits.map(function (L) {
        return { id: L.id, builtin: !!L.builtin, x: L.x, y: L.y, r: L.r, a: L.a, tint: L.tint, selected: L.id === selectedLight };
      });
    },
    addLight: function (tx, ty) { return meAddLight(tx, ty); },
    removeLight: function (id) { return meRemoveLight(id); },
    selectLight: function (id) { selectedLight = id; return true; },
    patchLight: function (id, patch) { return mePatchLight(id, patch); },
    moveLight: function (id, tx, ty) { return meMoveLight(id, tx, ty); },
    setLightPreset: function (id) { nightPreset = id; return nightPreset; },
    setNight: function (patch) { return meSetNight(patch); },
    /* v69：夜色强度（全屏压暗）0~0.6 */
    setNightAmbient: function (v) {
      if (typeof nightCfg !== "undefined") { nightCfg.ambient = Math.max(0, Math.min(0.6, Number(v))); saveNightCfg(); }
      if (scene) applyRoomLights(scene);
      return nightCfg.ambient;
    },
    /* ---- 阴影矩形（v41 拉框）---- */
    setLightMode: function (m) { ME_LIGHTMODE = (m === "shadow" ? "shadow" : "light"); ME_DRAW = null; meDrawPreview(); return ME_LIGHTMODE; },
    setShadowLv: function (lv) { ME_SHADOW_LV = Math.max(1, Math.min(3, Number(lv) || 2)); return ME_SHADOW_LV; },
    shadows: function () {
      splitCustomLayer();
      return shadowEdits.map(function (r) {
        return { id: r.id, label: r.label || "", builtin: !!r.builtin, room: r.room || null, roomLabel: ({office:"办公室",bedroom:"起居",bath:"卫浴",kitchen:"厨房"})[r.room] || "全局",
                 x: r.x, y: r.y, w: r.w, h: r.h,
                 night: +Number(r.night).toFixed(2), lit: +Number(r.lit).toFixed(2), day: +Number(r.day).toFixed(2),
                 selected: r.id === ME_SHADOW_SEL, alphaNow: +shadowAlphaOf(r).toFixed(2) };
      });
    },
    addShadow: function (x, y, w, h) { return meAddShadow(x, y, x + (w || 1) - 1, y + (h || 1) - 1); },
    patchShadow: function (id, patch) { return mePatchShadow(id, patch); },
    removeShadow: function (id) { return meRemoveShadow(id); },
    selectShadow: function (id) { ME_SHADOW_SEL = id; return true; },
    clearShadows: function () { return meClearShadows(); },
    setShadowDefaults: function (patch) {
      ["night", "lit", "day"].forEach(function (k) {
        if (patch && patch[k] != null) SHADOW_DEFAULTS[k] = Math.max(0, Math.min(0.95, Number(patch[k])));
      });
      return SHADOW_DEFAULTS;
    },
    entries: function () {
      splitCustomLayer();
      return {
        floor: Object.keys(floorEdits).map(function (k) { return { x: floorEdits[k].x, y: floorEdits[k].y, t: floorEdits[k].t }; }),
        terrain: Object.keys(terrainEdits).map(function (k) { return { x: terrainEdits[k].x, y: terrainEdits[k].y, t: terrainEdits[k].t }; }),
        moves: Object.keys(moveOverrides).map(function (k) { return { k: k, x: moveOverrides[k].x, y: moveOverrides[k].y }; })
      };
    },
    objects: function () {
      if (!scene || !scene.placed) return [];
      var cam = scene.cameras.main, vw = cam.worldView, out = [];
      scene.placed.forEach(function (p) {
        if (!p || !p.f || !p.spr || !p.spr.active) return;
        if (p.x < vw.x - 64 || p.x > vw.x + vw.width + 64) return;
        if (p.y < vw.y - 64 || p.y > vw.y + vw.height + 64) return;
        var pos = furniturePosText(p);
        out.push({ key: furnitureKeyOf(p.f), a: p.f.a,
                   x: Math.round(p.x), y: Math.round(p.y), pos: pos,   // x/y 供排序用（世界像素），pos 是格子坐标文本
                   custom: !!p.f._custom, moved: !!p.f._moved,
                   icon: assetIconUrl(p.f.a, p.f.frame || 0) });
      });
      out.sort(function (a, b) {
        var cx = vw.x + vw.width / 2, cy = vw.y + vw.height / 2;
        return (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy));
      });
      return out.slice(0, 40);
    },
    focus: function (key) {
      var p = (scene && scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
      if (!p) return false;
      markEditSelection(p);
      focusOnPlacement(p);
      return true;
    },
    deleteObject: function (key) {
      var p = (scene && scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
      if (!p) return false;
      if (p.f._custom) return saveEditMap(false, { action: "remove", item: { id: p.f.id } }, function () {}) || true;
      hideStaticItem(p);
      return true;
    },
    restoreHidden: function () {
      var kept = customFurniture.filter(function (f) { return !isHideEntry(f); });
      saveEditMap(false, { action: "set", item: kept }, function () {});
      return true;
    },
    clearAll: function () { saveEditMap(false, { action: "set", item: [] }, function () {}); return true; },
    save: function () { saveEditMap(false, null, function () {}); return true; },
    /* v39.4：保存 + 回读校验，把"存了几条 / hub 现在几条"回给 UI */
    saveNow: function (cb) { return saveMapAndVerify(cb); },
    /* 碰撞格叠加层开关（v38.1）：默认关，侧栏一个按钮切 */
    grid: function (on) {
      if (typeof on === "boolean") {
        if (on && !gridOverlay) toggleGrid(true);
        else if (!on && gridOverlay) toggleGrid(false);
      }
      return !!gridOverlay;
    },
    icon: assetIconUrl,
    camera: function (dx, dy, zoom) {
      if (!scene) return null;
      var cam = scene.cameras.main;
      cam.stopFollow();
      if (dx || dy) { cam.scrollX += dx; cam.scrollY += dy; }
      if (zoom) {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom + zoom, minZoomNoVoid(), 3));   // v78：不允许缩到露底
      clampScroll(cam);
    }
      return { scrollX: Math.round(cam.scrollX), scrollY: Math.round(cam.scrollY), zoom: +cam.zoom.toFixed(2) };
    }
  };
  /* v44：旋转 —— 转"下一次要放的"或"当前选中的自建物品"；返回朝向序号 0=南 1=东 2=北 3=西 */
  function meRotateSelected() {
    EDIT_ROT = (EDIT_ROT + 1) & 3;
    var p = editSelItem;
    if (p && p.f && p.f._custom && p.f.id) {
      var fr = editFrameFor(p.f.a, EDIT_ROT);
      saveEditMap(false, { action: "update", item: { id: p.f.id, frame: fr } }, function () {});   // 只写 frame
    }
    return EDIT_ROT;
  }
  /* 编辑点击：add=放置 / delete=删除(静态=隐藏) / move=抓起（拖动在 pointermove / 松手落定） */
  function editPointerDown(worldX, worldY, pointer) {
    var cx = pointer && pointer.event ? pointer.event.clientX : null;
    var cy = pointer && pointer.event ? pointer.event.clientY : null;
    if (editTool === "add" && editAsset) {
      // v44：坐标吸附走 editSnapX/Y（旧代码这里多加了 0.5 格，物品总落在鼠标右下方半格）
      var item = { a: editAsset, x: editSnapX(worldX), y: editSnapY(worldY) };
      if (worldY < WALL_H && meWallAsset(editAsset)) { item.y = 0; item.band = true; }   // v51：贴到顶部墙带
      var fr = editFrameFor(editAsset, EDIT_ROT);
      if (fr) item.frame = fr;                      // 有朝向的素材：记帧号
      var extra = placeExtraFor(editAsset);        // 窗：wall:true（不挡路、贴底图，可随意摆放）
      if (extra) { for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) item[k] = extra[k]; }
      var shiftHeld = !!(pointer && pointer.event && pointer.event.shiftKey);
      if (!ME.continuous && !shiftHeld) {           // v46：按住 Shift = 连续摆放；否则放一次就交还选择工具
        ME.asset = null;
        ME.tool = "select";
        setEditTool("select");
        clearEditGhost();
      }
      saveEditMap(false, { action: "add", item: item }, function (ok, err) {
        // 本地已经生效：hub 失败时不再说"放置失败"（那会与画面矛盾），改成"已放本机、未同步"
        if (ok) editToast("已放置 " + editAsset, worldX, worldY, cx, cy);
        else editToast("已放在本机（hub 未同步：" + err + "）", worldX, worldY, cx, cy);
      });
      return true;
    }
    var hit = pickEditItem(worldX, worldY);
    var st = hit ? null : hitStaticItem(worldX, worldY);
    if (editTool === "delete") {
      if (!hit) {
        if (st) { hideStaticItem(st, cx, cy); return true; }      // 静态家具：直接隐藏（可恢复）
        editToast("这里没有物件（点家具身上再试，或用面板里的物件列表）", worldX, worldY, cx, cy);
        return true;
      }
      var fid = hit.f.id;
      clearEditSelection();
      saveEditMap(false, { action: "remove", item: { id: fid } }, function (ok, err) {
        editToast(ok ? "已删除 " + (hit.f && hit.f.a) : "已在本机删除（hub 未同步：" + err + "）", worldX, worldY, cx, cy);
      });
      return true;
    }
    if (editTool === "move") {
      if (!hit) {
        // v38：静态家具也能拖了（拖动落定后写一条 move 覆盖，map.json 保持只读）
        if (st) { editDragItem = st; markEditSelection(st); return true; }
        editToast("这里没有物件", worldX, worldY, cx, cy);
        return true;
      }
      editDragItem = hit;
      markEditSelection(hit);
      return true;
    }
    // select：点中物件就选中（高亮 + 面板显示坐标 + 镜头对准），点空地才退回"走出去看看"的默认语义
    if (hit) {
      markEditSelection(hit);
      editToast("已选中 " + (hit.f && hit.f.a) + " @ " + (hit.f && (hit.f.x + "," + hit.f.y)), worldX, worldY, cx, cy);
      return true;
    }
    if (st) {
      markEditSelection(st);
      editToast("静态家具 " + (st.f && st.f.a) + "（🗑 或列表 ✕ 可隐藏）", worldX, worldY, cx, cy);
      return true;
    }
    clearEditSelection();
    return false;
  }
  function editPointerMove(worldX, worldY) {
    if (editDragItem && editDragItem.spr) {
      var gx = editSnapX(worldX), gy = editSnapY(worldY);   // v44：与放置同一套吸附
      if (worldY < WALL_H && editDragItem && editDragItem.f && editDragItem.f.a &&
          meWallAsset(editDragItem.f.a)) gy = 0;            // v51：拖到墙带 → y=0
      var wp = editSnapToWorld(gx, gy);
      editDragItem.spr.x = wp.x;
      editDragItem.spr.y = wp.y;
      editDragItem.spr.setDepth(editDragItem.spr.y);
      if (editDragItem.shadow) { editDragItem.shadow.x = editDragItem.spr.x; editDragItem.shadow.y = editDragItem.spr.y + 1; editDragItem.shadow.setDepth(editDragItem.spr.depth - 1); }
      editDragItem._dragX = gx; editDragItem._dragY = gy;
      if (editSelItem === editDragItem) markEditSelection(editDragItem);   // 框跟着手指走
      return true;
    }
    if (editTool === "add") { updateEditGhost(worldX, worldY); return true; }
    return false;
  }
  function editPointerUp() {
    if (editDragItem && editDragItem._dragX != null) {
      var f = editDragItem.f;
      var nx = editDragItem._dragX, ny = editDragItem._dragY;
      if (f && !f._custom) {
        meMoveTo(editDragItem, nx, ny);        // 静态家具：写 move 覆盖
      } else if (f) {
        // v51：墙饰（窗 / 开关）拖动时把 band 一起写回：落回墙带 = true，落到地面 = false
        var wallish = meWallAsset(f.a);
        var patch = { id: f.id, x: nx, y: ny };
        if (wallish) patch.band = ny < 0.9;
        saveEditMap(false, { action: wallish ? "update" : "move", item: patch }, function (ok, err) {
          editToast(ok ? "已移动" : "已在本机移动（hub 未同步：" + err + "）");
        });
      }
      editDragItem._dragX = editDragItem._dragY = null;
    }
    editDragItem = null;
  }
  /* 编辑操作（v37 修复）：先本地生效 → 再推 hub → hub 不通就留在本机镜像（localStorage）。
   * 旧版是「只 POST，等 WS 广播回显」：hub 连不上时点一下只有一句 Failed to fetch，
   * WS 没连到同一个 hub 时则日志写着"已保存"而画面毫无变化 —— 两种都表现为"点了没反应"。 */
  /* v50：改一件自定义物品的字段（开关绑定房间等） */
  /* v63：把镜头飞到某个世界坐标并闪一下（列表点行 → 图上定位） */
  /* v77：最小缩放 = 让相机视口刚好等于地图大小（再小就会露出地图外的底色） */
  function minZoomNoVoid() {
    if (!scene) return 0.6;
    var cam = scene.cameras.main;
    /* 视口宽高比和地图不一致时，取 min 会有一边超出地图（露底），
     * 取 max 则两边都不超出 → 永远铺满。这里坚持 max，并配合下面的 clampScroll。 */
    return Math.max(cam.width / W, cam.height / H, 0.1);
  }
  /* 把相机 scroll 夹进 [bounds]，避免 setZoom 后镜头看到地图外 */
  function clampScroll(cam) {
    var b = cam.getBounds ? cam.getBounds() : null;
    if (!b || !b.width) return;
    var vw = cam.width / cam.zoom, vh = cam.height / cam.zoom;
    var maxX = Math.max(0, b.x + b.width - vw);
    var maxY = Math.max(0, b.y + b.height - vh);
    cam.scrollX = Math.min(Math.max(cam.scrollX, b.x), maxX);
    cam.scrollY = Math.min(Math.max(cam.scrollY, b.y), maxY);
  }
  function meFocusAt(wx, wy) {
    if (!scene || !scene.cameras) return false;
    var cam = scene.cameras.main;
    cam.stopFollow();
    // 夹在地图范围内，别把镜头推到墙带外
    var halfW = cam.width / 2 / cam.zoom, halfH = cam.height / 2 / cam.zoom;
    var tx = Math.min(Math.max(wx, halfW), W - halfW);
    var ty = Math.min(Math.max(wy, halfH), H - halfH);
    if (cam.pan) cam.pan(tx, ty, 320, "Sine.easeInOut");
    else { cam.scrollX = tx - halfW; cam.scrollY = ty - halfH; }
    try { if (typeof flashAt === "function") flashAt(scene, wx, wy, 0xfff3c4); } catch (err) {}
    return true;
  }
  /* 物件：按 key 找它在场景里的精灵 */
  function meLocateObject(key) {
    var hit = null;
    (scene && scene.placed || []).forEach(function (p) {
      if (!p.f || !p.spr) return;
      if (furnitureKeyOf(p.f) === key) hit = p;
    });
    if (!hit) return false;
    return meFocusAt(hit.spr.x, hit.spr.y - 12);
  }
  /* 光源：条目是格子坐标（x/y = 格），换算成世界像素 */
  function meLocateLight(id) {
    var L = lightEdits.filter(function (q) { return q.id === id; })[0];
    if (!L) return false;
    return meFocusAt(L.x * TILE + TILE / 2, WALL_H + L.y * TILE + TILE / 2);
  }
  /* 阴影块：取矩形中心 */
  function meLocateShadow(id) {
    var r = shadowEdits.filter(function (q) { return q.id === id; })[0];
    if (!r) return false;
    return meFocusAt((r.x + r.w / 2) * TILE, WALL_H + (r.y + r.h / 2) * TILE);
  }
  /* v54：编辑器里点开关/壁灯 → 切它那个房间的灯（游戏里是 bindClick 调的同一个函数） */
  function meToggleSwitchAt(wx, wy) {
    if (!scene) return false;
    var hit = null;
    (scene.placed || []).forEach(function (p) {
      if (!p.f || (p.f.a !== "switch" && p.f.a !== "wall-lamp") || !p.spr) return;
      var bb = p.bbox || [0, 0, 24, 24];
      var halfW = (bb[2] || 24) / 2 + 8;
      var top = p.y - (bb[3] || 24) - 10, bottom = p.y + 10;
      if (wx > p.x - halfW && wx < p.x + halfW && wy > top && wy < bottom) hit = p;
    });
    if (!hit) return false;
    var ok = toggleSwitchAt(wx, wy);
    if (ok) {
      var room = hit.room || (typeof roomOfProp === "function" ? roomOfProp(hit) : null);
      var msg = (room ? ({ office: "办公室", bedroom: "起居", bath: "卫浴", kitchen: "厨房" }[room] || room) : "灯光") +
                (roomLights[room] === false ? "：关灯 ⚫" : "：开灯 💡");
      editToast(msg, wx, wy);
      try { if (typeof window.onEditorNotice === "function") window.onEditorNotice(msg); } catch (err) {}
      if (typeof renderEditList === "function" && editMode) renderEditList();
    }
    return ok;
  }
  function mePatchObject(id, patch) {
    if (!id) return false;
    var ok = false;
    customFurniture = customFurniture.map(function (f) {
      if (f.id !== id) return f;
      ok = true;
      return Object.assign({}, f, patch);
    });
    if (!ok) return false;
    meBeginMutation();
    rebuildCustomLayer();
    saveEditMap(false, { action: "update", item: Object.assign({ id: id }, patch) }, function () {});
    return true;
  }
  /* v49：编辑器里直接拨房间灯（验证 夜/开灯 两档浓度用） */
  function meSetRoomLight(room, on) {
    if (room === "all") {
      ["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"].forEach(function (k) { roomLights[k] = !!on; });
      lightsOn = !!on;
    } else if (roomLights[room] !== undefined) {
      roomLights[room] = !!on;
      lightsOn = ["office", "bedroom", "bath", "kitchen", "nbCat", "nbChief", "nbDoc"].some(function (k) { return roomLights[k]; });
    }
    if (scene) applyRoomLights(scene);
    return { lights: Object.assign({}, roomLights), on: lightsOn };
  }
  /* v57：自检 —— 一次说清"为什么存不上/删不掉" */
  function meSelfCheck() {
    var out = {
      local: customFurniture.length, hubOk: hubMapOk, hubError: hubMapErr,
      lastSave: lastSave, mirror: mirrorPending, editing: meEditing,
      undo: meUndoStack.length, forward: meRedoStack.length,
      objects: 0, floor: Object.keys(floorEdits).length, terrain: Object.keys(terrainEdits).length
    };
    return fetch(hubMapUrl(), { method: "GET" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (j) {
        out.hubCount = (j.furniture || []).length;
        out.hubUpdatedAt = j.updatedAt || 0;
        out.hubReachable = true;
        // 写一次"原样"的 set，验证写权限（幂等，且会生成一份自动备份）
        return fetch(hubMapUrl(), { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "set", item: customFurniture }) })
          .then(function (r2) { return r2.json().then(function (j2) { return { s: r2.status, j: j2 }; }); })
          .then(function (res) {
            out.writeOk = !!(res.j && res.j.ok);
            out.writeError = (res.j && res.j.error) || (out.writeOk ? "" : ("HTTP " + res.s));
            out.writeCount = res.j && res.j.count;
            return out;
          });
      })
      .catch(function (err) {
        out.hubReachable = false;
        out.writeOk = false;
        out.writeError = (err && err.message) || "网络错误";
        return out;
      });
  }
  /* v47：历史存档（hub 每次覆盖前自动备份）+ 本机浏览器副本 */
  function meListBackups() {
    return fetch(hubMapUrl().replace(/\/api\/map$/, "/api/map/backups"), { method: "GET" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { dir: "", list: [] }; });
  }
  function meRestoreBackup(name, cb) {
    fetch(hubMapUrl().replace(/\/api\/map$/, "/api/map/restore"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) probeMapHub(function () {});
      if (cb) cb(!!(j && j.ok), j && (j.error || ("已恢复 " + j.count + " 条")));
    }).catch(function (err) { if (cb) cb(false, (err && err.message) || "网络错误"); });
  }
  /* 本机浏览器副本：离线编辑兜底，也可能是"丢失前"的最后一份 */
  function meLocalMirrorInfo() {
    var m = loadLocalMirror();
    if (!m) return null;
    return { count: (m.furniture || []).length, updatedAt: m.updatedAt || 0, pending: !!m.pending, furniture: m.furniture || [] };
  }
  function meRestoreFromMirror(cb) {
    var m = loadLocalMirror();
    if (!m || !Array.isArray(m.furniture) || !m.furniture.length) { if (cb) cb(false, "本机没有可用副本"); return false; }
    meBeginMutation();
    customFurniture = m.furniture.slice();
    rebuildCustomLayer();
    saveEditMap(false, { action: "set", item: customFurniture }, function (ok, err) {
      if (cb) cb(ok, ok ? ("已用本机副本覆盖 hub（" + customFurniture.length + " 条）") : err);
    });
    return true;
  }
  function saveEditMap(silent, payload, cb) {
    // v58：先纠正越界坐标，避免 hub 用"坐标越界"把整批改动打回
    var clean = sanitizeCustomLayer(customFurniture);
    if (clean.fixed.length) {
      customFurniture = clean.list;
      saveLocalMirror();
      addEditLog("已修正越界坐标：" + clean.fixed.join("；"));
      if (typeof renderEditList === "function" && editMode) renderEditList();
    }
    var act = payload ? String(payload.action || "") : "set";
    if (!meApplyingHistory && !meSyncLock) mePushHistory();   // v46：写操作前留快照（改前改后各留一次就够）
    meSyncLock = false;
    var item = payload ? payload.item : null;
    var mutated = false;
    if (act === "add" && item) {
      var it = Object.assign({}, item);
      if (!it.id) it.id = "cu" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
      if (payload) payload.item = it;              // id 由前端生成：本地与 hub 用同一个（hub 有 id 就不重发）
      customFurniture = customFurniture.concat([it]);
      mutated = true;
    } else if (act === "remove" && item) {
      var n0 = customFurniture.length;
      customFurniture = customFurniture.filter(function (f) { return f.id !== item.id; });
      mutated = customFurniture.length !== n0;
      if (!mutated) { if (cb) cb(false, "未找到 " + (item && item.id)); return; }
    } else if ((act === "move" || act === "update") && item) {
      var hit = false;
      customFurniture = customFurniture.map(function (f) {
        if (f.id !== item.id) return f;
        hit = true;
        return Object.assign({}, f, item);
      });
      mutated = hit;
      if (!mutated) { if (cb) cb(false, "未找到 " + (item && item.id)); return; }
    } else if (act === "set" && Array.isArray(item)) {
      customFurniture = item.slice();
      mutated = true;
    }
    if (mutated) {
      inflightMapOps++;
      rebuildCustomLayer();     // 立刻可见，不等 WS 回显
    }
    var body = payload || { action: "set", item: customFurniture };
    var done = function (ok, err) {
      if (mutated) inflightMapOps = Math.max(0, inflightMapOps - 1);
      if (ok) {
        hubMapOk = true; hubMapErr = "";
        mirrorPending = false; mirrorFlushTried = false;
        saveLocalMirror();
        if (!silent) addEditLog("已保存到 hub（" + customFurniture.length + " 条）");
      } else {
        hubMapOk = false; hubMapErr = err || "hub 不可达";
        if (mutated) { mirrorPending = true; saveLocalMirror(); }
        mirrorFlushTried = false;
        scheduleMirrorRetry();      // v57：失败自动重试（hub 恢复后自己补上）
        if (!silent) addEditLog("hub 未同步：" + hubMapErr + "（改动存在本机，稍后自动重试）");
      }
      if (cb) cb(ok, ok ? "" : hubMapErr);
    };
    postMapApi(body, done);
  }
  function addEditLog(msg) {
    var box = document.getElementById("edit-log");
    if (!box) return;
    var d = document.createElement("div");
    d.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }) + " " + msg;
    box.prepend(d);
    while (box.children.length > 8) box.removeChild(box.lastChild);
  }
  /* ---------- 物件图标（v37.3） ----------
   * 列表里只有资产名很难认。这里直接把已加载的贴图按 manifest 的 bbox 裁一块出来做成
   * dataURL（像素图，1:1 不缩放，交给 CSS 用 image-rendering:pixelated 显示），
   * 既不用多请求图片，也不用维护一套图标文件。结果按 资产名+帧号 缓存。 */
  var iconUrlCache = {};
  function assetIconUrl(key, frame) {
    if (!key) return "";
    var ck = key + "#" + (frame || 0);
    if (iconUrlCache[ck] !== undefined) return iconUrlCache[ck];
    var url = "";
    try {
      var m = MAN && MAN[key];
      var tex = scene && scene.textures && scene.textures.exists(key) ? scene.textures.get(key) : null;
      if (m && tex) {
        var fr = tex.get(frame || 0) || tex.get(0);
        var src = tex.getSourceImage();
        var bb = m.bbox || [0, 0, m.frameW || 24, m.frameH || 24];
        if (fr && src && bb[2] > 0 && bb[3] > 0) {
          // 小物件（如硬币、护身符 8×8）按整数倍放大，避免在 22px 盒子里缩成一个点
          var k = Math.max(1, Math.floor(22 / Math.max(bb[2], bb[3])));
          var cv = document.createElement("canvas");
          cv.width = Math.round(bb[2]) * k;
          cv.height = Math.round(bb[3]) * k;
          var ctx = cv.getContext("2d");
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(src, fr.cutX + bb[0], fr.cutY + bb[1], bb[2], bb[3], 0, 0, cv.width, cv.height);
          url = cv.toDataURL("image/png");
        }
      }
    } catch (e) { url = ""; }
    iconUrlCache[ck] = url;
    return url;
  }
  /* 编辑面板 DOM：资产选择 + 工具 + 条目列表 */
  function buildEditPanel() {
    if (editorMode) return;   // 独立编辑器有自己的侧栏（web/editor.js），不重复建游戏内小面板
    if (document.getElementById("edit-panel")) return;
    var host = document.getElementById("office-parent");
    if (!host) return;
    var panel = document.createElement("div");
    panel.id = "edit-panel";
    // 高度跟着容器走：原来写死 max-height:560px，在 1248×768 的容器（高 507）里会被 #office-parent
    // 的 overflow:hidden 直接裁掉底部（列表最后几行 + 日志区看不见）。改成 calc(100% - 64px)。
    panel.style.cssText = "position:absolute;z-index:45;left:14px;top:52px;width:262px;max-height:calc(100% - 64px);overflow:auto;" +
      "border-radius:10px;background:#1d2130f2;border:1px solid #ffffff33;color:#ece8df;box-shadow:0 6px 20px #0008;display:none;" +
      "font:12px/1.6 'PingFang SC','Microsoft YaHei',system-ui,sans-serif;padding:10px 12px;";
    panel.innerHTML =
      // 选中态样式必须写进样式表：按钮原本只有 inline 背景色，光加 .active 类看不出任何变化（v37.2）
      '<style>' +
      '#edit-panel button.ep-btn:hover{border-color:#4a6cf7 !important;color:#fff !important}' +
      '#edit-panel button.ep-btn.active{background:#4a6cf7 !important;border-color:#4a6cf7 !important;color:#fff !important;box-shadow:0 0 0 1px #ffffff55 inset !important}' +
      // 资产按钮：小图标 + 名字（v37.3）
      '#edit-panel #edit-assets button{display:flex;align-items:center;gap:4px;text-align:left}' +
      '#edit-panel #edit-assets .ep-asset-ico{width:18px;height:18px;flex:none;object-fit:contain;image-rendering:pixelated}' +
      '#edit-panel #edit-assets .ep-asset-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      // 物件列表：图标 + 名字 + 坐标 + 删除（v37.3）
      '#edit-panel #edit-list .ep-row{display:flex;align-items:center;gap:6px;padding:2px 4px;border-bottom:1px dashed #ffffff12}' +
      '#edit-panel #edit-list .ep-row .ep-ico{width:22px;height:22px;flex:none;display:flex;align-items:center;justify-content:center;background:#ffffff12;border-radius:4px;overflow:hidden;color:#6b7280}' +
      '#edit-panel #edit-list .ep-row .ep-ico img{max-width:100%;max-height:100%;display:block;image-rendering:pixelated}' +
      '#edit-panel #edit-list .ep-row .ep-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
      '#edit-panel #edit-list .ep-row .ep-pos{flex:none;color:#9aa3b8;font-variant-numeric:tabular-nums}' +
      '#edit-panel #edit-list .ep-row .ep-del{flex:none;border:0;background:transparent;color:#ff8787;cursor:pointer;padding:0 2px}' +
      '#edit-panel #edit-list .ep-row .ep-tag{flex:none;font-style:normal;font-size:9.5px;padding:0 3px;margin-left:4px;border-radius:4px;background:#ffffff1a;color:#9aa3b8}' +
      '#edit-panel #edit-list .ep-row .ep-tag.cus{background:#4a6cf7aa;color:#fff}' +
      '#edit-panel #edit-list .ep-row:hover{background:#ffffff14;border-radius:5px}' +
      '#edit-panel #edit-list .ep-row.row-sel{background:#4a6cf7;border-radius:5px;color:#fff}' +
      '#edit-panel #edit-list .ep-row.row-sel .ep-pos{color:#dbe4ff}' +
      '</style>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><b style="color:#ffd43b">地图编辑</b>' +
      '<button id="edit-close" style="margin-left:auto;border:0;background:transparent;color:#9aa3b8;cursor:pointer;font-size:15px">×</button></div>' +
      '<div style="display:flex;gap:5px;margin-bottom:8px">' +
      ["select|🖱 选择", "add|➕ 放置", "move|✥ 移动", "delete|🗑 删除"].map(function (p) {
        var kv = p.split("|");
        return '<button id="edit-tool-' + kv[0] + '" data-tool="' + kv[0] + '" class="ep-btn" style="flex:1;padding:4px 2px;border-radius:6px;border:1px solid #ffffff33;background:#2a2e3d;color:#ece8df;cursor:pointer;font-size:11.5px">' + kv[1] + "</button>";
      }).join("") + "</div>" +
      '<div id="edit-sel" style="color:#ffd43b;margin-bottom:6px;font-size:11px;min-height:16px"></div>' +
      '<select id="edit-cat" style="width:100%;margin-bottom:5px;padding:3px 6px;border-radius:6px;border:1px solid #ffffff33;background:#2a2e3d;color:#ece8df;font-size:11.5px"></select>' +
      '<div id="edit-assets" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;max-height:170px;overflow:auto;margin-bottom:8px"></div>' +
      '<div style="display:flex;gap:5px;margin-bottom:6px">' +
      '<button id="edit-save" style="flex:1;padding:5px;border-radius:6px;border:0;background:#4a6cf7;color:#fff;cursor:pointer;font-weight:700">💾 保存到服务器</button>' +
      '<button id="edit-clear" style="flex:none;padding:5px 8px;border-radius:6px;border:1px solid #ffffff33;background:transparent;color:#ff8787;cursor:pointer">清空</button></div>' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
      '<span style="color:#9aa3b8">物件列表（视口内 <span id="edit-obj-count">0</span> 件）</span>' +
      '<button id="edit-obj-refresh" class="ep-btn" title="刷新列表（镜头移动后点一下）" style="margin-left:auto;padding:1px 6px;border-radius:5px;border:1px solid #ffffff33;background:#2a2e3d;color:#c3c9d9;cursor:pointer;font-size:11px">↻</button>' +
      "</div>" +
      '<div style="color:#9aa3b8;margin-bottom:4px">已放置 <span id="edit-count">0</span> 件自定义 · 上限 6000</div>' +
      '<div id="edit-hub" style="color:#9aa3b8;margin-bottom:4px;font-size:11px"></div>' +
      '<div id="edit-list" style="max-height:150px;overflow:auto;margin-bottom:4px"></div>' +
      '<div id="edit-hidden" style="display:none;color:#ffc078;margin-bottom:4px;font-size:11px">' +
      '已隐藏 <span id="edit-hidden-count">0</span> 件静态物件 <button id="edit-unhide" class="ep-btn" style="padding:0 6px;border-radius:5px;border:1px solid #ffffff33;background:transparent;color:#ffd43b;cursor:pointer;font-size:11px">全部恢复</button></div>' +
      '<div id="edit-log" style="color:#8ce99a;min-height:16px;font-size:11px"></div>';
    host.appendChild(panel);
    panel.querySelector("#edit-close").onclick = function () { setEditMode(false); };
    panel.querySelector("#edit-obj-refresh").onclick = function () { renderEditList(); };
    panel.querySelector("#edit-hub").onclick = function () { probeMapHub(function () { renderEditList(); }); };
    panel.querySelector("#edit-unhide").onclick = function () {
      var kept = customFurniture.filter(function (f) { return !isHideEntry(f); });
      saveEditMap(false, { action: "set", item: kept }, function (ok, err) {
        addEditLog(ok ? "已恢复全部静态物件" : "已在本地恢复（hub 未同步：" + err + "）");
      });
    };
    panel.querySelector("#edit-save").onclick = function () { saveEditMap(false, null, function (ok, err) { addEditLog(ok ? "全量已保存到 hub" : "hub 未同步：" + err + "（清单已存本机浏览器）"); }); };
    panel.querySelector("#edit-clear").onclick = function () {
      var n = customFurniture.filter(function (f) { return !isHideEntry(f); }).length;
      if (!confirm("清空全部 " + n + " 件自定义物品？\n（隐藏的静态物件也会一起恢复）")) return;
      clearEditSelection();
      saveEditMap(false, { action: "set", item: [] }, function (ok, err) { addEditLog(ok ? "已清空" : "已在本机清空（hub 未同步：" + err + "）"); });
    };
    ["select", "add", "move", "delete"].forEach(function (k) {
      var b = panel.querySelector("#edit-tool-" + k);
      b.onclick = function () { setEditTool(k); };
    });
    var wrap = panel.querySelector("#edit-assets");
    var catSel = panel.querySelector("#edit-cat");
    var catOf = {};
    EDIT_CATS.forEach(function (c) { c.assets.forEach(function (a) { catOf[a] = c.id; }); });
    // 分类下拉（v39.3）：值 = 分类 id 或 all
    var opts = [{ id: "all", label: "全部（" + EDIT_PICKABLE.length + "）" }].concat(EDIT_CATS.map(function (c) {
      return { id: c.id, label: c.icon + " " + c.label + "（" + c.assets.length + "）" };
    }));
    opts.forEach(function (o) {
      var op = document.createElement("option");
      op.value = o.id; op.textContent = o.label;
      catSel.appendChild(op);
    });
    EDIT_PICKABLE.forEach(function (a) {
      var b = document.createElement("button");
      b.dataset.asset = a;
      b.dataset.cat = catOf[a] || "misc";
      b.title = a;
      b.className = "ep-btn";   // 注意：类名要在 classList.toggle("active") 之前设好
      b.style.cssText = "padding:3px 4px;border-radius:5px;border:1px solid #ffffff22;background:#2a2e3d;color:#c3c9d9;cursor:pointer;font-size:10px;overflow:hidden;white-space:nowrap";
      var ico = assetIconUrl(a, 0);   // 图标用第 0 帧（静止朝向），够认物件了
      b.innerHTML = (ico ? '<img class="ep-asset-ico" src="' + ico + '" alt="">' : "") +
        '<span class="ep-asset-name">' + a.replace(/^(office|kitchen|market|round|school|dining|double|bench|stall|sign|filing|floor|desk|crown|house)-/, "") + "</span>";
      b.onclick = function () { setEditAsset(a); };
      wrap.appendChild(b);
    });
    catSel.onchange = function () {
      var v = catSel.value;
      [].forEach.call(wrap.querySelectorAll("button"), function (b) {
        b.style.display = (v === "all" || b.dataset.cat === v) ? "" : "none";
      });
    };
    catSel.value = "all";
    setEditTool("select");
  }
  /* 视口内的所有物件（静态 + 自定义），按离镜头中心远近排序：
   * 用户不用"点得准"，直接在列表里选/删就行（v37.4：绿色灌木那种点不中的静态家具也能删）。 */
  function visibleFurniture() {
    var s = scene;
    if (!s || !s.placed || !s.cameras) return [];
    var vw = s.cameras.main.worldView, pad = 64;
    var out = [];
    s.placed.forEach(function (p) {
      if (!p || !p.f || !p.spr || !p.spr.active) return;
      if (p.x < vw.x - pad || p.x > vw.x + vw.width + pad) return;
      if (p.y < vw.y - pad || p.y > vw.y + vw.height + pad) return;
      out.push(p);
    });
    var cx = vw.x + vw.width / 2, cy = vw.y + vw.height / 2;
    out.sort(function (a, b) {
      return (Math.abs(a.x - cx) + Math.abs(a.y - cy)) - (Math.abs(b.x - cx) + Math.abs(b.y - cy));
    });
    return out.slice(0, 60);
  }
  function renderEditList() {
    var el = document.getElementById("edit-list");
    var cnt = document.getElementById("edit-count");
    if (cnt) cnt.textContent = String(customFurniture.filter(function (f) { return !isHideEntry(f); }).length);
    // hub 状态写清楚：旧版这里没有，用户只能靠"点了没反应"猜
    var hubEl = document.getElementById("edit-hub");
    if (hubEl) {
      var txt, color;
      if (hubMapOk === true) { txt = mirrorPending ? "hub 已连（有本机改动待同步）" : "hub 已连：改动会写进 map.custom.json"; color = "#8ce99a"; }
      else if (hubMapOk === false) { txt = "hub 未连接（" + (hubMapErr || "网络错误") + "）：改动只存本机浏览器"; color = "#ffc078"; }
      else { txt = "正在探测 hub…"; color = "#9aa3b8"; }
      hubEl.textContent = txt;
      hubEl.style.color = color;
    }
    var hidEl = document.getElementById("edit-hidden");
    var hidN = hiddenCount();
    if (hidEl) hidEl.style.display = hidN ? "block" : "none";
    var hidCnt = document.getElementById("edit-hidden-count");
    if (hidCnt) hidCnt.textContent = String(hidN);
    if (!el) return;

    var rows = visibleFurniture();
    var objCnt = document.getElementById("edit-obj-count");
    if (objCnt) objCnt.textContent = String(rows.length);
    el.innerHTML = rows.map(function (p) {
      var f = p.f;
      var key = furnitureKeyOf(f);
      var isCus = !!f._custom;
      var selCls = (editSelItem === p) ? " row-sel" : "";
      var ico = assetIconUrl(f.a, f.frame || 0);
      return '<div class="ep-row' + selCls + '" data-key="' + key + '">' +
        '<span class="ep-ico">' + (ico ? '<img src="' + ico + '" alt="" title="' + f.a + '">' : "▢") + "</span>" +
        '<span class="ep-name">' + f.a + '<i class="ep-tag' + (isCus ? " cus" : "") + '">' + (isCus ? "自建" : "静态") + "</i></span>" +
        '<span class="ep-pos">' + furniturePosText(p) + "</span>" +
        '<button class="ep-del" data-key="' + key + '" title="' + (isCus ? "删除" : "隐藏（可恢复）") + '">✕</button></div>';
    }).join("") || '<div style="color:#9aa3b8;padding:6px 2px">视口里没有物件</div>';

    // 点行 = 选中 + 镜头对准（比像素级点击可靠）
    [].forEach.call(el.querySelectorAll(".ep-row"), function (row) {
      row.onclick = function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest("button")) return;
        var key = row.dataset.key;
        var p = (scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
        if (!p) return;
        markEditSelection(p);
        focusOnPlacement(p);
        editToast("已选中 " + p.f.a + " @ " + p.f.x + "," + p.f.y);
      };
      row.onmouseenter = function () {
        var key = row.dataset.key;
        var p = (scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
        if (p) markEditSelection(p);
      };
    });
    // ✕ = 自定义删除 / 静态隐藏
    [].forEach.call(el.querySelectorAll("button.ep-del"), function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        var key = b.dataset.key;
        var p = (scene.placed || []).filter(function (q) { return q.f && furnitureKeyOf(q.f) === key; })[0];
        if (!p) return;
        if (p.f._custom) {
          if (editSelItem === p) clearEditSelection();
          saveEditMap(false, { action: "remove", item: { id: p.f.id } }, function (ok, err) {
            editToast(ok ? "已删除 " + p.f.a : "已在本机删除（hub 未同步：" + err + "）");
          });
        } else {
          hideStaticItem(p);
        }
      };
    });
  }











