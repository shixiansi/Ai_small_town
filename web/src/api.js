  /* ============ 调试工作台控制接口 ============
   * 由 web/debug.js 调用；线上不加载 debug.js 时零开销。
   * 只读诊断 + 本地事件注入 + 场景开关，不改动真实 agent 数据链路。
   */
  var gridOverlay = null;
  function frameAudit() {
    if (!scene || !scene.mapdata) return [];
    var bad = [];
    scene.mapdata.furniture.forEach(function (f) {
      if (f.frame == null || !f.a) return;
      var t = scene.textures.get(f.a);
      var total = t ? (t.frameTotal || 0) : 0;
      if (f.frame >= total) bad.push({ id: f.id || "", asset: f.a, frame: f.frame, frames: total });
    });
    return bad;
  }
  /* 区域锚点审计：把「状态 → zone → 实际落脚点 → 坐席宿主」整条链路摊开，
   * 用来抓「鱼说瘫在沙发上、人却站在两沙发中间」这类定位漂移。
   */
  function zoneAudit() {
    if (!scene || !scene.mapdata || !scene.grid) return null;
    var z = scene.mapdata.zones, hm = scene.hostMap || {};
    var issues = [], rows = [];
    // 家具语义位置表（含 computer/laptop 这类挂在 on 宿主上的小物，props 里已解析出真实坐标）
    var propTiles = (scene.props || []).filter(function (p) { return !p.isFish; }).map(function (p) {
      return { key: p.key, tx: (p.x - TILE / 2) / TILE, ty: (p.y - WALL_H - TILE / 2) / TILE };
    });
    Object.keys(z).forEach(function (name) {
      var zone = z[name], a = zone.anchor || [0, 0];
      var ex = Math.round(a[0]), ey = Math.round(a[1]);
      var oob = ex < 0 || ey < 0 || ex >= COLS || ey >= ROWS;
      if (oob && !zone.decorative) issues.push("区域 " + name + " 的目标格 [" + ex + "," + ey + "] 越出地图 " + COLS + "×" + ROWS + "，A* 会把鱼送出场外");
      var blocked = !!(scene.grid[ey] && scene.grid[ey][ex]);
      var reached = blocked ? nearestFree(ex, ey) : (oob ? null : { x: ex, y: ey });
      var free = [];
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
        var nx = ex + dx, ny = ey + dy;
        if (nx >= 1 && ny >= 1 && nx < COLS && ny < ROWS && !scene.grid[ny][nx]) free.push([nx, ny]);
      }
      var row = {
        zone: name, anchor: a, target: [ex, ey], blocked: blocked, oob: oob,
        reached: reached ? [reached.x, reached.y] : null, free: free,
        sit: null
      };
      // decorative 区域（如任务板）只用于摆放文字，不参与寻路
      if (blocked && !zone.decorative) issues.push("区域 " + name + " 的锚点落在阻挡格里，A* 会漂到 " + (reached ? reached.x + "," + reached.y : "无解"));
      if (!reached && !zone.decorative) issues.push("区域 " + name + " 周围 3 格内没有可走格");
      if (zone.sit) {
        var h = hm[zone.sit.host];
        if (!h) { issues.push("区域 " + name + " 的坐席宿主 " + zone.sit.host + " 不存在"); row.sit = { host: zone.sit.host, exists: false }; }
        else {
          var htx = (h.x - TILE / 2) / TILE, hty = (h.y - WALL_H - TILE / 2) / TILE;
          var d = Math.sqrt(Math.pow(htx - a[0], 2) + Math.pow(hty - a[1], 2));
          row.sit = { host: zone.sit.host, exists: true, hostTile: [Number(htx.toFixed(2)), Number(hty.toFixed(2))], dist: Number(d.toFixed(2)), dx: zone.sit.dx || 0, dy: zone.sit.dy || 0, lounge: !!zone.sit.lounge };
          if (d > 2.6) issues.push("区域 " + name + " 锚点距坐席 " + zone.sit.host + " " + d.toFixed(1) + " 格，落座 tween 会拉得很远");
        }
      }
      /* 语义校验：锚点必须真的落在「这个区域名字所指的家具」前面。
       * 旧版只查阻挡格，结果「发邮件」站在灶台果盘旁也叫 0 问题。 */
      if (zone.expect && zone.expect.length) {
        var found = [];
        zone.expect.forEach(function (asset) {
          var best = null;
          propTiles.forEach(function (p) {
            if (p.key !== asset) return;
            var pd = Math.sqrt(Math.pow(p.tx - a[0], 2) + Math.pow(p.ty - a[1], 2));
            if (!best || pd < best.d) best = { asset: asset, d: pd };
          });
          if (best) found.push(best);
        });
        var ok = found.some(function (m) { return m.d <= 2.2; });
        row.expect = { want: zone.expect, found: found.map(function (m) {
          return m.asset + "@" + m.d.toFixed(1) + "格";
        }), ok: ok };
        if (!ok) issues.push("区域 " + name + " 锚点 2.2 格内找不到期望家具 [" + zone.expect.join("/") + "]" +
          (found.length ? "（最近：" + found.map(function (m) { return m.asset + " " + m.d.toFixed(1) + "格"; }).join("、") + "）" : "（场景无此素材）"));
      } else if (zone.feature) {
        row.expect = { feature: zone.feature, exists: !!scene.mapdata[zone.feature] };
        if (!scene.mapdata[zone.feature]) issues.push("区域 " + name + " 的背景设施 " + zone.feature + " 未配置");
      }
      rows.push(row);
    });
    // 状态 → 区域 引用
    Object.keys(STATE_MAP).forEach(function (k) {
      if (!z[STATE_MAP[k].zone]) issues.push("状态 " + k + " 引用了不存在的区域 " + STATE_MAP[k].zone);
    });
    // 家具 on: 引用 + 重复/缺失 id
    var ids = Object.create(null);
    scene.mapdata.furniture.forEach(function (f) {
      if (f.id) { if (ids[f.id]) issues.push("家具 id 重复: " + f.id); ids[f.id] = 1; }
      if (f.on && !hm[f.on]) issues.push("家具 " + (f.id || f.a) + " 的 on 宿主 " + f.on + " 不存在");
    });
    // 状态 → 落点清单：让「每个状态该站在哪件家具前」可以被一次核对
    var states = Object.keys(STATE_MAP).map(function (k) {
      var cfg = STATE_MAP[k], zz = z[cfg.zone];
      return {
        state: k, verb: cfg.verb, zone: cfg.zone,
        label: zz ? (zz.label || cfg.zone) : "区域缺失",
        target: zz ? [Math.round(zz.anchor[0]), Math.round(zz.anchor[1])] : null,
        sit: !!(zz && zz.sit),
        expected: zz && zz.expect ? zz.expect : (zz && zz.feature ? [zz.feature] : [])
      };
    });
    return { zones: rows, issues: issues, frames: frameAudit(), states: states };
  }
  function toggleGrid(force) {
    if (!scene || !scene.grid) return false;
    if (gridOverlay && force !== true) { gridOverlay.destroy(); gridOverlay = null; return false; }
    if (gridOverlay) return true;
    var g = scene.add.graphics().setDepth(65000);   // 高于环境遮罩，调试层始终清晰
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        if (!scene.grid[y][x]) continue;
        g.fillStyle(0xff4d4f, 0.30);
        g.fillRect(x * TILE + 1, WALL_H + y * TILE + 1, TILE - 2, TILE - 2);
      }
    }
    Object.keys(scene.mapdata.zones).forEach(function (k) {
      var a = scene.mapdata.zones[k].anchor;
      g.fillStyle(0x4dabf7, 0.95);
      g.fillCircle((a[0] + 0.5) * TILE, WALL_H + (a[1] + 0.5) * TILE, 5);
    });
    gridOverlay = g;
    return true;
  }
  // 线上 Nginx 只反代 /office-ws/，没有 /api/event、/api/status：
  // 线上返回空串，调试台据此灰掉相关按钮，而不是让 fetch 打到博客主站后报一句误导性的 JSON 错误。
  function hubBase() {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(location.host)) return "";
    var p = new URLSearchParams(location.search).get("hub") || "4321";
    return "http://127.0.0.1:" + (/^\d{2,5}$/.test(p) ? p : "4321");
  }
  function hubFetch(p, opt) {
    var base = hubBase();
    if (!base) return Promise.reject(new Error("线上未开放 hub HTTP 接口（Nginx 只反代 /office-ws/）"));
    return fetch(base + p, opt);
  }
  Object.defineProperty(window, "__officeCtl", {
    value: {
      states: function () {
        return Object.keys(STATE_MAP).map(function (k) {
          return { id: k, verb: STATE_MAP[k].verb, zone: STATE_MAP[k].zone, mood: STATE_MAP[k].mood };
        });
      },
      hubStatus: function () { return hubFetch("/api/status").then(function (r) { return r.json(); }); },
      hubBase: hubBase,
      zones: function () { return scene && scene.mapdata ? Object.keys(scene.mapdata.zones) : []; },
      rooms: function () { return ROOMS.map(function (r) { return r.id; }); },
      emit: function (state, task, detail, zone) {
        onState({ state: state, task: task || "", detail: detail || "", ts: Date.now() }, zone, true);
        return true;
      },
      pushHub: function (state, task, detail) {
        return hubFetch("/api/event", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: state, task: task || "", detail: detail || "" })
        });
      },
      setLights: function (on) {
        if (!scene) return false;
        lightsManual = true;
        setLights(scene, !!on);
        if (scene.switchLever && scene.switchY != null) scene.switchLever.y = scene.switchY + (on ? -4 : 4);
        return lightsOn;
      },
      setWeather: function (w) { if (!scene) return false; setWeather(scene, w === "rainy" ? "rainy" : "sunny"); return weather; },
      /* 道路层开关（v36）：debug 台按钮用；返回当前可见性 */
      toggleRoads: function () { return toggleRoads(); },
      roadsVisible: function () { return roadsVisible; },
      /* 农场诊断 + 直接触发农活（调试/走查用）：act = till|water|sow|feed|harvest */
      farm: function () { return farmSummary(); },
      farmAct: function (act, slot) { return farmAct(act, slot); },
      farmGrowAll: function () {           // 调试：把所有已种作物直接催熟（走查收割用）
        if (!farm) farmLoad();
        farm.plots.forEach(function (p) { if (p.crop) { p.progress = 1; p.watered = true; } });
        farmSave(); drawFarm();
        return farmSummary();
      },
      /* 钓鱼诊断/走查：抛竿 → 直接咬钩 → 起竿（正常游玩请点鱼塘） */
      pond: function () { return { fishing: !!fishing, bite: !!(fishing && fishing.bite), fish: farm ? farm.fish : 0, shadows: fishShadows.length }; },
      fishOnce: function () {
        if (!fishing) fishStart();
        if (fishing && !fishing.bite) { fishing.t = fishing.wait; fishTick(0.01); }
        return fishReel();
      },
      /* 料理诊断：kitchen() 看食材/菜谱，cook(id) 做指定菜，cookAuto() 自动做一道 */
      kitchen: kitchenSummary,
      cook: cook,
      cookAuto: function () { var t = cookAuto(); if (t) renderCookPanel(); return t || "（食材不够）"; },
      /* 地图编辑器（v37）：开关 + 状态 + 手动拉取 hub 自定义层 */
      setEditMode: function (on) { return setEditMode(on); },
      editState: function () {
        var realCount = customFurniture.filter(function (f) { return !isHideEntry(f); }).length;
        return {
          on: editMode, tool: editTool, asset: editAsset, count: realCount,
          hidden: hiddenCount(),
          hub: hubMapOk === true,          // 真实连通性（旧版是 !!hubMapBase()，恒为 true，会撒谎）
          hubChecked: hubMapOk, hubError: hubMapErr,
          mirror: mirrorPending,           // 有改动还没写进 hub
          ws: !!ws && ws.readyState === 1,
          mapUrl: hubMapUrl()
        };
      },
      editSetTool: function (t) { setEditTool(t); return editTool; },
      editSetAsset: function (a) { setEditAsset(a); return editAsset; },
      editSave: function () { saveEditMap(false, null, function (ok, err) { addEditLog(ok ? "已保存" : "hub 未同步：" + err); }); return true; },
      mapReload: function () {
        probeMapHub(function (ok, j) {
          if (ok) { mirrorFlushTried = false; applyCustomMap((j && j.furniture) || [], true); }
        });
        return true;
      },
      /* 视角（v36）：邻居视角导航 / 自由拖动 */
      neighborRooms: function () { return NEIGHBOR_HOMES.map(function (h) { return { id: "nb-" + h.id, home: h.home, cx: h.cx, cy: h.cy }; }); },
      gotoNeighbor: function (id) {
        var b = document.querySelector('.room-tab[data-room="nb-' + id + '"]');
        if (b) { b.click(); return true; }
        return false;
      },
      camDrag: function (on) {
        var b = document.getElementById("cam-drag-btn");
        if (!b) return camDragOn;
        if (typeof on === "boolean" && on !== camDragOn) b.click();
        return camDragOn;
      },
      gotoRoom: function (id) {
        var b = document.querySelector('.room-tab[data-room="' + id + '"]');
        if (b) { b.click(); return true; }
        return false;
      },
      // 调试：强制弹某物品的信息卡（hostId 如 wardA/townWell）
      showCard: function (hostId) { if (scene) { showInfoCard(hostId, 300, 200); return !!INFO_CARDS[hostId]; } return false; },
      // 按 key 直接触发一条本地生活行为（不经过 hub），调试台与自动走查都用它
      localAct: function (key, instant) {
        var e = findLocalEvent(key);
        if (!e || !scene || !fish) return false;
        stopIdleLife(); unsit(); exitNeighborHome();
        noteLocalEvent(e.key);
        goLocal(e.zone, localText(e), e.act, e.face, !!instant, statFillFor(e.key));
        startIdleLife(9000);
        return true;
      },
      localEvents: function () {
        return LOCAL_EVENTS.map(function (e) {
          return { key: e.key, zone: e.zone, label: e.label, icon: e.icon,
            text: e.text, act: e.act, face: e.face, room: e.room };
        });
      },
      setWs: function (url) { reconnectWS(url); return getWsUrl(); },
      wsUrl: function () { return getWsUrl(); },
      toggleGrid: toggleGrid,
      frameAudit: frameAudit,
      zoneAudit: zoneAudit,
      gridMap: function () {
        return scene && scene.grid ? scene.grid.map(function (r) {
          return r.map(function (v) { return v ? 1 : 0; });
        }) : null;
      },
      resetEvidence: function () {
        try { localStorage.removeItem("office_evidence"); } catch (e) {}
        evidence.done = 0; evidence.current = ""; evidence.lastTask = "";
        redrawBoard(); refreshTrophies();
        return true;
      },
      /* 最近动态窗的只读诊断 + 两个开关：自动走查靠它断言「事件流真的进来了」「时间表现在属于哪一班」 */
      activity: function () {
        var groups = shiftsToday(), cur = currentShift(groups);
        return {
          rows: actRows.slice(),
          current: { state: actCur.state, task: actCur.task, at: actCur.at },
          tab: actTab, folded: actFolded,
          dom: {
            list: document.querySelectorAll("#act-list li").length,
            plan: document.querySelectorAll("#act-plan li").length
          },
          now: bjClock(Date.now()),
          activeShift: cur.active ? shiftName(cur.active) : null,
          nextShift: cur.next ? shiftName(cur.next) : null,
          why: (document.getElementById("act-why") || {}).innerText || ""
        };
      },
      schedule: function () {
        var groups = shiftsToday(), cur = currentShift(groups);
        return {
          tz: SCHEDULE.tz, wake: SCHEDULE.wake, now: bjClock(Date.now()),
          groups: groups, active: cur.active ? shiftName(cur.active) : null, next: cur.next ? shiftName(cur.next) : null
        };
      },
      resetActivity: function () {
        try { localStorage.removeItem(ACT_STORE); } catch (e) {}
        actRows = []; actCur = { state: "", task: "", at: 0 };
        renderEvents(); renderPlan();
        return true;
      },
      setActivityTab: function (which) { actSetTab(which); return actTab; },
      foldActivity: function (folded) { actSetFold(folded !== false); return actFolded; },
      screenshot: function () {
        var c = document.querySelector("#office-parent canvas");
        return c ? c.toDataURL("image/png") : null;
      },
      snapshot: function () {
        var c = document.querySelector("#office-parent canvas");
        return {
          ready: !!scene,
          fishState: fishState,
          visiting: visitingHome ? visitingHome.id : null,   // 正在串门哪户（调试走查用）
          localEvent: lastLocalKey,
          fish: fish ? { x: Math.round(fish.x), y: Math.round(fish.y), face: fish.lastFace, sitting: !!fish.sitting } : null,
          sprite: fish && fish.bodySpr ? {
            anim: fish.bodySpr.anims.currentAnim ? fish.bodySpr.anims.currentAnim.key : null,
            frame: fish.bodySpr.frame.name,
            angle: fish.bodySpr.angle,
            scale: [Number(fish.bodySpr.scaleX.toFixed(2)), Number(fish.bodySpr.scaleY.toFixed(2))]
          } : null,
          lightsOn: lightsOn, lightsManual: lightsManual, ambient: Number(ambientCur.toFixed(2)), weather: weather,
          ws: { url: getWsUrl(), readyState: ws ? ws.readyState : -1 },
          fps: scene ? Math.round(scene.game.loop.actualFps) : 0,
          props: scene ? scene.props.length : 0,
          assets: MAN ? Object.keys(MAN).length : 0,
          blocked: scene && scene.grid ? scene.grid.flat().filter(Boolean).length : 0,
          evidence: { done: evidence.done, current: evidence.current },
          activity: { rows: actRows.length, state: actCur.state, tab: actTab, folded: actFolded },
          camera: scene ? { scrollX: scene.cameras.main.scrollX, scrollY: scene.cameras.main.scrollY, zoom: scene.cameras.main.zoom } : null,
          statusbar: document.querySelector(".statusbar") ? document.querySelector(".statusbar").innerText.replace(/\s+/g, " ").trim() : "",
          bubble: bubbleText ? bubbleText.text : null,
          canvas: c ? { w: c.width, h: c.height, cssW: Math.round(c.getBoundingClientRect().width) } : null,
          farm: farmSummary(),
          fishing: fishing ? { bite: fishing.bite, t: Number(fishing.t.toFixed(1)) } : null,
          roads: roadsVisible,
          camDrag: camDragOn,
          edit: { on: editMode, tool: editTool, asset: editAsset, count: customFurniture.length, hub: hubMapOk, hubError: hubMapErr, mirror: mirrorPending },
          frameIssues: frameAudit(),
          gridOverlay: !!gridOverlay
        };
      }
    }
  });
})();



