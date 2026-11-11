  // ---------- 主循环 ----------
  var pondTickAcc = 0, farmTickAcc = 0;
  var s_baseGuard = null;   // v36：地板层自愈哨兵（scene 引用）
  function update(time, delta) {
    if (scene && rainParts.length) tickWeather(scene);
    if (!scene || !fish) return;
    updateAmbient(scene);
    depthSort();   // 只做一次 setDepth，不会抛错，无需每帧 try/catch
    try {
      if (fishState === "walking") stepWalk();
    } catch (e) { console.error("stepWalk:", e.message); }
    if (fishState === "walking") {
      // 走路小颠簸：作用于 body 的局部 y 偏移（由 stopActAnim 复位）
      fish.bodySpr.setY(fish.baseY + Math.sin(time / 90) * 1.2);
      fish.bodySpr.setAngle(0);
    }
    if (bubble) bubble.setPosition(fish.x + bubbleOff.x, fish.y + bubbleOff.y);
    // v36 兜底：地板层被任何代码意外隐藏/摘除时，下一帧自动恢复（防整屏变背景色的回归）
    if (s_baseGuard && s_baseGuard !== scene) s_baseGuard = null;
    if (!s_baseGuard && scene && scene.baseGfx && scene.baseGfx._isBaseGfx) s_baseGuard = scene;
    if (s_baseGuard && (!s_baseGuard.baseGfx.visible || !s_baseGuard.children.list.includes(s_baseGuard.baseGfx))) {
      s_baseGuard.baseGfx.setVisible(true);
      if (!s_baseGuard.children.list.includes(s_baseGuard.baseGfx)) s_baseGuard.children.add(s_baseGuard.baseGfx);
    }
    // 农场/鱼塘 tick（v36）：鱼影每帧游动；钓鱼进度 / 作物生长按真实毫秒累计
    tickPondLife();
    if (fishing) { fishTick(Math.min(delta || 16, 50) / 1000); if (fishing && fishing.bobber) fishing.bobber.setDepth(4); }
    farmTickAcc += (delta || 16);
    if (farmTickAcc >= 30000) { farmTickAcc = 0; farmTick(); }
    // 编辑模式：镜头挪过就刷一次物件列表（视野变了列表要跟着变），400ms 节流免得太频繁
    if (editMode && scene.cameras && now0() - lastListRefreshAt > 400) {
      var vw0 = scene.cameras.main.worldView;
      if (Math.abs(vw0.x - lastListVX) > 24 || Math.abs(vw0.y - lastListVY) > 24) {
        lastListVX = vw0.x; lastListVY = vw0.y; lastListRefreshAt = now0();
        renderEditList();
      }
    }
  }
  var lastListVX = -1e9, lastListVY = -1e9, lastListRefreshAt = 0;
  function now0() { return (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now(); }

  /* P3.1：点鱼弹「最近在忙什么」——复用 #info-card 的样式，列最近 5 条真实事件 */
  function showFishActivityCard() {
    var card = document.getElementById("info-card");
    if (!card || typeof actRows === "undefined") return;
    var rows = actRows.slice(-5).reverse();
    var html = '<div class="ic-name">🐟 大肥鱼</div>';
    if (actCur && actCur.state) {
      html += '<div class="ic-desc">此刻：<b>' + escHtml(actCur.task || "（无任务名）") + "</b></div>";
    }
    if (rows.length) {
      html += '<div style="margin-top:4px">' + rows.map(function (r) {
        var cfg = STATE_MAP[r.state] || STATE_MAP.idle;
        return '<div style="font-size:12px;color:#aab4c8;margin:2px 0">' + (ACT_ICON[r.state] || "🐟") +
          " " + escHtml(r.task || cfg.verb) + ' <span style="opacity:.6">' + agoText(r.at) + "</span></div>";
      }).join("") + "</div>";
    } else {
      html += '<div class="ic-desc">最近没有真实事件，自己在小镇里过日子</div>';
    }
    html += '<div class="ic-hint">点别处继续 · 事件来自 hub</div>';
    // 弹在鱼头顶（转屏幕坐标）
    var cam = scene.cameras.main;
    var sx = (fish.x - cam.scrollX) * cam.zoom, sy = (fish.y - cam.scrollY) * cam.zoom;
    card.innerHTML = html;
    card.style.left = Math.max(6, Math.min(sx - 120, card.parentElement.clientWidth - 280)) + "px";
    card.style.top = Math.max(6, sy - 170) + "px";
    card.classList.add("show");
    clearTimeout(showFishActivityCard._t);
    showFishActivityCard._t = setTimeout(function () { card.classList.remove("show"); }, 4200);
  }

  // ---------- 点击 ----------
  var lastPointer = null;   // 调试探针：最近一次点击的世界坐标（__office.lastPointer）
  function bindClick(s) {
    s.input.on("pointerdown", function (p) {
      lastPointer = { wx: Math.round(p.worldX), wy: Math.round(p.worldY), sx: Math.round(p.x), sy: Math.round(p.y) };
      // 编辑模式（v37）：点击语义整体切到 放置/移动/删除
      // 编辑模式：独立编辑器（三层）优先，其次才是游戏内的小编辑器
      if (p.rightButtonDown && p.rightButtonDown()) return;   // v48：右键只用来平移视角
      if (editMode && editorMode && mapEditorPointerDown(p.worldX, p.worldY, p)) return;
      if (editMode && editPointerDown(p.worldX, p.worldY, p)) return;
      // 拖动视角刚结束：这次"抬起"不该当成一次点击（拖完镜头的余误触）
      if (Date.now() < camDragSuppress) { camDragSuppress = 0; return; }
      // v50：墙上的灯开关 —— 放在最前面，鱼在忙/钓鱼之外也能点
      if (toggleSwitchAt(p.worldX, p.worldY)) return;
      // 钓鱼中：任何一次点击都是「起竿」（咬钩窗口内 = 成功，否则脱钩）
      if (fishing) {
        var rr = fishReel();
        showBubble(rr.text, rr.ok ? "idle" : "error");
        return;
      }
      // P3.1：点大肥鱼本鱼 = 弹「最近在忙什么」信息卡（读最近事件流水，5 条）
      var fw = 40, fh = 44;   // 鱼身命中盒（世界像素），比精灵显示宽略小防误触
      if (Math.abs(p.worldX - fish.x) < fw / 2 && p.worldY > fish.y - fh && p.worldY < fish.y + 10) {
        showFishActivityCard();
        return;
      }
      var gx = px2tx(p.worldX), gy = px2ty(p.worldY);
      if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) return;
      if (fishState === "acting" && curPlan && !curPlan.local) return;
      // 点邻居房屋 = 进屋串门（优先级最高：用房屋精灵的整块包围盒判定，房子大不怕点偏）
      var homeHit = null;
      NEIGHBOR_HOMES.forEach(function (h) {
        var hp = s.hostMap[h.home];
        if (!hp || !hp.spr) return;
        var dw = hp.spr.displayWidth || 48, dh = hp.spr.displayHeight || 48;
        if (p.worldX > hp.x - dw / 2 - 12 && p.worldX < hp.x + dw / 2 + 12 &&
            p.worldY > hp.y - dh - 12 && p.worldY < hp.y + 14) homeHit = h;
      });
      if (homeHit) {
        if (visitingHome === homeHit) {
          // 已经在这家里：再点 = 出屋（走出门，镜头回小镇）
          var zdOut = s.mapdata.zones[homeHit.door];
          exitNeighborHome();
          if (zdOut) walkLocalTo(Math.round(zdOut.anchor[0]), Math.round(zdOut.anchor[1]), null);
          return;
        }
        if (enterNeighborHome(s, homeHit)) return;
      }
      // 农场/鱼塘热点（v36）：点田地 = 对应农活，点塘面/栈道 = 钓鱼（优先于家具热点，田地里没有家具）
      var farmHit = null, pondHit = false;
      if (farm && !fishing) {
        for (var pi = 0; pi < farm.plots.length; pi++) {
          var pt = plotTile(pi);
          var pcx = pt.x * TILE + TILE / 2, pcy = WALL_H + pt.y * TILE + TILE / 2;
          if (Math.abs(p.worldX - pcx) < TILE * 0.75 && Math.abs(p.worldY - pcy) < TILE * 0.75) {
            var pl = farm.plots[pi];
            var actF = !pl.soil ? "till" : (!pl.crop ? "sow" : (pl.progress >= 1 ? "harvest" : (!pl.watered ? "water" : (!pl.fed ? "feed" : "harvest"))));
            farmHit = { slot: pi, act: actF };
            farmHit.verb = { till: "锄地", sow: "播种", water: "浇水", feed: "施肥", harvest: "收割" }[actF];
            break;
          }
        }
      }
      if (!farmHit && p.worldY > WALL_H + (POND.y0 - 0.9) * TILE && p.worldY < WALL_H + (POND.y1 + 0.6) * TILE &&
          p.worldX > (POND.x0 - 1.2) * TILE && p.worldX < (POND.x1 + 0.5) * TILE) pondHit = true;
      if (farmHit || pondHit) {
        var gxf = farmHit ? 30 : 34, gyf = farmHit ? 27 : 24;   // 田边过道 / 塘西栈道旁
        var pathF = astar(px2tx(fish.x), px2ty(fish.y), gxf, gyf);
        if (pathF) {
          stopIdleLife();
          unsit();
          var verbF = pondHit ? "钓鱼" : farmHit.verb;
          curPlan = {
            path: pathF, i: 0, local: true, st: null,
            cfg: { act: pondHit ? "idle_reach" : "idle_farm", mood: "idle" },
            task: verbF, bubbleText: verbF, face: pondHit ? "e" : "n", zone: null,
            statFill: null, farmJob: farmHit ? farmHit.act : null, farmSlot: farmHit ? farmHit.slot : null,
            pond: pondHit
          };
          fishState = "walking";
          showBubble(verbF, "idle");
          startIdleLife(12000);
          return;
        }
      }
      // 干预点：家具本身就在阻挡格里，必须先判热点再判 grid，否则永远点不中
      var hotspots = [
        { host: "gramoA",  state: "listening", verb: "听音乐" },
        { host: "arcadeA", state: "gaming",    verb: "打游戏" },
        { host: "bedA",    state: "sleeping", verb: "躺一会儿" },
        { host: "fridgeA", state: "snacking",  verb: "找吃的" },
        { host: "stoveA",  state: "eating",    verb: "做饭吃" },
        { host: "benchA",  state: "strolling", verb: "坐下歇会" },
        { host: "rechargeA", state: "recovering", verb: "充电恢复" },
        { host: "armA",    state: "relaxing",  verb: "放松一下" },
        { host: "sofaA",   state: "idle",      verb: "瘫一会儿" }
      ];
      // 触摸目标：把「屏幕直径 ≥44px」换算回世界像素。375px 视口下画布缩到约 0.28 倍，
      // 固定 TILE*0.9 只有约 22 CSS px，手指基本点不中；放大后按最近优先，避免误触相邻家具。
      var cssW = s.game.canvas.getBoundingClientRect().width;
      var gameW = (s.scale && s.scale.gameSize && s.scale.gameSize.width) || s.game.canvas.width;
      var cssPerWorld = gameW > 0 ? cssW / gameW : 1;
      var radius = Math.min(Math.max(TILE * 0.9, 22 / (cssPerWorld || 1)), TILE * 1.8);
      // 信息卡与行为解耦：任何 INFO_CARDS 登记的物品点击都弹介绍卡（用户报"点物品看不到介绍"，
      // 旧版只有 9 件 hotspots 能弹，衣柜/书架/水井/住宅等 10 件点了没反应）；鱼的行为仍由 hotspots 决定
      var bestCard = null, bestCardD = Infinity;
      for (var hostId in INFO_CARDS) {
        var hp0 = s.hostMap[hostId];
        if (!hp0) continue;
        var d0 = Math.max(Math.abs(hp0.x - p.worldX), Math.abs(hp0.y - p.worldY));
        if (d0 < radius && d0 < bestCardD) { bestCardD = d0; bestCard = hostId; }
      }
      var cardOnly = false;   // 点的是"只能看"的物品（无行为）
      if (bestCard) {
        var rectC = s.game.canvas.getBoundingClientRect();
        var gwC = (s.scale && s.scale.gameSize && s.scale.gameSize.width) || s.game.canvas.width;
        var ghC = (s.scale && s.scale.gameSize && s.scale.gameSize.height) || s.game.canvas.height;
        showInfoCard(bestCard, (p.worldX - s.cameras.main.scrollX) * (rectC.width / gwC), (p.worldY - s.cameras.main.scrollY) * (rectC.height / ghC));
      }
      var best = null, bestD = Infinity;
      for (var hi = 0; hi < hotspots.length; hi++) {
        var hp = s.hostMap[hotspots[hi].host];
        if (!hp) continue;
        var d = Math.max(Math.abs(hp.x - p.worldX), Math.abs(hp.y - p.worldY));
        if (d < radius && d < bestD) { bestD = d; best = hotspots[hi]; }
      }
      if (best) {
        var zc = { listening: "relax", gaming: "arcade", sleeping: "bed", snacking: "fridge",
                   eating: "cook", strolling: "garden", recovering: "recover", relaxing: "relax",
                   idle: "sofa" }[best.state];
        var z = s.mapdata.zones[zc];
        if (!z) return;
        var ex2 = Math.round(z.anchor[0]), ey2 = Math.round(z.anchor[1]);
        var path2 = astar(px2tx(fish.x), px2ty(fish.y), ex2, ey2);  // 旧版误把 fish.y 传给了 px2tx
        if (!path2) path2 = [{ x: ex2, y: ey2 }];
        stopIdleLife();
        unsit();
        var cfg2 = STATE_MAP[best.state] || STATE_MAP.idle;
        curPlan = { path: path2, i: 0, local: true, cfg: cfg2, task: best.verb, face: z.face || "s", zone: z };
        // 点灶台/料理台 = 进料理流程（v36）：到达后自动做一道能做的菜
        if (best.state === "eating") curPlan.cookJob = true;
        fishState = "walking";
        showBubble(best.verb, "idle");
        startIdleLife(6000);
        return;
      }
      // 点的是"只能看"的物品 → 鱼走过去旁边站定看一眼（信息卡已在上方弹出）
      if (bestCard) {
        var hpLook = s.hostMap[bestCard];
        var canAct = false;
        for (var hk = 0; hk < hotspots.length; hk++) if (hotspots[hk].host === bestCard) { canAct = true; break; }
        if (!canAct && hpLook) {
          // 走到物品附近一格（取物品下方一格，找可走点）
          var lookGx = Math.round(hpLook.x / TILE), lookGy = Math.round((hpLook.y - WALL_H) / TILE) + 1;
          var spot2 = null;
          for (var off = 0; off <= 2 && !spot2; off++) {
            [[0, off], [0, -off], [off, 0], [-off, 0]].forEach(function (o2) {
              var cx2 = lookGx + o2[0], cy2 = lookGy + o2[1];
              if (!spot2 && cx2 >= 0 && cy2 >= 0 && cx2 < COLS && cy2 < ROWS && s.grid[cy2] && !s.grid[cy2][cx2]) spot2 = { x: cx2, y: cy2 };
            });
          }
          if (spot2) {
            var path3 = astar(px2tx(fish.x), px2ty(fish.y), spot2.x, spot2.y);
            if (path3 && path3.length >= 2) {
              stopIdleLife();
              unsit();
              curPlan = { path: path3, i: 0, local: true, st: null, cfg: { act: "idle", mood: "idle" }, task: "看看" + INFO_CARDS[bestCard].name, bubbleText: null, face: "s" };
              fishState = "walking";
              startIdleLife(4000);
              return;
            }
          }
          return;   // 走不过去也只看卡，不落回普通走位
        }
      }
      if (s.grid[gy][gx] && !editMode) return;   // 普通走位只允许点可走格
      var path = astar(px2tx(fish.x), px2ty(fish.y), gx, gy);
      if (!path || path.length < 2) return;
      stopIdleLife();
      unsit();
      curPlan = { path: path, i: 0, local: true, st: null, cfg: { act: "idle", mood: "idle" }, task: "", bubbleText: null, face: "s" };
      fishState = "walking";
      hideBubble();
      startIdleLife(3000);
    });
  }
