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
  /* v85.5：议论读者来信的台词（问题截断 18 字防气泡撑爆） */
  function mailTalkLine(q) {
    var t = String(q.text).replace(/[「」]/g, "").slice(0, 18);
    var tpl = [
      "有读者问「" + t + "」…大肥鱼记在本子上了",
      "收到封来信，问的是「" + t + "」",
      "「" + t + "」——这个问题有意思，大肥鱼说会写",
      q.from + "的来信你看到没？问的还挺深"
    ];
    return tpl[Math.floor(Math.random() * tpl.length)];
  }
  /* v85：议论博客的台词模板（口气×角度，title 截断防长标题撑爆气泡） */
  function blogTalkLine(def, title, views) {
    var t = String(title).slice(0, 22);
    var tpl = [
      "大肥鱼的新文章《" + t + "》你们看了吗",
      "刚看了眼《" + t + "》，写得还行",
      "大肥鱼又在写《" + t + "》这种东西…不过挺好玩的",
      "《" + t + "》里那个说法挺有意思的",
      "站长又更新了，《" + t + "》，去看看"
    ];
    // v85.2 阅读 >10 时 40% 概率换成显摆版（真实数据让 NPC 像真的在意流量）
    if (views >= 10 && Math.random() < 0.4) {
      var brag = ["《" + t + "》已经有 " + views + " 个人看了", "听说《" + t + "》阅读破 " + views + " 了，大肥鱼乐坏了"];
      return brag[Math.floor(Math.random() * brag.length)];
    }
    return tpl[Math.floor(Math.random() * tpl.length)];
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
  /* ---------- v85 博客联动：NPC 偶尔议论大肥鱼的新文章 ----------
   * 拉一次最新已发布文章标题（30 分钟缓存），social 动机触发时 35% 概率议论它——
   * 把「小镇」和「博客」两个产品缝在一起：观众看到 NPC 在聊博主的新作。 */
  var latestPost = { title: "", at: 0 }
  var readerQ = { text: "", from: "", at: 0 }
  function fetchReaderQ() {
    if (Date.now() - readerQ.at < 30 * 60000) return
    try {
      fetch("/api/reader-questions").then(function (r) { return r.ok ? r.json() : null }).then(function (d) {
        var it = d && d.items && d.items[0]
        if (it && it.text) readerQ = { text: it.text, from: it.from || "读者", at: Date.now() }
      }).catch(function () {})
    } catch (e) {}
  }
  function fetchLatestPost() {
    if (Date.now() - latestPost.at < 30 * 60000) return
    try {
      fetch("/pb/api/collections/posts/records?perPage=1&sort=-published_at&filter=" +
          encodeURIComponent("kind='article' && status='published'"))
        .then(function (r) { return r.ok ? r.json() : null })
        .then(function (d) {
          var it = d && d.items && d.items[0]
          if (it && it.title) latestPost = { title: it.title, views: it.views || 0, at: Date.now() }
        })
        .catch(function () {})
    } catch (e) {}
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
      // v85 博客联动：social 触发时 35% 概率议论最新文章（有缓存才说，否则走普通台词）
      if (mk === "social") {
        fetchLatestPost();
        fetchReaderQ();
        // v85.5 读者来信议论：有新来信时 25% 概率 NPC 读信（剩下的概率给博客议论）
        if (readerQ.text && Math.random() < 0.25) {
          npcRelieveMotives(npc.motives, "social");
          npc.state = "roaming";
          npcSetAct(npc, "look");
          npcSay(npc, mailTalkLine(readerQ));
          npcWalkTo(npc, Math.round(anchor[0]), Math.round(anchor[1]), 400, function () { npcSetAct(npc, "idle"); });
          scheduleNpc(npc, 9000 + Math.random() * 7000);
          return;
        }
        if (latestPost.title && Math.random() < 0.5) {   // v85.3 提到 50%：显摆台词是主打的博客联动，太罕见观众看不到
          npcRelieveMotives(npc.motives, "social");
          npc.state = "roaming";
          npcSetAct(npc, "look");
          npcSay(npc, blogTalkLine(npc.def, latestPost.title, latestPost.views || 0));
          npcWalkTo(npc, Math.round(anchor[0]), Math.round(anchor[1]), 400, function () { npcSetAct(npc, "idle"); });
          scheduleNpc(npc, 9000 + Math.random() * 7000);
          return;
        }
      }
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
  /* v2.6 NPC 认识鱼：对话素材来自 hub /api/npc-feed（鱼最近在 QQ/博客/空间干了什么）。
   * 缓存 10 分钟；拿不到就退回静态台词表（fail-open）。 */
  var npcFeed = null, npcFeedAt = 0;
  function npcFeedFetch() {
    if (npcFeed && Date.now() - npcFeedAt < 600000) return npcFeed;
    fetch(hubApiUrl("npc-feed")).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) { npcFeed = j; npcFeedAt = Date.now(); } })
      .catch(function () {});
    return npcFeed;
  }
  /* 按 NPC 性格把 feed 内容转成一句台词（拿不到素材返回 null，走静态池） */
  function npcDynamicLine(npcId, feed) {
    if (!feed) return null;
    var evs = feed.recentEvents || [];
    if (npcId === "chief") {
      // 村长：消息灵通，爱打听
      if (feed.lastShares && feed.lastShares.length && Math.random() < 0.4) {
        var s = feed.lastShares[0];
        if (s.type === "video") return "听说你昨天往群里甩了个视频？年轻人就是活跃。";
        if (s.type === "qzone") return "你空间那句话我看到啦，写得不错。";
      }
      if (feed.friends && feed.friends.length && Math.random() < 0.5) {
        return "群里那个" + feed.friends[0].name + "，看着挺健谈，你俩聊得来？";
      }
      if (evs.length && Math.random() < 0.3) return "镇口都传开了，你最近可够忙的。";
      return null;
    }
    if (npcId === "doc") {
      // 博士：只对技术/内容感兴趣
      if (feed.memes && feed.memes.length && Math.random() < 0.35) {
        return "你收藏的那些表情包……从传播学角度挺有意思。";
      }
      if (feed.qqMood != null && feed.qqMood >= 75 && Math.random() < 0.4) {
        return "你最近状态不错，数据上看得出来。（翻了一页书）";
      }
      if (evs.length && Math.random() < 0.25) return "又是群里那些事吧，我看你那屋一直亮灯。";
      return null;
    }
    if (npcId === "cat") {
      // 喵酱：只关心鱼本鱼
      if (feed.qqMood != null && feed.qqMood < 45 && Math.random() < 0.5) return "喵…（蹭蹭你，好像感觉你没精神）";
      if (evs.length >= 3 && Math.random() < 0.4) return "喵！（你这两天热闹得很嘛）";
      return null;
    }
    return null;
  }
  function tryNpcChat() {
    var npc = npcInteractCheck();
    if (!npc) return;
    var now = Date.now();
    if (now - lastNpcChat < 25000) return;
    lastNpcChat = now;
    var bucket = npcHourBucket();
    var feed = npcFeedFetch();
    // 55% 概率用动态台词（认识鱼的 NPC），其余走静态池
    var line = (feed && Math.random() < 0.55) ? npcDynamicLine(npc.def.id, feed) : null;
    if (!line) {
      var pool = (NPC_DIALOGS[npc.def.id] || {})[bucket] || ["…"];
      line = pool[Math.floor(Math.random() * pool.length)];
    }
    /* v2.9 关系档位：同一句话，熟人和生人说出来不一样。档位来自 hub /api/npc-feed 的 affinity，
     * 拿不到就是 stranger（离线也不乱套）。close 还会先主动挥手 —— 让"住了很久"这件事有可见证据。 */
    var tier = "stranger";
    try {
      var af = feed && feed.affinity && feed.affinity[npc.def.id];
      if (af && af.tier) tier = af.tier;
    } catch (e) {}
    if (tier === "close" && Math.random() < 0.55) {
      try {
        showBubble("（隔着半条街就朝你挥手）", "idle");
        scene.time.delayedCall(900, function () { if (bubbleText && bubbleText.text && bubbleText.text.indexOf("隔着半条街") === 0) showBubble(line, "idle"); });
      } catch (e) { showBubble(line, "idle"); }
    } else if (tier === "familiar" && Math.random() < 0.4) {
      showBubble("（熟门熟路地）" + line, "idle");
    } else {
      showBubble(line, "idle");
    }
    if (typeof window !== "undefined") {
      window.__officeNpcRel = function () { return { tier: tier, feed: !!feed }; };
    }
    // NPC 回应气泡（头顶白泡，2.6s 消失）——鱼也回一句（静态池里挑一句通用回应）
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
    interact("chat", { npc: npc.def.id });
    if (typeof Audio !== "undefined") Audio.fx("medium", "chat");   // v2.7：搭上话了一声
    // v2.6 邻里事件回流：NPC 对话写进 hub 事件流（"最近动态"可见），agent 侧的日记/文章
    // 素材池会经 eventsBlock 捞到它（external 事件源约定：POST /api/event 即可）。
    try {
      fetch(hubApiUrl("event"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: "relaxing", task: "和" + npc.def.name + "聊天",
          detail: String(line).slice(0, 60), ts: Date.now(), priority: 1
        })
      }).catch(function () {});
    } catch (e) {}
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

/* ---------- v85 P8.3 访客彩蛋：观众数 ≥3 且 10 分钟未触发过 → NPC 集体看镜头挥手 ----------
 * 由 life.js onStats(viewers) 调用；只在白天（醒着的 NPC）参加，睡觉的不喊起来。 */
var lastWaveAt = 0
try {
  window.__officeGuestWave = function (viewers) {
    if (!scene || !npcLayer.length) return
    if (viewers < 2) return   // v85.5 bot 过滤后真人少，2 人也算团聚
    if (Date.now() - lastWaveAt < 10 * 60000) return
    lastWaveAt = Date.now()
    var waved = 0
    npcLayer.forEach(function (npc) {
      if (npc.act === "sleep" || npc.state === "home") return
      npcSetAct(npc, "look")   // 面向镜头（camera 侧）
      npcSay(npc, ["有人来看我们了！", "嗨——", "欢迎来小镇玩", "挥手挥手"][Math.floor(Math.random() * 4)])
      waved++
    })
    if (waved) console.log("[office] 访客彩蛋触发: " + viewers + " 位观众，" + waved + " 只 NPC 挥手")
  }
} catch (e) {}