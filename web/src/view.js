  // ---------- 房间切换 UI（场景清单缺口 #8：玩家干预点与房间切换） ----------
  /* 一房一屏（评审 P0-2）：每个停靠点视口只装一个房间 */
  var ROOMS = [
    { id: "office",  label: "办公室", cx: 13 * TILE, cy: 23.5 * TILE },
    { id: "bedroom", label: "起居",   cx: 13 * TILE, cy: 7 * TILE },    // 北排整排（卧室+卫浴+厨房）
    { id: "garden",  label: "花园",   cx: 32 * TILE, cy: 15 * TILE },
    { id: "town",    label: "小镇",   cx: 47 * TILE, cy: 15 * TILE }
  ];
  // —— 邻居家（点击房屋进屋串门）——
  /* map.json 南排 rows19-28 已布好三户室内：家具/墙体/门洞/锚点。
   * 每户：home=门外遮挡层 id、door=敲门 zone、living=屋内落点 zone。
   * host 返回 NPCS 里的居民 id（或 null=空屋）。 */
  /* v75：按新地图重新定位 —— cx/cy 用各自 living zone 的锚点（南排室内中心），
   * 不再用旧的 43/48/53 × 24 固定值。房子本体在 map.json 里 y=19.6（室内正上方）。 */
  var NEIGHBOR_HOMES = [
    { id: "cat",   home: "homeCat",   door: "doorCat",   living: "living_cat",   cx: 42.4 * TILE, cy: WALL_H + 23.2 * TILE, zm: 1.25 },
    { id: "chief", home: "homeChief", door: "doorChief", living: "living_chief", cx: 48.5 * TILE, cy: WALL_H + 23.6 * TILE, zm: 1.25 },
    { id: "doc",   home: "homeDoc",   door: "doorDoc",   living: "living_doc",   cx: 53.0 * TILE, cy: WALL_H + 24.0 * TILE, zm: 1.25 }
  ];
  function npcHomeState(npcId) {
    for (var i = 0; i < npcLayer.length; i++) {
      if (npcLayer[i].def.id !== npcId) continue;
      var npc = npcLayer[i];
      return (npc.state === "home" || npc.indoor) ? "home" : "out";
    }
    return "out";
  }
  /* 点房进屋：不是瞬移——鱼先走到那家门口敲门（门上浮现 ❢），镜头再推进屋里，
   * 主人在家时头顶冒一句欢迎语；不在家就是空屋。再点一次房屋 / 切房间 / 点跟随 = 出屋。 */
  var visitingHome = null;     // 正在串门的 NEIGHBOR_HOMES 项
  var visitSitCount = 0;       // 在屋里已小坐的轮数（坐满两轮自己出门回家）
  function enterNeighborHome(s, h) {
    var zDoor = s.mapdata.zones[h.door], zLiving = s.mapdata.zones[h.living];
    if (!zDoor || !zLiving) return false;
    stopIdleLife();
    unsit();
    hideBubble();
    hidePerfPanel();
    var npcId = h.id;
    var isHome = npcHomeState(npcId) === "home";
    var verb = isHome ? "敲" + (INFO_CARDS[h.home] || {}).name + "的门" : "去" + (INFO_CARDS[h.home] || {}).name + "看看";
    var path = astar(px2tx(fish.x), px2ty(fish.y), Math.round(zDoor.anchor[0]), Math.round(zDoor.anchor[1]));
    if (!path) return false;
    curPlan = {
      path: path, i: 0, local: true, st: null,
      cfg: { act: "idle_wave", mood: "idle" },
      task: verb, bubbleText: isHome ? "咚咚咚——有人在家吗？" : "（门没锁，自己进去看看）",
      face: "s", zone: null, statFill: null,
      visit: { home: h, living: zLiving, isHome: isHome }
    };
    fishState = "walking";
    showBubble(curPlan.bubbleText, "idle");
    postStatDelta(isHome ? { social: 6 } : { social: 2 });
    renderStatsBar();
    return true;
  }
  function arriveVisit() {
    var v = curPlan.visit, h = v.home;
    visitingHome = h;
    fishState = "acting";        // 收掉 walking：否则 stepWalk 每帧重新 arriveAct→arriveVisit
    hideBubble();                // 敲门气泡完成使命，进屋后换主人的欢迎语
    var thisPlan = curPlan;      // 进屋演出 ~2.6s 后回到 idle（idleStep 的串门小坐分支接管）
    setTimeout(function () {
      if (curPlan === thisPlan && fishState === "acting") { fishState = "idle"; }
    }, 2600);
    // 门上 ❢ 提示（敲门瞬间）
    var hp = scene.hostMap[h.home];
    if (hp) {
      var mark = scene.add.text(hp.x, hp.y - hp.bbox[3] - 6, "❢", { fontSize: "18px", color: "#ffd43b" })
        .setOrigin(0.5).setDepth(hp.footY + 30);
      scene.tweens.add({ targets: mark, y: mark.y - 12, alpha: 0, duration: 1400, onComplete: function () { mark.destroy(); } });
    }
    // 鱼进屋：放在屋内锚点（穿越门洞的一瞬不逐格演，镜头剪切补足）
    fish.x = v.living.anchor[0] * TILE + TILE / 2;
    fish.y = WALL_H + v.living.anchor[1] * TILE + TILE / 2;
    fish.setDepth(fish.y);
    fish.face(v.living.face || "s");
    fish.still();
    // 镜头推进屋里（zoom 1.25 与小镇停靠一致），并短暂停留
    var cam = scene.cameras.main;
    cam.stopFollow();
    cam.setZoom(h.zm);
    cam.pan(h.cx, h.cy, 700);
    cam.once("camerapancomplete", function () {
      if (visitingHome === h) scene.time.delayedCall(1600, function () {
        if (visitingHome === h) cam.startFollow(fish, true, 0.08, 0.08);
      });
    });
    // 主人在家 → 欢迎气泡（复用 NPC 对话池按时段抽一句）
    if (v.isHome) {
      var npc = null;
      for (var i = 0; i < npcLayer.length; i++) if (npcLayer[i].def.id === h.id) npc = npcLayer[i];
      if (npc) {
        var bucket = npcHourBucket();
        var pool = (NPC_DIALOGS[npc.def.id] || {})[bucket] || ["…"];
        var line = pool[Math.floor(Math.random() * pool.length)];
        var bub = scene.add.text(fish.x, fish.y - 58, (npc.def.name + "：「" + line + "」"), {
          fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
          fontSize: "15px", color: "#151826", backgroundColor: "#fffdf8ee",
          padding: { x: 8, y: 5 }, align: "center", wordWrap: { width: 230 }
        }).setOrigin(0.5, 1).setDepth(94000);
        bub.setAlpha(0);
        scene.tweens.add({ targets: bub, alpha: 1, duration: 250, delay: 500 });
        scene.tweens.add({ targets: bub, alpha: 0, duration: 500, delay: 3400, onComplete: function () { bub.destroy(); } });
      }
    }
    lastNpcChat = Date.now();
    visitSitCount = 0;
    startIdleLife(11000 + Math.random() * 7000);   // 小坐一阵再继续过日子（真实事件来了仍会被叫走）
  }
  function exitNeighborHome() {
    if (!visitingHome) return;
    visitingHome = null;
    if (scene) {
      var cam = scene.cameras.main;
      cam.stopFollow();
      cam.setZoom(1.25);                 // 出屋先回到小镇停靠视角，再交给后续逻辑
      cam.pan(47 * TILE, 15 * TILE, 600);
    }
  }
  function buildRoomTabs(s) {
    var bar = document.getElementById("room-tabs");
    if (!bar) return;
    bar.innerHTML = "";
    ROOMS.forEach(function (r) {
      var b = document.createElement("button");
      b.className = "room-tab";
      b.type = "button";
      b.dataset.room = r.id;
      b.title = "把镜头移到" + r.label;
      b.setAttribute("aria-label", "切换到" + r.label);
      b.setAttribute("aria-pressed", "false");
      b.textContent = r.label;
      b.onclick = function () {
        // 平移相机到房间中心（不改鱼的位置——鱼按自己的作息走）
        exitNeighborHome();   // 从邻居屋里出来：切房间即退出串门视角
        var cam = s.cameras.main;
        cam.stopFollow();   // 统一 pan 停靠（评审 #8：办公室 tab 跟随鱼曾把用户带到花园）；要看鱼另点"跟随"按钮
        var zm = (r.id === "garden" || r.id === "town") ? 1.25 : 1;   // 窄区 zoom 补边界（评审 #9）
        cam.setZoom(zm);
        cam.pan(r.cx, r.cy || H / 2, 600);
        [].forEach.call(bar.children, function (c) {
          c.classList.remove("active");
          c.setAttribute("aria-pressed", "false");
        });
        b.classList.add("active");
        b.setAttribute("aria-pressed", "true");
      };
      bar.appendChild(b);
    });
    // 邻居视角导航（v36）：三户邻居各一个 tab，点了一下解锁拖动/缩放后可环视邻居屋内外
    NEIGHBOR_HOMES.forEach(function (h) {
      var nb = document.createElement("button");
      nb.className = "room-tab";
      nb.type = "button";
      nb.dataset.room = "nb-" + h.id;
      nb.title = "把镜头移到" + (INFO_CARDS[h.home] || {}).name + "门口（再拖动可环视）";
      nb.setAttribute("aria-label", "视角移动到邻居家：" + (INFO_CARDS[h.home] || {}).name);
      nb.textContent = (INFO_CARDS[h.home] || {}).name || h.id;
      nb.onclick = function () {
        exitNeighborHome();
        camDragOn = false;   // 切换停靠视角时退出拖动模式
        var cam = s.cameras.main;
        cam.stopFollow();
        cam.setZoom(1.4);
        cam.pan(h.cx, h.cy - 2 * TILE, 600);
        syncTabActive(nb);
        nb.classList.add("active");
      };
      bar.appendChild(nb);
    });
    // 跟随鱼按钮（评审 #8：tab 改固定停靠后，"看鱼去哪"变成显式动作）
    var fb = document.createElement("button");
    fb.className = "room-tab";
    fb.textContent = "🐟跟随";
    fb.title = "镜头回到 AI 身上";
    fb.onclick = function () {
      exitNeighborHome();
      camDragOn = false;
      var cam = s.cameras.main;
      cam.stopFollow(); cam.startFollow(fish, true, 0.08, 0.08); cam.setZoom(1);
      syncTabActive(fb);
    };
    bar.appendChild(fb);
    // ✋ 自由拖动按钮（v36）：视角不再只能靠切 tab——按住拖动画布直接平移镜头，滚轮缩放
    var db = document.createElement("button");
    db.className = "room-tab";
    db.id = "cam-drag-btn";
    db.textContent = "✋ 拖动";
    db.title = "自由拖动视角：开启后按住画布拖动平移镜头，滚轮缩放（ESC 或再点一次退出）";
    db.setAttribute("aria-pressed", "false");
    db.onclick = function () {
      camDragOn = !camDragOn;
      exitNeighborHome();
      var cam = s.cameras.main;
      if (camDragOn) {
        cam.stopFollow();                       // 拖动模式 = 脱离鱼的跟随，镜头完全交给手
        if (cam.__dragPan) { cam.__dragPan.destroy(); cam.__dragPan = null; }
        cam.setZoom(Math.max(1, cam.zoom));     // 缩小态拖动会露出世界外，钳到 1
        db.classList.add("active");
        db.setAttribute("aria-pressed", "true");
        showBubble("（拖动视角已开启，按住画布拖一拖，滚轮缩放）", "idle");
      } else {
        db.classList.remove("active");
        db.setAttribute("aria-pressed", "false");
        if (editMode || editorMode) {
          cam.stopFollow();          // 编辑中：关掉"拖动视角"只是回到可落笔状态，镜头留在原地别弹回鱼身上
        } else {
          cam.startFollow(fish, true, 0.08, 0.08);
          cam.setZoom(1);
        }
      }
      syncDragBtn();
    };
    bar.appendChild(db);
    function syncTabActive(btn) {
      [].forEach.call(bar.children, function (c) {
        c.classList.remove("active");
        if (c.setAttribute) c.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
    }
    function syncDragBtn() { db.classList.toggle("active", camDragOn); }
    bar.children[0].classList.add("active");
    bar.children[0].setAttribute("aria-pressed", "true");
    bindCamDrag(s);
    bindCamWheel(s);
  }
  SceneOffice.prototype.update = update;

  /* ---------- 自由拖动视角（v36） ----------
   * camDragOn 开启后：按住画布拖动 = 平移镜头（拖动距离超过 6px 才算"拖"，
   * 没超过仍当一次点击走位）。滚轮 = 缩放 0.8~2.2，边界由 cameras.main.setBounds 钳制。 */
  var camDragOn = false;
  var camDragSuppress = 0;   // 拖动结束后的点击抑制窗口（ms 时间戳）
  function bindCamDrag(s) {
    var cam = s.cameras.main;
    var dragging = false, moved = false, lx = 0, ly = 0;
    var rightDrag = false;                 // v48：按住右键临时平移，松手自动恢复
    // 编辑页/游戏里都干掉浏览器右键菜单，右键专用于平移
    try {
      s.game.canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    } catch (e) {}
    s.input.on("pointerdown", function (p) {
      if (p.rightButtonDown && p.rightButtonDown()) {   // 右键：任何模式下都能拖视角
        rightDrag = true; dragging = true; moved = false; lx = p.x; ly = p.y;
        return;
      }
      if (!camDragOn) return;
      dragging = true; moved = false; lx = p.x; ly = p.y;
    });
    s.input.on("pointermove", function (p) {
      if ((!camDragOn && !rightDrag) || !dragging || !p.isDown) return;
      var dx = p.x - lx, dy = p.y - ly;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      cam.stopFollow();                      // 一动就脱跟随，镜头完全交给手
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      lx = p.x; ly = p.y;
      if (cam.__dragPan) { cam.__dragPan.remove(); cam.__dragPan = null; }   // 拖动打断 pan 停靠
    });
    var stop = function () {
      dragging = false;
      rightDrag = false;                     // 松手就恢复：不需要再点按钮取消
      if (moved) {
        // 拖完的一次「点击」不该再触发走位：挂一个短冷却，pointerdown 的走位逻辑看它退出
        camDragSuppress = Date.now() + 350;
        moved = false;
      }
    };
    s.input.on("pointerup", stop);
    s.input.on("pointerupoutside", stop);
    // 编辑模式拖动 + 放置预览（v37 / v38：独立编辑器走 mapEditorPointer*）
    s.input.on("pointermove", function (p) {
      if (!editMode) return;
      if (editorMode) mapEditorPointerMove(p.worldX, p.worldY);
      editPointerMove(p.worldX, p.worldY);
    });
    s.input.on("pointerup", function () { if (editMode) { if (editorMode) mapEditorPointerUp(); editPointerUp(); } });
    s.input.on("pointerupoutside", function () { if (editMode) { if (editorMode) mapEditorPointerUp(); editPointerUp(); } });
  }
  var camDragSuppress = 0;   // 拖动结束后的点击抑制窗口（ms 时间戳）
  function bindCamWheel(s) {
    var cam = s.cameras.main;
    var cv = s.game.canvas;
    cv.addEventListener("wheel", function (e) {
      if (!camDragOn && !camDragWheelAlways) return;
      e.preventDefault();
      var nz = Phaser.Math.Clamp(cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89), 0.8, 2.2);
      cam.setZoom(nz);
    }, { passive: false });
  }
  var camDragWheelAlways = true;   // 滚轮缩放任何视角都可用（拖动模式外也允许）