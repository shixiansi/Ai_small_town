  // ---------- 证据系统（场景清单 §3：AI 干了什么必须可见） ----------
  // 完成数持久化：刷新/重开浏览器不丢（证据是"今天"的，按日期存）
  var today = new Date().toISOString().slice(0, 10);
  var evidence = { done: 0, current: "", lastTask: "", lastMood: "" };
  try {
    var saved = JSON.parse(localStorage.getItem("office_evidence") || "{}");
    if (saved.day === today) evidence.done = saved.done || 0;
  } catch (e) {}
  function saveEvidence() {
    try { localStorage.setItem("office_evidence", JSON.stringify({ day: today, done: evidence.done })); } catch (e) {}
  }
  // 任务板：贴在黑板上方的任务卡（当前任务 + 今日完成数）
  function updateEvidence(cfg, taskText, detail) {
    if (!scene) return;
    evidence.current = taskText;
    // 任务完成判定：上一次任务结束（非 idle/sleeping 新任务开始）计一次
    if (cfg.mood !== "sleeping" && evidence.current && evidence.current !== evidence.lastTask) {
      if (evidence.lastTask && evidence.lastMood && evidence.lastMood !== "sleeping") { evidence.done++; saveEvidence(); }
      evidence.lastTask = evidence.current;
      evidence.lastMood = cfg.mood;
    }
    redrawBoard();
    refreshTrophies();
  }
  // 黑板上方的任务板：当前任务文字 + 完成计数
  function redrawBoard() {
    if (!scene || !scene.mapdata) return;
    if (scene.boardText) { scene.boardText.destroy(); scene.boardText = null; }
    var b = scene.mapdata.zones.board || { anchor: [15.2, 1.0] };
    var bx = b.anchor[0] * TILE, by = WALL_H + b.anchor[1] * TILE;
    var lines = [
      "今日完成 " + evidence.done + " 件",
      (evidence.current || "待命中").slice(0, 12)
    ];
    var k = uiK();
    var t = scene.add.text(bx, by, lines.join("\n"), {
      fontFamily: "monospace", fontSize: uiFont(14) + "px", color: "#f4f1ea",
      backgroundColor: "#3a2f26ee",
      padding: { x: Math.round(8 * k), y: Math.round(4 * k) },
      align: "center", lineSpacing: Math.round(4 * k)
    }).setOrigin(0.5, 0.5).setDepth(9000);   // 高于所有家具 footY，否则任务卡会被黑板/书架盖住
    scene.boardText = t;
  }
  // 产出物架：每完成 1 件，产出架上多一个小奖杯（上限 6）
  function refreshTrophies() {
    if (!scene || !scene.trophyLayer) return;
    scene.trophyLayer.removeAll(true);
    var n = Math.min(evidence.done, 6);
    for (var i = 0; i < n; i++) {
      // 排在原奖杯下方一格，横向一排（贴墙根，脚点对齐 y）
      var tx = 20.15 * TILE + i * 15;
      var ty = WALL_H + 2.6 * TILE;
      scene.trophyLayer.add(scene.add.image(tx, ty, "trophy-cup", 0).setScale(0.4).setOrigin(0.5, 1));
    }
  }

  // ---------- 画布内文字缩放 ----------
  /* Phaser FIT 把 1248×768 的画布整体缩到容器宽度：桌面约 0.86×，375px 手机只有 0.28×。
   * 画布里的 Text 用「世界像素」，写死 13px 到手机上实际只剩 3.6 CSS px；再加上 pixelArt
   * 设的 image-rendering: pixelated（最近邻采样），中文细笔画直接被采样成灰块、带虚边重影。
   * DOM 文字不走这条路，所以状态条/说明一直是清楚的 —— 这就是「只有画里的字糊」的原因。
   * 下面按实时缩放比反算：所有画布 UI 文字与几何都乘 k，屏幕呈现尺寸不变，但笔画有足够像素。 */
  function canvasScale() {
    var c = document.querySelector("#office-parent canvas");
    if (!c) return 1;
    var r = c.getBoundingClientRect();
    return r.width > 0 ? Math.max(0.2, Math.min(1, r.width / c.width)) : 1;
  }
  function uiK() { return 1 / canvasScale(); }              // 1 CSS px = 多少世界 px
  function uiFont(cssPx) { return Math.round(cssPx * uiK()); }
  var lastBubble = null, textResizeTimer = null;
  function refreshCanvasText() {
    if (bubble && lastBubble) { var lb = lastBubble; showBubble(lb.text, lb.mood); }
    if (scene && scene.mapdata) redrawBoard();
  }
  window.addEventListener("resize", function () {
    // 调试台开/关会改变 .wrap 宽度但不触发浏览器 resize；手动派发时也要让 Phaser 重算 parentSize
    if (game && game.scale) game.scale.refresh();
    clearTimeout(textResizeTimer);
    textResizeTimer = setTimeout(refreshCanvasText, 160);
  });
  setTimeout(refreshCanvasText, 400);   // 首屏 canvas 完成布局后按真实缩放比重绘任务板

  // ---------- 气泡 ----------
  /* 面朝北（背对镜头）时，鱼正前方就是要互动的家具：电脑、餐桌、课桌、信箱。
   * 气泡若仍挂在正上方会把它整块盖住，看起来像"对着空气发呆"。
   * 这时把气泡侧移，并让小三角斜指回鱼身。 */
  var bubbleOff = { x: 0, y: -46 };
  /* 偏移量是世界 px（相对鱼脚点/鱼头），不随 canvas 缩放乘 k：
   * k 放大是给"文本字号"用的（文本 size 是世界 px，要补偿缩小屏），而 88/-46 本来就是世界尺寸，
   * 再乘 k 会在缩小屏上把气泡推离鱼 2 个多身位（v15 用户报的"气泡不对齐"根因）。 */
  function calcBubbleOff() {
    if (!fish || fish.lastFace !== "n") return { x: 0, y: fish && fish.sitting ? -62 : -46 };
    // face=n（背对镜头）：气泡斜上 45° 让开互动对象，但不能漂出 1 格多——否则三角指不到鱼（v15"没对齐"体感）。
    // 靠近画布右缘时改往左，避免被视口裁掉（980 是画布内像素，不随 k 变）
    var sx = scene ? fish.x - scene.cameras.main.scrollX : fish.x;
    var side = sx > 980 ? -46 : 46;
    return { x: side, y: fish.sitting ? -58 : -52 };
  }
  function showBubble(text, mood) {
    if (typeof editorMode !== "undefined" && editorMode) return;   // v48：编辑页不弹气泡
    if (!scene || !fish) return;
    hideBubble();
    var k = uiK();
    var txt = text.length > 20 ? text.slice(0, 19) + "…" : text;
    bubbleText = scene.add.text(0, 0, txt, {
      fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
      fontSize: uiFont(13) + "px", color: "#151826", align: "center",
      wordWrap: { width: Math.round(200 * k) }
    }).setOrigin(0.5, 1);
    var bw = Math.max(60 * k, bubbleText.width + 24 * k), bh = bubbleText.height + 16 * k;
    var bg = scene.add.graphics();
    bg.fillStyle(0xfffdf8, 0.96);
    bg.fillRoundedRect(-bw / 2, -bh, bw, bh, 7 * k);
    bg.lineStyle(Math.max(1, 1.5 * k), mood === "error" ? 0xe03131 : 0x8a97ad, 1);
    bg.strokeRoundedRect(-bw / 2, -bh, bw, bh, 7 * k);
    bg.fillStyle(0xfffdf8, 0.96);
    bubbleOff = calcBubbleOff();
    var triX = 0;
    if (bubbleOff.x) {
      var t = Math.min(Math.abs(bubbleOff.x), bw / 2 - 16 * k);
      triX = bubbleOff.x > 0 ? -t : t;   // 气泡在右 → 三角靠左；反之靠右
    }
    bg.fillTriangle(triX - 6 * k, -1 * k, triX + 6 * k, -1 * k, triX, 8 * k);
    bubble = scene.add.container(fish.x + bubbleOff.x, fish.y + bubbleOff.y, [bg, bubbleText]);
    bubbleText.setPosition(0, -8 * k);
    bubble.setDepth(90000);
    bubble.setScale(0.6);
    scene.tweens.add({ targets: bubble, scale: 1, duration: 180, ease: "Back.Out" });
    lastBubble = { text: text, mood: mood };
  }
  function hideBubble() {
    if (bubble) { bubble.destroy(); bubble = null; }
    if (bubbleText) { bubbleText.destroy(); bubbleText = null; }
    lastBubble = null;
  }

  // ---------- 工作特效：物件动画只在用时播放 ----------
  function playFx(fx) {
    stopFx();
    if (!fx) return;
    var fxDefs = {
      pc:      { host: "pc",      tex: "computer",     fpsKey: "anim" },
      printer: { host: "printer", tex: "printer",      fpsKey: "anim" },
      chair:   { host: "chair",   tex: "office-chair", fpsKey: null }
    };
    var def = fxDefs[fx];
    if (!def || !scene.fxDirect[def.host]) return;
    var d = scene.fxDirect[def.host];
    if (!d.m.anim || !(d.m.rows && d.m.rows.East > 1)) return;
    var key = "fx_" + fx;
    if (!scene.anims.exists(key)) {
      var frames = [];
      for (var i = 0; i < d.m.rows.East; i++) frames.push({ key: def.tex, frame: i });
      scene.anims.create({
        key: key, frames: frames,
        frameRate: fx === "chair" ? 10 : d.m.anim.fps,
        repeat: fx === "chair" ? 0 : -1
      });
    }
    d.spr.play(key);
  }
  function stopFx() {
    ["pc", "printer", "chair"].forEach(function (k) {
      var d = scene.fxDirect && scene.fxDirect[k];
      if (d && d.spr.anims) {
        d.spr.anims.stop();
        // 回到该家具的"静止基准帧"（如椅子 North 首帧 24），而不是永远 0
        var f0 = (d.f && d.f.frame) || 0;
        d.spr.setFrame(f0);
      }
    });
  }
