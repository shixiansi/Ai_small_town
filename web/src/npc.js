  // ---------- 小镇居民（方案 §3）：3 个 NPC，前端本地状态机，零后端成本 ----------
  /* NPC 精灵表 = gen_npc_skins.py 从 whale.png 色相重映射的换装副本（发色/衣色区分，帧结构一致） */
  /* v76：NPC 不再依赖三座旧房子 —— "家"就是各房间的床。
   * bedAt = 床位格坐标（catBed 来自 map.json，另两张按室内布局给）。 */
  /* v77：家的唯一真相 = map.json 里那张床。bedAt 只是兜底，
   * 运行时用 npcBedPos() 从 mapdata 读真实坐标，床被移动/换位置也能跟上。 */
  /* v78：每个邻居固定一个床位（都用房间里【已有】的家具，不新增任何东西）
   *  - 喵酱 → catBed（床）
   *  - 村长 → chiefChair1（餐椅；村长家本来没有床，不额外加）
   *  - 博士 → docArm（扶手椅）
   * bedAt 只是兜底，运行时用 npcBedPos() 按 id 从 mapdata 取真实坐标。 */
  var NPCS = [
    { id: "cat",   name: "喵酱", skin: "whale_cat",   bed: "catBed",      bedAt: [41.3, 21.2], roam: [40, 54], homeHours: [23, 7],  desc: "镇上的橘猫" },
    { id: "chief", name: "村长", skin: "whale_chief", bed: "chiefChair1", bedAt: [47.4, 23.3], roam: [41, 54], homeHours: [20, 8],  desc: "热心的水豚村长" },
    { id: "doc",   name: "博士", skin: "whale_doc",   bed: "docArm",      bedAt: [54.3, 27.2], roam: [42, 54], homeHours: [21, 13], desc: "研究潮汐的章鱼" }
  ];
  /* 从 mapdata 查这张床的真实格坐标；查不到就用兜底 bedAt */
  function npcBedPos(def) {
    var md = scene && scene.mapdata;
    if (md && md.furniture) {
      for (var i = 0; i < md.furniture.length; i++) {
        var f = md.furniture[i];
        if (f && f.id === def.bed && f.x != null && f.y != null) return { x: Number(f.x), y: Number(f.y) };
      }
    }
    return { x: def.bedAt[0], y: def.bedAt[1] };
  }
  var NPC_DIALOGS = {
    cat: {
      morning: ["喵！（蹭蹭裤脚）", "喵呜～（尾巴卷成一个问号）", "喵！（今天鱼干还没着落）"],
      day:     ["喵？（你手里有好吃的吗）", "呼噜呼噜…（晒太阳中）", "喵！（井边有只蟋蟀！）"],
      night:   ["喵～（夜晚的眼睛亮晶晶）", "喵…（困了，要回窝了）"]
    },
    chief: {
      morning: ["早上好，年轻人！今天也是好天气。", "早啊！记得吃早饭。"],
      day:     ["今天市集进了新果子，去瞧瞧？", "镇口的灯我昨天刚修好。", "有烦恼就说出来，别憋着。"],
      night:   ["天黑了，早点回去休息。", "夜里散步小心脚下。"]
    },
    doc: {
      morning: ["我在想一个关于潮汐的问题…你不会懂的。", "早上好。（眼睛没离开书）"],
      day:     ["你知道吗，月亮每天挪 50 分钟。", "潮汐表画到第三张了。", "问你个事…算了，你大概不感兴趣。"],
      night:   ["夜里的海面更平静，适合思考。", "别吵，灵感要来了。"]
    }
  };
  var npcLayer = [];
  function npcHourBucket() {
    var h = bjHour();
    if (h >= 6 && h < 11) return "morning";
    if (h >= 11 && h < 19) return "day";
    return "night";
  }
  function npcIsHome(def) {
    // ?debug-awake=1：验收用，全员强制醒着（动机层/串门/台词随时可看）；正常访问不受影响
    try { if (location.search.indexOf("debug-awake=1") >= 0) return false; } catch (e) {}
    if (!def.homeHours) return false;
    var h = bjHour();
    var a = def.homeHours[0], b = def.homeHours[1];
    return a <= b ? (h >= a && h < b) : (h >= a || h < b);
  }
  function buildNPCs(s) {
    if (!s.mapdata) return;
    NPCS.forEach(function (def) {
      // v76：家 = 床位格（不依赖房子 sprite）
        var bp = npcBedPos(def);                     // v77：真实床位（map.json）
        def._bed = bp;
        var bx = bp.x * TILE + TILE / 2;
        var by = WALL_H + bp.y * TILE + TILE * 0.72;   // v83.3：初始也在床上（与 npcWalkHome 一致）
        var spr = s.add.sprite(bx, by, def.skin || "whale")
          .setScale(0.82).setOrigin(0.5, 1).setDepth(by + 1);
      var tag = null;
      // 名牌：世界像素 15px，缩放屏上仍可辨（check 第 16 项管的是画布内文字防糊——NPC 名牌用大字）
      tag = s.add.text(0, 0, def.name, {
        fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
        fontSize: "15px", color: "#fff8e1", backgroundColor: "#15182699",
        padding: { x: 4, y: 2 }
      }).setOrigin(0.5, 1).setDepth(by + 3);
      var npc = { def: def, spr: spr, tag: tag, state: "home", timer: null,
                    path: null, pathIdx: 0, homeX: bx, homeY: by, indoor: true, act: "sleep",
                    motives: npcInitMotives() };   // v84 动机条
      if (typeof editorMode !== "undefined" && editorMode) tag.setVisible(false);   // v48：地图编辑页不显示名牌
      // 在家/在街上状态圆点：挂在名牌旁，跟 positionNpcParts 一起走（进屋时连名牌一起收起）
      npc.dot = s.add.circle(0, 0, 3.2, npcIsHome(def) ? 0x51cf66 : 0xffd43b)
        .setStrokeStyle(1, 0x151826, 0.5).setDepth(by + 3);
      npcLayer.push(npc);
      positionNpcParts(npc);
      scheduleNpc(npc, 2000 + Math.random() * 3000);
    });
  }
  /* 配饰与名牌跟随 NPC 身体（tween 移动时也要跟） */
  function positionNpcParts(npc) {
    if (!npc.spr || !npc.spr.active) return;
    var x = npc.spr.x, topY = npc.spr.y - npc.spr.displayHeight;
    if (npc.tag) npc.tag.setPosition(x, topY - 6).setDepth(npc.spr.depth + 3);
    if (npc.dot) npc.dot.setPosition(x + (npc.tag ? npc.tag.width / 2 + 7 : 0), topY - 6).setDepth(npc.spr.depth + 3);
    if (npc.say) npc.say.setPosition(x, topY - 26).setDepth(npc.spr.depth + 4);   // v84 动机气泡跟随
  }
  /* 在家时把 NPC 真正收进屋里：精灵站在屋内锚点旁半步（给串门的鱼让出落点）、名牌与圆点隐藏。
   * "回家"的最后一程走门洞（door zone 正对 gap），进屋路上不会被墙挡住视线。 */
  function setNpcIndoor(npc, indoor) {
    npc.indoor = !!indoor;
    var z = null;   // v76：不再用 zone 定位，统一走床位（见 npcWalkHome）
    if (z && indoor) {
      npc.spr.x = z.anchor[0] * TILE + 18;   // 半步偏移：主人和客人不叠影
      npc.spr.y = WALL_H + z.anchor[1] * TILE - 6;
      npc.spr.setDepth(npc.spr.y + 1);
    }
    if (npc.tag) npc.tag.setVisible(!indoor);
    if (npc.dot) npc.dot.setVisible(!indoor);
    positionNpcParts(npc);
  }
  /* NPC 进/出屋共用：最后一段或第一段都路过自家门口 zone（视觉上穿过门洞，不穿墙） */
  /* v76：NPC 走路必须走 A* 路径（原来用 tweens 直线插值 → 直接穿墙）。
   * 一格一格推进，遇到不可走格自动重算。 */
  function npcWalkTo(npc, tx, ty, speed, onDone) {
    if (!npc.spr || !npc.spr.active || !scene || !scene.grid) { if (onDone) onDone(); return; }
    var sx = Math.round((npc.spr.x - TILE / 2) / TILE);
    var sy = Math.round((npc.spr.y - WALL_H - TILE / 2) / TILE);
    var ex = Math.round(tx), ey = Math.round(ty);
    var path = astar(sx, sy, ex, ey);
    if (!path || !path.length) { if (onDone) onDone(); return; }
    npc.path = path; npc.pathIdx = 0;
    if (npc.timer) { clearTimeout(npc.timer); npc.timer = null; }
    var stepMs = speed || 420;
    var advance = function () {
      if (!npc.spr || !npc.spr.active) return;
      if (!npc.path || npc.pathIdx >= npc.path.length) {
        npc.path = null;
        if (onDone) onDone();
        return;
      }
      var node = npc.path[npc.pathIdx++];
      var wx = node.x * TILE + TILE / 2, wy = WALL_H + node.y * TILE + TILE / 2;
      scene.tweens.add({
        targets: npc.spr, x: wx, y: wy, duration: stepMs, ease: "Linear",
        onUpdate: function () { positionNpcParts(npc); },
        onComplete: advance
      });
    };
    advance();
  }
  /* v76：NPC 行为系统
   *  - 走位统一走 A*（npcWalkTo），不再用直线补间 → 不会穿墙
   *  - 家 = 各房间的床；回家 = 走到床边并"躺下"（缩放压扁 + zzz）
   *  - 自主行为：睡觉 / 起床活动 / 闲逛 / 回家，按 homeHours 与随机权重切换
   */
  var NPC_ACTS = {
    sleep:  { label: "睡觉中",   ms: [9000, 16000] },
    idle:   { label: "发呆中",   ms: [3000, 6000] },
    wander: { label: "走动着",   ms: [5000, 9000] },
    look:   { label: "四处张望", ms: [2500, 5000] }
  };

  /* ---------- v84 动机层（P6.1）：NPC 不再纯随机溜达，行为有理由 ----------
   * 每只 NPC 三条动机条（0-100），scheduleNpc 每跳涨一点：
   *   hunger  饿了 → 去厨房/餐桌；social 无聊 → 串门（去别人家客厅/街上找人）；
   *   energy  困了 → 回家睡觉（原有 homeHours 逻辑之上叠加）。
   * 动机触发时气泡说「为什么去」——观众看到的是有原因的移动，不是抽风。
   * 台词是模板随机组合（口气×内容），不是固定池循环。 */
  var NPC_MOTIVES = {
    hunger:  { trigger: 72, zones: ["cook", "dining", "fridge"],
      lines: ["肚子有点饿了…去灶台那边看看", "好像闻到饭香了", "冰箱里应该还有吃的吧"] },
    social:  { trigger: 78, zones: ["visit", "market", "garden"],
      lines: ["一个人待着好闷，去找{other}聊两句", "{other}在忙吗？去瞧瞧", "街上应该挺热闹的吧"] },
    energy:  { trigger: 85, zones: ["home"],
      lines: ["眼皮打架了…回去躺一会儿", "困了困了，回窝", "今天走的路够多了，歇了"] }
  };
  function npcMotiveLine(def, motive) {
    var others = NPCS.map(function (d) { return d.name; }).filter(function (n) { return n !== def.name; });
    var line = motive.lines[Math.floor(Math.random() * motive.lines.length)];
    return line.replace("{other}", others.length ? others[Math.floor(Math.random() * others.length)] : "村长");
  }
  function npcInitMotives() {
    return { hunger: 20 + Math.random() * 40, social: 10 + Math.random() * 50, energy: 10 + Math.random() * 30 };
  }
  function npcTickMotives(m) {
    m.hunger = Math.min(100, m.hunger + 1.6 + Math.random() * 1.2);
    m.social = Math.min(100, m.social + 1.2 + Math.random());
    m.energy = Math.min(100, m.energy + 0.8 + Math.random() * 0.8);
  }
  // 触发动机后该条的回落量
  function npcRelieveMotives(m, which) {
    if (which === "hunger") m.hunger = 10 + Math.random() * 15;
    else if (which === "social") m.social = 15 + Math.random() * 20;
    else if (which === "energy") m.energy = 5 + Math.random() * 10;
  }
  /* 找动机目的地：zones 里第一个存在的 zone 锚点（visit=别人家客厅，运行时解析） */
  function npcMotiveTarget(def, motive) {
    for (var i = 0; i < motive.zones.length; i++) {
      var z = motive.zones[i];
      if (z === "visit") {
        // 串门：随机别人家 living zone（自己在场时排除自家）
        var homes = ["living_cat", "living_chief", "living_doc"].filter(function (k) {
          return scene.mapdata.zones[k] && k !== "living_" + def.id;
        });
        if (homes.length) return scene.mapdata.zones[homes[Math.floor(Math.random() * homes.length)]].anchor;
      } else if (z === "home") {
        return null;   // home 走原有 npcGoHome 流程
      } else if (scene.mapdata.zones[z]) {
        return scene.mapdata.zones[z].anchor;
      }
    }
    return null;
  }

  /* v84：动机台词气泡——挂在 NPC 名牌上方，4.5s 后淡出。与鱼的气泡互不干扰 */
  function npcSay(npc, text) {
    if (!scene || !npc.spr || typeof editorMode !== "undefined" && editorMode) return;
    if (npc.say) { npc.say.destroy(); npc.say = null; }
    var t = scene.add.text(npc.spr.x, npc.spr.y - 42, text, {
      fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
      fontSize: "13px", color: "#1a1a2e", backgroundColor: "#fff8e1dd",
      padding: { x: 6, y: 3 }, wordWrap: { width: 180 }
    }).setOrigin(0.5, 1).setDepth(94001);
    npc.say = t;
    scene.time.delayedCall(4500, function () {
      if (npc.say === t) { npc.say.destroy(); npc.say = null; }
    });
  }

  function npcSetAct(npc, act) {
    npc.act = act;
    var flat = act === "sleep";
    if (npc.spr) npc.spr.setScale(0.82, flat ? 0.45 : 0.82);
    if (npc.zzz) { npc.zzz.destroy(); npc.zzz = null; }
    if (flat && scene) {
      npc.zzz = scene.add.text(npc.spr.x + 12, npc.spr.y - 30, "z z", {
        fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
        fontSize: "13px", color: "#cfe3ff"
      }).setOrigin(0.5).setDepth(94000);
      scene.tweens.add({ targets: npc.zzz, y: npc.zzz.y - 16, alpha: 0.2, duration: 2200, yoyo: true, repeat: -1 });
    }
    positionNpcParts(npc);
  }

  /* 单元格坐标工具 */
  function npcTileOf(npc) {
    return { x: Math.round((npc.spr.x - TILE / 2) / TILE), y: Math.round((npc.spr.y - WALL_H - TILE / 2) / TILE) };
  }
  /* 回家：走到床边（床格可能被占，astar 会自动挑最近可走格） */
  function npcWalkHome(npc, onDone) {
    npc.indoor = true;
    var bp = npcBedPos(npc.def);          // v77：每次都取真实床位（床可被编辑移动）
    npc.def._bed = bp;
    // v83.3：睡觉显示「在床上」——贴床格本身（床中心），深度压床 sprite（床 depth=footY，
    // NPC 深度=homeY+1 高于床 → 角色盖在床上）。原 homeY 多偏一格导致角色站床下方格。
    npc.homeX = bp.x * TILE + TILE / 2;
    npc.homeY = WALL_H + bp.y * TILE + TILE * 0.72;
    // 先寻路到床附近，再"贴"到床中心（床格本身是阻挡格，A* 到不了正中心）
    npcWalkTo(npc, bp.x, bp.y + 0.6, 360, function () {
      npc.spr.x = npc.homeX;
      npc.spr.y = npc.homeY;
      npc.spr.setDepth(npc.homeY + 1);
      npcSetAct(npc, "sleep");
      if (onDone) onDone();
    });
  }
  function npcGoHome(npc) {
    npc.state = "home";
    npcWalkHome(npc);
    scheduleNpc(npc, 18000 + Math.random() * 12000);
  }

  function scheduleNpc(npc, delay) {
    if (npc.timer) clearTimeout(npc.timer);
    npc.timer = setTimeout(function () { npcStep(npc); }, delay);
  }

  function npcStep(npc) {
    if (!npc.spr || !npc.spr.active) return;
    if (typeof editorMode !== "undefined" && editorMode) return;   // 编辑页 NPC 站桩
    npcTickMotives(npc.motives || (npc.motives = npcInitMotives()));
    // v84 动机触发：醒着且不在家时才外出版本有资格「饿了/无聊了」（home 睡觉由 homeHours 管）
    var motiveKeys = ["hunger", "social", "energy"];
    for (var mi = 0; mi < motiveKeys.length; mi++) {
      var mk = motiveKeys[mi];
      if (!npc.motives[mk] || npc.motives[mk] < NPC_MOTIVES[mk].trigger) continue;
      if (npc.act === "sleep" || npc.state === "home") continue;   // 睡觉/在家时段不动机
      if (mk === "energy") {                                       // 困了 → 回家（复用回家链路）
        npcRelieveMotives(npc.motives, "energy");
        npcSay(npc, npcMotiveLine(npc.def, NPC_MOTIVES.energy));
        npcGoHome(npc);
        return;
      }
      var anchor = npcMotiveTarget(npc.def, NPC_MOTIVES[mk]);
      if (!anchor) continue;
      npcRelieveMotives(npc.motives, mk);
      npc.state = "roaming";
      npcSetAct(npc, mk === "hunger" ? "wander" : "look");
      npcSay(npc, npcMotiveLine(npc.def, NPC_MOTIVES[mk]));
      npcWalkTo(npc, Math.round(anchor[0]), Math.round(anchor[1]), 400, function () { npcSetAct(npc, "idle"); });
      scheduleNpc(npc, 9000 + Math.random() * 7000);
      return;
    }
    var shouldHome = npcIsHome(npc.def);

    // 到点该回家
    if (shouldHome && npc.state !== "home") { npcGoHome(npc); return; }

    // 在家：睡觉 → 偶尔起身活动 → 再睡
    if (npc.state === "home") {
      if (!shouldHome) {                       // 起床出门
        npc.indoor = false;
        npcSetAct(npc, "idle");
        var gx = npc.def.roam[0] + Math.random() * (npc.def.roam[1] - npc.def.roam[0]);
        var gy = 8.5 + Math.random() * 4.5;
        npc.state = "roaming";
        npcWalkTo(npc, gx, gy, 420, function () { npcSetAct(npc, "idle"); });
        scheduleNpc(npc, 9500 + Math.random() * 8000);
        return;
      }
      // 还在家里时段：睡一会儿就起来伸个懒腰，再回去睡
      var t = npcTileOf(npc);
      var farFromBed = Math.abs(t.x - (npc.def._bed || npc.def.bedAt)[0]) + Math.abs(t.y - (npc.def._bed || npc.def.bedAt)[1]) > 2;
      if (!farFromBed && Math.random() < 0.35) {
        var ax = (npc.def._bed || npc.def.bedAt)[0] + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
        var ay = (npc.def._bed || npc.def.bedAt)[1] + (Math.random() < 0.5 ? -1 : 1) * (1 + Math.floor(Math.random() * 2));
        npcSetAct(npc, "wander");
        npcWalkTo(npc, ax, ay, 420, function () { npcSetAct(npc, "look"); });
        scheduleNpc(npc, 6000 + Math.random() * 6000);
      } else {
        npcSetAct(npc, "sleep");
        scheduleNpc(npc, 9000 + Math.random() * 8000);
      }
      return;
    }

    // 在外面：闲逛 / 发呆
    if (npc.state === "roaming") {
      if (Math.random() < 0.55) {
        var gx2 = npc.def.roam[0] + Math.random() * (npc.def.roam[1] - npc.def.roam[0]);
        var gy2 = 8.5 + Math.random() * 4.5;
        npcSetAct(npc, "wander");
        npcWalkTo(npc, gx2, gy2, 430, function () { npcSetAct(npc, "idle"); });
        scheduleNpc(npc, 8000 + Math.random() * 7000);
      } else {
        npcSetAct(npc, Math.random() < 0.5 ? "idle" : "look");
        scheduleNpc(npc, 4500 + Math.random() * 5000);
      }
      return;
    }
    scheduleNpc(npc, 6000 + Math.random() * 6000);
  }


  function npcInteractCheck() {
    if (!npcLayer.length) return null;
    if (fishState !== "idle" && fishState !== "acting") return null;
    for (var i = 0; i < npcLayer.length; i++) {
      var npc = npcLayer[i];
      if (npc.state === "home" || npc.indoor) continue;   // 回了屋的人街上当然碰不到
      if (npc.act === "sleep") continue;                  // v76：睡着的别叫醒
      var dx = Math.abs(npc.spr.x - fish.x), dy = Math.abs(npc.spr.y - fish.y);
      if (dx < TILE * 2.2 && dy < TILE * 1.8) return npc;
    }
    return null;
  }
  var lastNpcChat = 0;
  function tryNpcChat() {
    var npc = npcInteractCheck();
    if (!npc) return;
    var now = Date.now();
    if (now - lastNpcChat < 25000) return;
    lastNpcChat = now;
    var bucket = npcHourBucket();
    var pool = (NPC_DIALOGS[npc.def.id] || {})[bucket] || ["…"];
    var line = pool[Math.floor(Math.random() * pool.length)];
    showBubble(line, "idle");
    // NPC 回应气泡（头顶白泡，2.6s 消失）——"和邻居间的对话完全没有"的补全
    var replyPool = (NPC_DIALOGS[npc.def.id] || {})[bucket] || ["…"];
    var reply = replyPool[Math.floor(Math.random() * replyPool.length)];
    var bub = scene.add.text(npc.spr.x, npc.spr.y - npc.spr.displayHeight - 6, reply, {
      fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
      fontSize: "15px", color: "#151826", backgroundColor: "#fffdf8ee",
      padding: { x: 7, y: 4 }, align: "center", wordWrap: { width: 200 }
    }).setOrigin(0.5, 1).setDepth(94000);
    bub.setAlpha(0);
    scene.tweens.add({ targets: bub, alpha: 1, duration: 200, delay: 500 });
    scene.tweens.add({ targets: bub, alpha: 0, duration: 400, delay: 2800, onComplete: function () { bub.destroy(); } });
    var mark = scene.add.text(npc.spr.x, npc.spr.y - npc.spr.displayHeight - 8, "❢", { fontSize: "16px", color: "#f59f00" }).setOrigin(0.5).setDepth(9500);
    scene.tweens.add({ targets: mark, y: mark.y - 10, alpha: 0, duration: 1200, onComplete: function () { mark.destroy(); } });
    postStatDelta({ social: 10, mood: 3 });
    renderStatsBar();
  }


/* v84 调试钩子：NPC 动机层只读快照（验收/观察用，不参与逻辑） */
try {
  window.__officeNpcs = function () {
    return npcLayer.map(function (n) {
      return {
        id: n.def ? n.def.id : null, act: n.act, state: n.state, indoor: !!n.indoor,
        say: n.say ? n.say.text : null,
        x: Math.round((n.spr ? n.spr.x : 0) / 48), y: Math.round(((n.spr ? n.spr.y : 0) - 48) / 48 - 1),
        m: n.motives ? { hunger: Math.round(n.motives.hunger), social: Math.round(n.motives.social), energy: Math.round(n.motives.energy) } : null
      };
    });
  };
} catch (e) {}
