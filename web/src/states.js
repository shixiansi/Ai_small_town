  // ---------- 真实事件处理 ----------
  function onState(st, zoneOverride, force) {
    if (!scene || !fish) return;
    var rawState = String(st.state || "");
    var cfg = STATE_MAP[rawState] || STATE_MAP.idle;
    var taskText = st.task || cfg.verb;
    lastServerTs = st.ts || Date.now();
    actCur = { state: rawState, task: taskText, at: Number(st.ts) || Date.now() };   // 最近动态窗据此解释「为什么现在是这样」
    // 同一 state+task 再来一遍（agent 心跳、仅 detail 变化、WS 重连补发 hello）：
    // 只刷新状态条与时间戳，不重新寻路、不重复计「今日完成」、不打断正在做的动作。
    // 调试台 emit 传 force=true，仍能一键复现走位。
    if (rawState === "writing") writerFeed(taskText, st.detail || "");   // 打字机：去抖也要喂（每行 detail 不同）
    if (!force && !zoneOverride && lastEventState === rawState && lastEventTask === taskText) {
      updateStatusbar(rawState, taskText, st.detail || "");
      renderPlan();
      return;
    }
    lastEventState = rawState;
    lastEventTask = taskText;
    // 打断转场（P1.2）：正在做别的事（本地生活/上一条真实事件还没走完）时来了新事件，
    // 先冒一个「！」提示被叫走了，再走新任务的路 —— 观众能看出"这是打断"，不是瞬移换戏
    if ((fishState === "walking" || fishState === "acting") && curPlan && !curPlan.stInterrupted) {
      showBubble("！", "error");
      if (curPlan) curPlan.stInterrupted = true;
    }
    stopIdleLife();
    updateStatusbar(rawState, taskText, st.detail || "");
    // 灯光自动模式：睡觉/未开灯 → 关灯；上班干活 → 开灯（手动开关被下一次真实事件重置为自动）
    lightsManual = false;
    // AI 自主开关灯（v31 用户反馈）：按状态点亮对应房间的灯，不是全开/全关
    var h = bjHour();
    if (cfg.mood === "sleeping") {
      roomLights.office = false; roomLights.kitchen = false; roomLights.bath = false;
      roomLights.bedroom = (h >= 18 || h < 23);   // 睡前开卧室灯，深夜全关
    } else {
      roomLights.office = true; roomLights.kitchen = (h >= 6 && h < 10) || (h >= 17 && h < 21);
      roomLights.bath = false;                     // 清醒时段卫浴默认关（washing 状态时临时开）
      roomLights.bedroom = false;
    }
    applyRoomLights(scene);
    unsit();   // 起身：同时取消未走完的坐席 tween，避免新状态把鱼又拉回沙发
    fish.setBadge(cfg.mood === "error" ? "#e03131" :
      cfg.mood === "sleeping" ? "#4c6ef5" :
      cfg.mood === "idle" ? "#f59f00" : "#2f9e44");

    var zone = (zoneOverride && scene.mapdata.zones[zoneOverride]) || scene.mapdata.zones[cfg.zone];
    if (!zone) {   // 状态表引用了不存在的区域时不再让整个 onState 崩掉
      console.warn("[office] 状态 " + st.state + " 的区域 " + cfg.zone + " 不存在，回退到 sofa");
      zone = scene.mapdata.zones.sofa;
    }
    var ex = Math.round(zone.anchor[0]), ey = Math.round(zone.anchor[1]);
    var path = astar(px2tx(fish.x), px2ty(fish.y), ex, ey);
    if (!path) path = [{ x: ex, y: ey }];
    curPlan = { path: path, cfg: cfg, task: taskText, st: st, i: 0, local: false, face: zone.face || "s", zone: zone };
    fishState = "walking";

    // 观景模式（评审方案 B）：真实事件 → 相机先 600ms 缓动到目标 zone（不改鱼的位置），
    // 观众"先看到 AI 要去的房间"，到达时 follow 已恢复、画面无缝回到鱼身上
    // （串门保护：真实事件到 = 客人该走了，先结束串门再走观景镜头，鱼从屋里走出来）
    // 观景模式（评审方案 B）：真实事件 → 相机先 600ms 缓动到目标 zone（不改鱼的位置），
    // 观众"先看到 AI 要去的房间"，到达时 follow 已恢复、画面无缝回到鱼身上
    // （串门保护：参观邻居屋时镜头不被抢走，鱼自己走出屋去干活——观众点任意房间/房屋/跟随回来）
    var cam = scene.cameras.main;
    if (editMode) {
      // 编辑模式：镜头完全交给用户 —— 否则每条真实事件都会 pan 到鱼那边再恢复跟随，
      // 视图一甩，刚对准的物件就点空了（"完全点不到"的另一半原因）
      cam.stopFollow();
    } else if (visitingHome) {
      visitSitCount = 0;   // 真实事件优先，鱼随时可以被带走
    } else {
      cam.stopFollow();
      var zx = zone.anchor[0] * TILE, zy = WALL_H + zone.anchor[1] * TILE;
      cam.pan(Phaser.Math.Clamp(zx, 624, W - 624), Phaser.Math.Clamp(zy - 96, 384, H - 384), 600);
      // 镜头在目标房间停留 ≥1.8s 再恢复跟随（复评 P1-5：600ms 完成就弹回等于甩镜头）
      cam.once("camerapancomplete", function () {
        scene.time.delayedCall(1800, function () {
          if (!visitingHome) cam.startFollow(fish, true, 0.08, 0.08);   // 无条件兜底：pan 被新事件打断也能恢复跟随
        });
      });
    }

    // 证据系统（场景清单 §3"补证据"）：AI 干了什么必须可见
    updateEvidence(cfg, taskText, st.detail || "");

    // 物件特效随状态启停
    if (cfg.mood === "working" || cfg.mood === "error") playFx(cfg.fx);
    else stopFx();

    if (cfg.mood === "idle") {
      setTimeout(function () {
        if (fishState === "acting" && curPlan && curPlan.cfg === cfg) {
          fishState = "idle";
          stopFx();
          startIdleLife(800);
        }
      }, 6000);
    }
  }

  // ---------- 行走 ----------
  function stepWalk() {
    if (!curPlan) { fishState = "idle"; return; }
    var p = curPlan.path;
    if (curPlan.i >= p.length) { arriveAct(); return; }
    var node = p[curPlan.i];
    var targetX = node.x * TILE + TILE / 2;
    var targetY = WALL_H + node.y * TILE + TILE / 2;
    var dx = targetX - fish.x, dy = targetY - fish.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 3) { curPlan.i++; return; }
    // 跨房间长路径提速：原固定 2.2px/帧（≈132px/s）横跨世界要 15s+，状态早变了鱼还在路上
    var speed = (p.length - curPlan.i) > 14 ? 4.0 : 2.2;
    if (Math.abs(dx) > Math.abs(dy)) fish.face(dx > 0 ? "e" : "w");
    else fish.face(dy > 0 ? "s" : "n");
    fish.x += (dx / dist) * speed;
    fish.y += (dy / dist) * speed;
  }

  /* ---------- 坐席：真实事件与本地生活模拟共用 ----------
   * 旧版只有 onState 走到 arriveAct 时才坐；本地模拟的「瘫在沙发上」只调 goLocal，
   * 鱼停在沙发前的空地上，气泡却写着瘫沙发 —— 这就是定位漂移的根因。
   */
  function applySit(zone) {
    var sit = zone && zone.sit;
    if (!sit || !scene || !scene.hostMap || !scene.hostMap[sit.host]) return false;
    var h = scene.hostMap[sit.host];
    var tx = h.x + (sit.dx || 0), ty = h.y + (sit.dy || 0);  // dy 负值 = 坐进坐垫
    var dist = Math.sqrt(Math.pow(tx - fish.x, 2) + Math.pow(ty - fish.y, 2));
    scene.tweens.killTweensOf(fish);
    scene.tweens.add({ targets: fish, x: tx, y: ty,
      duration: Math.min(700, 220 + dist * 1.5), ease: "Sine.InOut" });   // 距离越远滑得越久，不再瞬移
    fish.setScale(sit.lounge ? 0.86 : 0.8);
    fish.setDepth(h.footY + 2);   // 画在家具之上；depthSort 坐席期间不覆盖
    fish.sitting = true;
    fish.lounge = !!sit.lounge;   // 沙发/床 = 真的躺下，工位椅子只是坐直
    // 状态圆点默认挂在头顶 -46；躺下后要贴回鱼身，否则会悬在半空
    if (fish.badge) fish.badge.setPosition(fish.lounge ? 20 : 0, fish.lounge ? -14 : -30);
    // 瘫躺一律面朝镜头；工位椅子保持区域朝向（背对镜头打字），除非 sit 显式指定
    fish.face(sit.face || (fish.lounge ? "s" : (zone && zone.face) || "s"));
    fish.still();
    return true;
  }
  function unsit() {
    if (!fish || !fish.sitting) { if (fish) fish.lounge = false; return; }
    if (scene) scene.tweens.killTweensOf(fish);
    fish.sitting = false;
    fish.lounge = false;
    fish.setScale(0.95);
    fish.setDepth(fish.y);
    if (fish.badge) fish.badge.setPosition(0, -46);
    if (fish.bodySpr) {
      fish.bodySpr.setAngle(0);
      fish.bodySpr.setScale(1);
      fish.bodySpr.setPosition(fish.bodySpr.x, fish.baseY);
    }
  }
  function setLoungePose() {
    var b = fish.bodySpr;
    b.setAngle(0);
    b.setScale(1);
    b.setPosition(b.x, fish.baseY);
    // 新形象是人形，不能像旧版竖直小鱼那样旋转 74°；改用精灵表里的专用横躺帧
    fish.playAct("lounge");
  }
  function arriveAct() {
    if (!curPlan) { fishState = "idle"; return; }
    if (curPlan.local) { arriveLocal(); return; }
    fishState = "acting";
    fish.face(curPlan.face || "s");
    applySit(curPlan.zone);
    startActAnim(curPlan.cfg.act);
    showBubble(curPlan.task, curPlan.cfg.mood);
  }

  // ---------- 动作表演 ----------
  /* 动作表现已经画进 whale.png 的动作帧（每行 8 帧循环），不再靠 tween 把身体掰来掰去。
   * 这里只做三件事：选对动作行、处理瘫躺特例、补音符 / Zzz 这类粒子氛围。 */
  function startActAnim(act) {
    stopActAnim();
    if (fish.lounge) {
      setLoungePose();
      if (act === "sleep" || act === "rest" || act === "idle" || act === "lounge") {
        actTickTimer = scene.time.addEvent({
          delay: 1500, loop: true, callback: function () {
            if (Math.random() < 0.7) spawnZzz();
          }
        });
      }
      return;
    }
    if (!fish.playAct(actRow(act))) fish.still();   // 老版精灵表没有动作行时优雅降级
    if (act === "listen") {
      actTickTimer = scene.time.addEvent({
        delay: 500, loop: true, callback: function () {
          var nk = uiK();
          var note = scene.add.text(fish.x + (Math.random() * 30 - 15) * nk, fish.y - 44 * nk, "♪",
            { fontSize: uiFont(14) + "px", color: "#4a6cf7" }).setDepth(9000);
          scene.tweens.add({ targets: note, y: note.y - 24 * nk, alpha: 0, duration: 1100, onComplete: function () { note.destroy(); } });
        }
      });
    } else if (act === "sleep" || act === "rest") {
      actTickTimer = scene.time.addEvent({
        delay: 1400, loop: true, callback: function () {
          if (Math.random() < 0.8) spawnZzz();
        }
      });
    }
  }
  function stopActAnim() {
    if (actTickTimer) { actTickTimer.remove(); actTickTimer = null; }
    scene.tweens.killTweensOf(fish.bodySpr);
    if (fish && fish.bodySpr) {
      fish.bodySpr.setPosition(
        MAN.whale.frameW / 2 - (MAN.whale.bbox[0] + MAN.whale.bbox[2] / 2),
        fish.baseY
      );
      fish.bodySpr.setAngle(0);
      fish.bodySpr.setScale(1);
      fish.still();     // 停掉上一组动作帧，回到当前朝向的站立首帧
    }
  }
  function spawnZzz() {
    var k = uiK();
    var z = scene.add.text(fish.x + 18 * k, fish.y - 40 * k, "z", {
      fontSize: uiFont(15) + "px", color: "#aab4c8", fontStyle: "bold"
    }).setDepth(90000);
    scene.tweens.add({ targets: z, y: z.y - 36 * k, x: z.x + 10 * k, alpha: 0, duration: 2600, ease: "Sine.Out",
      onComplete: function () { z.destroy(); } });
  }
