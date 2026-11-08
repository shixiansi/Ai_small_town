/* 大肥鱼的办公室 · Phaser 前端 v2
 *
 * 真实事件驱动（骨架）：WS 收到 agent 真实状态 → A* 寻路到目标区域 → 播放对应动作 → 气泡显示真实任务名
 * 本地生活模拟（灵魂）：无真实事件时浏览器本地跑零开销小循环（漫步/接水/看月亮/翻书/瘫沙发）
 *
 * v2 修正（对比 v1）：
 *  - 渲染锚点 = 精灵实测内容包围盒（bbox）的底边中心，不是帧底 → 物品脚踏实地、桌上物不漂移
 *  - 碰撞格 = 每件家具 bbox 底部投影（占地）自动推导 → 鱼不可能穿模
 *  - 深度 = 内容底边 y → 正确的前后遮挡（鱼在桌子后面被挡、前面挡桌子）
 *  - 物件动画（椅子/电脑屏/打印机等）只在对应工作状态时播放，其余时间静止首帧
 *  - 鱼四朝向：South/East/West/North（看窗边/书架时背对镜头）
 */
(function () {
  "use strict";

  var TILE = 48;
  /* 分房间灯光（v31）：每房间独立开关；AI 侧经 hub stats.lights 覆盖（睡觉只开卧室灯/睡前全关） */
  var roomLights = { office: true, bedroom: false, kitchen: false, bath: false };
  var COLS = 56, ROWS = 30, WALL_H = 48;   // 56x30：南排=办公室(0-24, rows16-29)；北排=卧室(2-9)/卫浴(11-15)；东侧=花园(27-37)/街道(39-55) 全高
  // 三扇窗：办公室主窗在 map.window；卧室窗/卫浴高窗在这里（x 格, 宽格, 高 px）
  var EXTRA_WINDOWS = [[3.3, 2, WALL_H - 22], [11.8, 1.4, WALL_H - 26]];
  var W = COLS * TILE, H = ROWS * TILE + WALL_H;
  // 素材版本号由 office/tools/bust.mjs 按 assets/*.png 内容幂等改写，勿手改
  var ASSET_V = "a2ac8525";

  // 状态 → 区域 + 朝向 + 动作 + 气泡动词
  var STATE_MAP = {
    /* 区域映射按「该状态该站在哪件家具前」校准（v15）：
     * 旧版 window/tools/mail 的锚点落在书架墙、奖杯柜、厨房灶台旁，
     * 于是「看视频」对着书架、「发邮件」站在果盘和灶台中间。
     * 现在：看视频/评论 → 餐桌笔记本、写日记/回评论 → 工位电脑、
     * 做封面 → 设计台、发邮件 → 门廊信箱、到岗 → 大门下。
     */
    arrive:    { zone: "door",    act: "walk",   verb: "到岗",      mood: "working" },
    // 泛化「正在工作」：agent/office_client.mjs 的 officeRun() 会推这个状态。
    // 旧版 STATE_MAP 没有它，onState 会静默兜底成 idle —— 鱼刚到岗就去沙发摸鱼、黄点。
    working:   { zone: "desk",    act: "typing", verb: "在忙",      mood: "working", fx: "pc" },
    browsing:  { zone: "desk",    act: "typing", verb: "刷B站",     mood: "working", fx: "pc" },
    watching:  { zone: "dining",  act: "watch",  verb: "看视频",    mood: "working" },
    organizing:{ zone: "library", act: "fetch",  verb: "整理记忆",  mood: "working" },
    writing:   { zone: "desk",    act: "typing", verb: "写文章",    mood: "working", fx: "pc" },
    rewriting: { zone: "desk",    act: "typing", verb: "改稿",      mood: "working", fx: "pc" },
    diary:     { zone: "desk",    act: "typing", verb: "写日记",    mood: "working", fx: "pc" },
    designing: { zone: "tools",   act: "craft",  verb: "做封面",    mood: "working" },
    posting:   { zone: "printer", act: "print",  verb: "发B站动态", mood: "working", fx: "printer" },
    mailing:   { zone: "mail",    act: "mail",   verb: "发邮件",    mood: "working" },
    replying:  { zone: "desk",    act: "typing", verb: "回评论",    mood: "working", fx: "pc" },
    commenting:{ zone: "dining",  act: "typing", verb: "B站评论",   mood: "working" },
    weekly:    { zone: "desk",    act: "typing", verb: "写周报",    mood: "working", fx: "pc" },
    error:     { zone: "sofa",    act: "dizzy",  verb: "出错了",    mood: "error" },
    idle:      { zone: "sofa",    act: "idle",   verb: "摸鱼中",    mood: "idle" },
    // 自主生活扩展（场景清单）：睡眠→卧室床、洗漱→卫浴、进食→餐厨、翻冰箱、放松→单人沙发
    sleeping:  { zone: "bed",     act: "sleep",  verb: "睡觉",      mood: "sleeping" },
    washing:   { zone: "washup",  act: "watch",  verb: "洗漱",      mood: "working" },
    eating:    { zone: "cook",    act: "fetch",  verb: "吃饭",      mood: "idle" },
    snacking:  { zone: "fridge",  act: "fetch",  verb: "找吃的",    mood: "idle" },
    relaxing:  { zone: "relax",   act: "rest",   verb: "放松",      mood: "idle" },
    strolling: { zone: "garden",  act: "walk",   verb: "散步",      mood: "idle" },
    browsing_market: { zone: "market", act: "fetch", verb: "逛市集", mood: "idle" },
    recovering:{ zone: "recover", act: "rest",   verb: "充电恢复",  mood: "sleeping" },
    listening: { zone: "relax",   act: "listen", verb: "听音乐",    mood: "idle" },
    gaming:    { zone: "arcade",  act: "play",   verb: "打游戏",    mood: "idle" },
  };
  var ACTIVE_STATES = ["arrive", "working", "browsing", "watching", "organizing", "writing", "rewriting",
    "diary", "designing", "posting", "mailing", "replying", "commenting", "weekly",
    "washing", "eating", "snacking", "relaxing", "strolling", "browsing_market", "recovering", "listening", "gaming"];

  /* ---------- 今日时间表（服务器上真实在跑的排班） ----------
   * 用户问过「现在的时间表是什么，怎么 19 点就睡觉了」：页面上原来只有一行状态，
   * 看不出「这个点到底该不该有活」，也分不清「没活所以摸鱼」和「真在干活」。
   * 这张表就是定时任务的影子，三处要保持一致：
   *   服务器 crontab → scripts/crontab.txt（记录）→ 这里（页面展示），tools/check.mjs 会核对。
   * 全部按北京时间（服务器 TZ=Asia/Shanghai）：访客在哪个时区看到的都是同一张表。
   *   at      本班开始时刻（HH:MM）
   *   every   每 N 小时重复一班（跨零点按 24 取模），不写就是每天只有这一班
   *   weekday 只在周几（0=周日），不写就是天天有
   *   dur     这一班大概跑多久（分钟），只用来在面板上标「此刻正在进行」
   *   silent  静默任务：不发办公室状态，鱼不会有反应，只是记在表上
   */
  var SCHEDULE = {
    tz: "Asia/Shanghai",
    wake: [8, 23],   // 这段时间里没有真实事件 → hub 回落成「摸鱼」；之外才回落到睡觉（见 hub/hub.mjs）
    shifts: [
      { at: "00:45", every: 4, dur: 2, label: "B站互动", note: "看评论 / 回赞 / 私信（bili_interact.mjs）" },
      { at: "03:30", dur: 1, label: "备份数据", note: "scripts/backup.sh · 静默任务，不上报状态", silent: true },
      { at: "08:25", every: 2, dur: 4, label: "回博客评论", note: "agent.mjs reply-comments · 有新评论才会上报" },
      { at: "09:00", dur: 6, label: "每日运营", note: "PocketBase cron：AI 写文 → 写库 → 发B站动态" },
      { at: "09:10", dur: 15, label: "每日 agent（第一场）", note: "刷B站 → 看视频 → 做封面 → 整理记忆 → 写文章 → 日记 → 发动态 → 日报邮件", state: "writing" },
      { at: "20:00", weekday: 0, dur: 10, label: "鱼缸周报", note: "agent/weekly.mjs · 只在周日跑" },
      { at: "21:10", dur: 15, label: "每日 agent（第二场）", note: "同上午流程，素材不与上午重复", state: "writing" }
    ]
  };

  // 事件流里的状态图标（视觉锚点，不参与任何逻辑）
  var ACT_ICON = {
    arrive: "🚪", working: "🖥️", browsing: "🖥️", watching: "📺", organizing: "📚", writing: "✍️",
    rewriting: "✍️", diary: "📔", designing: "🎨", posting: "🖨️", mailing: "📮", replying: "💬",
    commenting: "💬", weekly: "📊", error: "❌", idle: "🛋️", sleeping: "😴", washing: "🚿",
    eating: "🍚", snacking: "🧊", relaxing: "😌", strolling: "🌳", browsing_market: "🛒",
    recovering: "🔋", listening: "🎵", gaming: "🎮"
  };

  /* ---------- 大小关系 ----------
   * 精灵都是 32/48px 帧裁剪的，但物件真实体积差异大。
   * SCALE_TABLE：内容高度（px）→ 期望渲染高度占一格(48px)的比例上限。
   * 大件家具 ~1 格或更高 → scale 1；桌面小物（杯子/书/订书机）压到 0.55~0.7。
   * 未列入的默认 1。
   */
  var SCALE_TABLE = {
    "coffee-mug": 0.32, "stapler": 0.4, "calculator": 0.4, "open-book": 0.45,
    "paper-stack": 0.5, "book-stack": 0.5, "pencil-cup": 0.55, "desk-lamp": 0.6,
    "phone-desk": 0.5, "globe-desk": 0.65, "clock-desk": 0.65, "laptop": 0.55,
    "trophy-cup": 0.65, "computer": 1.05, "printer": 0.85,
    "bookshelf-office": 1.0, "office-chair": 1.0,
    "sofa": 1.0, "round-table": 0.9, "cabinet": 1.0, "filing-cabinet": 1.0,
    "locker": 1.0, "water-cooler": 1.0, "plant-office": 1.0, "floor-lamp": 1.0,
    "blackboard": 1.0, "whiteboard": 1.0,
    "office-desk": 1.3, "dining-table": 1.0, "desk-wood": 1.3, "nightstand": 0.8,
    "school-desk": 0.9, "chair": 0.85,
    "double-bed": 1.1, "wardrobe": 1.0, "curtains": 1.0, "mirror": 0.95, "toilet": 0.9,
    "bathtub": 1.0, "fridge": 1.0, "stove-kitchen": 1.0, "kitchen-counter": 1.0,
    "sink": 0.95, "fruit-bowl": 0.5, "kettle": 0.45, "mailbox": 0.9, "armchair": 1.0,
    "gramophone": 0.95, "arcade-cabinet": 1.0, "crown-cushion": 0.6, "bench-park": 1.0,
    "oak-tree": 1.6, "street-lamp": 1.1, "market-stall": 1.15, "stall-fruit": 1.15,
    "coin": 0.4, "potion-shelf": 1.0, "fence": 0.7, "sign-inn": 1.0, "fence-picket": 0.9,
    "bush": 0.9, "flowers": 0.7
  };

  // ---------- 全局 ----------
  var game = null;
  var scene = null;
  var fish = null;
  var fishState = "boot";       // boot | walking | acting | idle
  var curPlan = null;
  var bubble = null, bubbleText = null;
  var ws = null, wsTimer = null, reconnectDelay = 2000;
  var lastServerTs = 0;
  var lastEventState = "", lastEventTask = "";   // 心跳/重复事件去重：不让鱼原地重走一遍
  var idleTimer = null;
  var actTickTimer = null;
  var MAN = null;               // manifest 引用

  function px2tx(p) { return Math.floor(p / TILE); }
  function px2ty(p) { return Math.floor((p - WALL_H) / TILE); }

  // ---------- 启动场景 ----------
  /* 资源加载兜底：Phaser 的 loaderror 不会阻止 complete 事件，缺纹理会让 office 场景
   * 连锁抛错，而 #loading 遮罩永远停在「办公室布置中…」。这里统一收集失败项，
   * 在 complete 时拦下启动，并把可读原因写回遮罩。 */
  var loadErrors = [];
  function onLoadError(file) {
    var k = (file && (file.key || file.src)) || "未知资源";
    if (loadErrors.indexOf(k) < 0) loadErrors.push(k);
  }
  function showLoadError(errs) {
    var el = document.getElementById("loading");
    if (!el) { console.error("[office] 资源加载失败:", errs); return; }
    el.classList.remove("hide");
    el.style.cssText += ";flex-direction:column;padding:24px;text-align:center;line-height:1.8;";
    el.textContent = "";
    var h = document.createElement("div");
    h.textContent = "办公室资源加载失败";
    h.style.cssText = "color:#ff8787;font-size:15px;margin-bottom:8px";
    var d = document.createElement("div");
    d.style.cssText = "color:#9a9daa;font-size:12px;max-width:520px";
    d.textContent = "有 " + errs.length + " 个资源没能加载：" + errs.slice(0, 6).join("、") +
      (errs.length > 6 ? " 等" : "") + "。线上多半是漏同步了 assets/（跑一次 sync_web.sh），本地请确认 assets 目录完整。";
    var a = document.createElement("a");
    a.textContent = "点此刷新重试";
    a.href = "#";
    a.onclick = function (e) { e.preventDefault(); location.reload(); };
    a.style.cssText = "color:#4a6cf7;margin-top:12px;font-size:13px";
    el.appendChild(h); el.appendChild(d); el.appendChild(a);
    console.error("[office] 资源加载失败:", errs);
  }
  function SceneBoot() { Phaser.Scene.call(this, { key: "boot" }); }
  SceneBoot.prototype = Object.create(Phaser.Scene.prototype);
  SceneBoot.prototype.constructor = SceneBoot;
  SceneBoot.prototype.preload = function () {
    loadErrors = [];
    this.load.off("loaderror", onLoadError);
    this.load.on("loaderror", onLoadError);
    this.load.json("manifest", "assets/manifest.json?v=62612ac6");
    this.load.json("mapdata", "map.json?v=f689d826");
  };
  SceneBoot.prototype.create = function () {
    var manifest = this.cache.json.get("manifest");
    var mapdata = this.cache.json.get("mapdata");
    if (loadErrors.length || !manifest || !mapdata) {
      showLoadError(loadErrors.length ? loadErrors : ["manifest.json / map.json 读取失败"]);
      return;   // 不带缺失纹理启动 office 场景
    }
    Object.keys(manifest).forEach(function (k) {
      var m = manifest[k];
      this.load.spritesheet(k, "assets/" + k + ".png?v=" + ASSET_V, { frameWidth: m.frameW, frameHeight: m.frameH });
    }, this);
    this.load.once("complete", function () {
      if (loadErrors.length) { showLoadError(loadErrors); return; }
      this.scene.start("office", { manifest: manifest, mapdata: mapdata });
    }, this);
    this.load.start();
  };

  // ---------- 主场景 ----------
  function SceneOffice() { Phaser.Scene.call(this, { key: "office" }); }
  SceneOffice.prototype = Object.create(Phaser.Scene.prototype);
  SceneOffice.prototype.constructor = SceneOffice;
  SceneOffice.prototype.init = function (data) {
    this.manifest = data.manifest;
    this.mapdata = data.mapdata;
    MAN = data.manifest;
  };
  SceneOffice.prototype.create = function () {
    scene = this;
    var cv = this.game.canvas;
    if (cv) {
      cv.setAttribute("role", "img");
      cv.setAttribute("aria-label",
        "大肥鱼的像素办公室：蓝发鲸鱼女仆按真实工作状态在工位、餐桌、书架、沙发等区域走动。点地图让她走过去，点沙发、床、冰箱等家具会触发互动小动作。");
    }
    buildRoom(this);
    buildFurniture(this);   // 家具先建（含碰撞推导）
    buildFish(this);
    buildLights(this);
    // 暗角（评审 P2-1）：径向渐变纹理（一次生成，中心透明→边缘 28% 黑），铺满全图
    var vgTexKey = "vignetteTex";
    if (!this.textures.exists(vgTexKey)) {
      var cvs = this.textures.createCanvas(vgTexKey, W, H);
      var ctx2 = cvs.getContext();
      var grad = ctx2.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.36, W / 2, H / 2, Math.max(W, H) * 0.72);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.28)");
      ctx2.fillStyle = grad;
      ctx2.fillRect(0, 0, W, H);
      cvs.refresh();
    }
    // 暗角锁视口（评审 #12）：位置/尺寸按视口 1248x768，scrollFactor 0
    this.add.image(624, 384, vgTexKey).setDisplaySize(1248, 768).setDepth(60000).setScrollFactor(0);
    this.trophyLayer = this.add.container(0, 0).setDepth(30);      // 灯光：初始 = 关灯（hello 初始态"办公室还没开灯"）
    // 相机：视口 1248x768，世界 2112x768 → 跟随鱼 + 边界钳制
    this.cameras.main.setBounds(0, 0, W, H);
    this.cameras.main.startFollow(fish, true, 0.08, 0.08);
    // 死区：鱼在中间 1/3 移动时相机不动，减少晃动
    this.cameras.main.setDeadzone(300, 300);
    buildRoomTabs(this);    // 房间切换 UI
    buildWeather(this);     // 天气层
    buildNPCs(this);        // 小镇居民（方案 §3）
    farmLoad();             // 农场/鱼塘/料理（v36）：读档 + 画田地 + 塘面鱼影
    drawFarm(this);
    drawPond(this, this.add.graphics().setDepth(1));
    buildPondLife(this);
    // loading 提前隐藏（评审 P1-3）：场景本体已就绪，WS/事件后续异步补——中途异常不再滞留"办公室布置中…"
    var loading = document.getElementById("loading");
    if (loading) loading.classList.add("hide");
    var ppClose = document.getElementById("pp-close");
    if (ppClose) ppClose.onclick = hidePerfPanel;
    bindClick(this);
    connectWS();
    startIdleLife(1500);
  };

  // ---------- 天气系统（场景清单：天气层；玩家干预：R 键切换 晴/雨） ----------
  var weather = "sunny";   // sunny | rainy
  var rainParts = [];
  function buildWeather(s) {
    for (var i = 0; i < 80; i++) {
      var r = s.add.rectangle(Math.random() * W, Math.random() * H, 1.5, 10, 0x9db8e8, 0.5).setDepth(55000);
      r.visible = false;
      rainParts.push(r);
    }
    s.overcast = s.add.rectangle(0, 0, W, H, 0x3a4a66, 0.22).setOrigin(0).setDepth(54000).setVisible(false);
  }
  function setWeather(s, w) {
    weather = w;
    rainParts.forEach(function (r) { r.visible = (w === "rainy"); });
    if (s.overcast) s.overcast.setVisible(w === "rainy");
    if (scene && scene.mapdata) redrawWindow();
  }
  function tickWeather(s) {
    if (weather !== "rainy" || !rainParts.length) return;
    rainParts.forEach(function (r) {
      r.y += 7 + r.height * 0.4;
      r.x -= 1.2;
      if (r.y > H) { r.y = -10; r.x = Math.random() * W; }
    });
  }
  window.addEventListener("keydown", function (e) {
    if (e.key === "r" || e.key === "R") {
      if (scene) setWeather(scene, weather === "sunny" ? "rainy" : "sunny");
    }
  });

  // ---------- 小镇居民（方案 §3）：3 个 NPC，前端本地状态机，零后端成本 ----------
  /* NPC 精灵表 = gen_npc_skins.py 从 whale.png 色相重映射的换装副本（发色/衣色区分，帧结构一致） */
  var NPCS = [
    { id: "cat",   name: "喵酱", skin: "whale_cat",   home: "homeCat",  homeZone: "npc_cat",  indoor: "living_cat",   roam: [40, 54], homeHours: null,      desc: "镇上的橘猫" },
    { id: "chief", name: "村长", skin: "whale_chief", home: "homeChief",homeZone: "npc_chief",indoor: "living_chief", roam: [41, 54], homeHours: [20, 8],   desc: "热心的水豚村长" },
    { id: "doc",   name: "博士", skin: "whale_doc",   home: "homeDoc",  homeZone: "npc_doc",  indoor: "living_doc",   roam: [42, 54], homeHours: [21, 13],  desc: "研究潮汐的章鱼" }
  ];
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
    if (!def.homeHours) return false;
    var h = bjHour();
    var a = def.homeHours[0], b = def.homeHours[1];
    return a <= b ? (h >= a && h < b) : (h >= a || h < b);
  }
  function buildNPCs(s) {
    if (!s.mapdata) return;
    NPCS.forEach(function (def) {
      var home = s.hostMap[def.home];
      if (!home) return;
      var spr = s.add.sprite(home.x, home.y - 6, def.skin || "whale")
        .setScale(0.82).setOrigin(0.5, 1).setDepth(home.footY + 1);
      var tag = null;
      // 名牌：世界像素 15px，缩放屏上仍可辨（check 第 16 项管的是画布内文字防糊——NPC 名牌用大字）
      tag = s.add.text(0, 0, def.name, {
        fontFamily: "PingFang SC, Microsoft YaHei, sans-serif",
        fontSize: "15px", color: "#fff8e1", backgroundColor: "#15182699",
        padding: { x: 4, y: 2 }
      }).setOrigin(0.5, 1).setDepth(home.footY + 3);
      var npc = { def: def, spr: spr, tag: tag, home: home, state: "home", timer: null };
      // 在家/在街上状态圆点：挂在名牌旁，跟 positionNpcParts 一起走（进屋时连名牌一起收起）
      npc.dot = s.add.circle(0, 0, 3.2, npcIsHome(def) ? 0x51cf66 : 0xffd43b)
        .setStrokeStyle(1, 0x151826, 0.5).setDepth(home.footY + 3);
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
  }
  /* 在家时把 NPC 真正收进屋里：精灵站在屋内锚点旁半步（给串门的鱼让出落点）、名牌与圆点隐藏。
   * "回家"的最后一程走门洞（door zone 正对 gap），进屋路上不会被墙挡住视线。 */
  function setNpcIndoor(npc, indoor) {
    npc.indoor = !!indoor;
    var z = scene.mapdata.zones[indoor ? (npc.def.indoor || npc.def.homeZone) : npc.def.homeZone];
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
  function npcDoorTween(npc, toIndoor, onDone) {
    var zDoor = scene.mapdata.zones[npc.def.homeZone];
    var zIn = scene.mapdata.zones[npc.def.indoor || npc.def.homeZone];
    if (!zDoor || !zIn) { if (onDone) onDone(); return; }
    var step2 = function () {
      var tx = toIndoor ? zIn.anchor[0] * TILE + 18 : zDoor.anchor[0] * TILE;
      var ty = toIndoor ? WALL_H + zIn.anchor[1] * TILE - 6 : WALL_H + zDoor.anchor[1] * TILE;
      scene.tweens.add({
        targets: npc.spr, x: tx, y: ty, duration: 1500, ease: "Sine.InOut",
        onUpdate: function () { positionNpcParts(npc); },
        onComplete: function () { if (onDone) onDone(); }
      });
    };
    if (toIndoor) {
      // 先到门口（家门前街面），再拐进门洞
      scene.tweens.add({
        targets: npc.spr, x: zDoor.anchor[0] * TILE, y: WALL_H + zDoor.anchor[1] * TILE,
        duration: 1200, ease: "Sine.InOut",
        onUpdate: function () { positionNpcParts(npc); },
        onComplete: step2
      });
    } else step2();
  }
  function scheduleNpc(npc, delay) {
    if (npc.timer) clearTimeout(npc.timer);
    npc.timer = setTimeout(function () { npcStep(npc); }, delay);
  }
  function npcStep(npc) {
    if (!npc.spr || !npc.spr.active) return;
    var home = npcIsHome(npc.def);
    if (home && npc.state !== "home") { npcGoHome(npc); return; }
    if (!home && npc.state === "home") {
      npc.state = "roaming";
      // 出门：先穿门洞到自家门口，再往街面 roam 区溜达
      setNpcIndoor(npc, false);
      npcDoorTween(npc, false, function () {
        if (npc.state !== "roaming") return;
        var gx = npc.def.roam[0] + Math.random() * (npc.def.roam[1] - npc.def.roam[0]);
        var gy = 8.5 + Math.random() * 3.5;
        scene.tweens.add({ targets: npc.spr, x: gx * TILE, y: WALL_H + gy * TILE, duration: 6000 + Math.random() * 5000, ease: "Sine.InOut", onUpdate: function () { positionNpcParts(npc); } });
      });
      scheduleNpc(npc, 9000 + Math.random() * 8000);
      return;
    }
    if (!home && npc.state === "roaming") {
      if (Math.random() < 0.5) {
        var gx2 = npc.def.roam[0] + Math.random() * (npc.def.roam[1] - npc.def.roam[0]);
        var gy2 = 8.5 + Math.random() * 3.5;
        scene.tweens.add({ targets: npc.spr, x: gx2 * TILE, y: WALL_H + gy2 * TILE, duration: 5000 + Math.random() * 4000, ease: "Sine.InOut", onUpdate: function () { positionNpcParts(npc); } });
        scheduleNpc(npc, 7000 + Math.random() * 7000);
      } else {
        scheduleNpc(npc, 4000 + Math.random() * 5000);
      }
      return;
    }
    scheduleNpc(npc, 6000 + Math.random() * 6000);
  }
  function npcGoHome(npc) {
    npc.state = "home";
    // 回家动线两段式：先走到自家门口（路过可以被撞见），再穿过门洞进屋
    npcDoorTween(npc, true, function () {
      if (npc.state === "home") setNpcIndoor(npc, true);
    });
    scheduleNpc(npc, 8000 + Math.random() * 8000);
  }
  function npcInteractCheck() {
    if (!npcLayer.length) return null;
    if (fishState !== "idle" && fishState !== "acting") return null;
    for (var i = 0; i < npcLayer.length; i++) {
      var npc = npcLayer[i];
      if (npc.state === "home" || npc.indoor) continue;   // 回了屋的人街上当然碰不到
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
  var NEIGHBOR_HOMES = [
    { id: "cat",   home: "homeCat",   door: "doorCat",   living: "living_cat",   cx: 43 * TILE, cy: 24 * TILE, zm: 1.25 },
    { id: "chief", home: "homeChief", door: "doorChief", living: "living_chief", cx: 48 * TILE, cy: 24 * TILE, zm: 1.25 },
    { id: "doc",   home: "homeDoc",   door: "doorDoc",   living: "living_doc",   cx: 53 * TILE, cy: 24 * TILE, zm: 1.25 }
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
        cam.startFollow(fish, true, 0.08, 0.08);
        cam.setZoom(1);
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
    s.input.on("pointerdown", function (p) {
      if (!camDragOn) return;
      dragging = true; moved = false; lx = p.x; ly = p.y;
    });
    s.input.on("pointermove", function (p) {
      if (!camDragOn || !dragging || !p.isDown) return;
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
      if (camDragOn && moved) {
        // 拖完的一次「点击」不该再触发走位：挂一个短冷却，pointerdown 的走位逻辑看它退出
        camDragSuppress = Date.now() + 350;
        moved = false;
      }
    };
    s.input.on("pointerup", stop);
    s.input.on("pointerupoutside", stop);
    // 编辑模式拖动 + 放置预览（v37）
    s.input.on("pointermove", function (p) {
      if (!editMode) return;
      editPointerMove(p.worldX, p.worldY);
    });
    s.input.on("pointerup", function () { if (editMode) editPointerUp(); });
    s.input.on("pointerupoutside", function () { if (editMode) editPointerUp(); });
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
  /* ============ 渲染核心：基于 bbox 的定位 ============
   * 每个精灵帧内含透明留白；bbox = 内容真实范围 [x,y,w,h]（帧内坐标）。
   * 放置约定：map.json 的 (x,y) 是物品"落脚点"（底部中心的格子坐标）。
   * 叠加物用 "on": "宿主id" + dx/dy：坐标 = 宿主表面点（bbox 顶边中心）+ 偏移，
   * 深度 = 宿主 footY + 1，保证永远画在宿主之上、被更近的家具正确遮挡。
   */
  function makePlacement(f, hostMap) {
    var m = MAN[f.a];
    var bbox = m.bbox || [0, 0, m.frameW, m.frameH];
    var x, y, footY, depth;
    if (f.on && hostMap && hostMap[f.on]) {
      var h = hostMap[f.on];
      // 宿主 sprite 的 (x,y) 就是其内容底边中心（origin 已按 bbox 校准）：
      //   宿主内容中心世界 x = h.x；内容顶边世界 y = h.y - 宿主内容高度
      // 叠加物：内容中心落在 (h.x+dx, 宿主台面+dy)，dy 从宿主内容顶边往下量
      x = h.x + (f.dx || 0);
      y = (h.y - h.bbox[3]) + (f.dy || 0);
      footY = h.footY + 1;
      depth = footY;
    } else {
      x = f.x * TILE + TILE / 2 + (f.ox || 0);
      y = WALL_H + f.y * TILE + TILE / 2 + (f.oy || 0);
      footY = y;
      depth = f.wall ? -5 : footY;
    }
    // 大小关系：内容高度相对 48px 格的期望比例（SCALE_TABLE 给的是"内容渲染高度目标"）
    var cap = SCALE_TABLE[f.a];
    var scale = 1;
    if (cap) {
      // 目标：内容渲染高度 = cap * TILE。当前内容高度 bbox[3] → scale = cap*TILE/bbox[3]
      scale = Math.min(1.15, (cap * TILE) / Math.max(bbox[3], 1));
    }
    return {
      m: m, key: f.a, o: !!f.o, wall: !!f.wall, floor: !!f.floor, id: f.id,
      x: x, y: y,
      originX: (bbox[0] + bbox[2] / 2) / m.frameW,
      originY: (bbox[1] + bbox[3]) / m.frameH,
      footY: footY, depth: depth, bbox: bbox, scale: scale
    };
  }

  // ---------- 灯光系统 ----------
  /* 场景明暗：ambientCur = 亮度（1=全亮）；遮罩 alpha = 1 - ambientCur。
   * - state=sleeping（或 hello 初始态"还没开灯"）→ 关灯：遮罩 40%（评审建议 35~45%）
   * - 其他状态 → 开灯：遮罩 0
   * - 墙上开关可点击手动切换（手动优先，直到下一次真实状态事件把它带回自动）
   * 注意：旧版把 0.32 当成"遮罩 alpha"传给了亮度，实际得到 68% 黑，夜里几乎全黑。
   */
  var lightsOn = false;          // 当前灯状态
  var lightsManual = false;      // 用户手动切换过
  var ambient = null;            // 环境光覆盖 graphics（每帧重画 alpha）
  var ambientTarget = 0.42, ambientCur = 0.42;
  var lightPoolTex = "lightpool";

  function makeLightTexture(s) {
    if (s.textures.exists(lightPoolTex)) return;
    var size = 256, cv = document.createElement("canvas");
    cv.width = cv.height = size;
    var ctx = cv.getContext("2d");
    var g = ctx.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,244,214,0.95)");
    g.addColorStop(0.4, "rgba(255,238,196,0.5)");
    g.addColorStop(1, "rgba(255,236,190,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    s.textures.addCanvas(lightPoolTex, cv);
  }

  function buildLights(s) {
    makeLightTexture(s);   // 光晕纹理生成（v31 重构时误删调用 → Phaser __MISSING 绿色贴图冒充光池）
    // 吸顶灯 fixture——画 3 盏吊灯在墙上
    s.ceilingLamps = [];
    [[7.5, 0.5], [12.0, 0.5], [18.5, 0.5]].forEach(function (d) {
      var lx = d[0] * TILE, ly = WALL_H * d[1] + 6;
      s.add.line(0, 0, lx, 0, lx, ly, 0x4a4033).setLineWidth(2).setDepth(-90);
      var shade = s.add.triangle(lx, ly + 8, -12, -8, 12, -8, 0, 8, 0xe8b84a).setStrokeStyle(1.5, 0x8a6a1e).setDepth(-89);
      var bulb = s.add.circle(lx, ly + 8, 4, lightsOn ? 0xfff2c0 : 0x6a6155).setDepth(-88);
      s.ceilingLamps.push({ bulb: bulb, shade: shade });
    });

    // 灯光表达（v33 恢复 ADD 光晕池，用户拍板；α 压低避免刺眼）
    s.lightPools = [];
    var poolDefs = [
      { x: 9.0,  y: 21.4, r: 2.6, a: 0.22, tint: 0xffe2a8, room: "office" },   // 主工位
      { x: 11.4, y: 21.2, r: 2.0, a: 0.16, tint: 0xffe2a8, room: "office" },   // 木桌
      { x: 20.5, y: 21.4, r: 2.2, a: 0.18, tint: 0xffedd0, room: "office" },   // 产出簇
      { x: 4.5,  y: 27.8, r: 2.0, a: 0.16, tint: 0xffe2a8, room: "office" },   // 休息簇
      { x: 5.0,  y: 4.0,  r: 2.0, a: 0.20, tint: 0xffe2a8, room: "bedroom" },  // 卧室床头灯
      { x: 12.7, y: 3.2,  r: 1.8, a: 0.18, tint: 0xffe2a8, room: "bath" },     // 卫浴镜前灯
      { x: 20.5, y: 3.2,  r: 2.0, a: 0.18, tint: 0xffe2a8, room: "kitchen" },  // 厨房操作台灯
    ];
    poolDefs.forEach(function (d) {
      var img = s.add.image(d.x * TILE, WALL_H + d.y * TILE, lightPoolTex)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDisplaySize(d.r * TILE * 2, d.r * TILE * 2)
        .setAlpha(roomLights[d.room] ? d.a : 0)
        .setTint(d.tint || 0xffe2a8)
        .setDepth(50000);
      img.poolAlpha = d.a;
      img.room = d.room;
      s.lightPools.push(img);
    });
    // 窗边冷光（柔和）——主窗在办公室南墙上方
    var moon = s.add.image((s.mapdata.window.tx + 1) * TILE, WALL_H + 16.6 * TILE, lightPoolTex)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(4.5 * TILE, 6 * TILE)
      .setAlpha(roomLights.office ? 0.14 : 0.05)
      .setDepth(49999)
      .setTint(0xbfddf5);
    moon.room = "office";
    s.moonPool = moon;

    buildLampGlows(s);   // 路灯地灯圈（夜里亮，随昼夜重建）

    /* 每房间暗色遮罩（v31 用户反馈：开关只影响本房间亮度）
     * office: rows 16-29 / bedroom: cols 1-9 rows 1-14 / bath: cols 10-15 rows 1-14 / kitchen: cols 17-25 rows 1-14 */
    s.roomOverlays = {};
    var roomRects = {
      office:  [0, 15 * TILE, 26 * TILE, H - 15 * TILE],
      bedroom: [TILE, WALL_H + TILE, 9 * TILE, 14 * TILE - TILE],
      bath:    [10 * TILE, WALL_H + TILE, 6 * TILE, 14 * TILE - TILE],
      kitchen: [16.5 * TILE, WALL_H + TILE, 9 * TILE, 14 * TILE - TILE]
    };
    Object.keys(roomRects).forEach(function (key) {
      var r0 = roomRects[key];
      // 开灯=无遮罩（原色）；关灯=黑色遮罩
      var ov = s.add.rectangle(r0[0], r0[1], r0[2], r0[3], 0x0a1020)
        .setOrigin(0).setDepth(59000).setAlpha(roomLights[key] ? 0 : 0.60);
      s.roomOverlays[key] = ov;
    });

    // 环境遮罩：全屏黑 image，alpha = 夜间基础暗度（昼夜真实时间），开灯房间再被 roomOverlays 单独照亮
    var cv = s.textures.createCanvas("ambientcv", W, H);
    var ctx = cv.getContext();
    ctx.fillStyle = "#0a1020";
    ctx.fillRect(0, 0, W, H);
    cv.refresh();
    ambient = s.add.image(0, 0, "ambientcv").setOrigin(0).setDepth(60000).setAlpha(ambientCur);
    ambientTarget = 0;   // 全屏滤镜取消（v32）：关灯房间的暗度由 roomOverlays 黑遮罩承担，开灯房间显示原色——不再有"蒙一层"感

    // 每房间一个灯开关（v31 用户反馈：开关只影响本房间）
    // 位置：贴各房间上墙右侧；switchDefs [房间, x格, 说明]
    var switchDefs = [
      { room: "office",  x: 24.2, hint: "办公室灯" },
      { room: "bedroom", x: 8.6,  hint: "卧室灯" },
      { room: "bath",    x: 15.2, hint: "卫浴灯" },
      { room: "kitchen", x: 24.4, hint: "厨房灯" }
    ];
    s.roomSwitches = [];
    switchDefs.forEach(function (sd) {
      var sy = WALL_H * 0.45;
      var plate = s.add.rectangle(sd.x * TILE, sy, 18, 28, 0xe8e4da).setStrokeStyle(2, 0x5c5648).setDepth(60001).setInteractive({ useHandCursor: true });
      var lever = s.add.rectangle(sd.x * TILE, sy + (roomLights[sd.room] ? -5 : 5), 10, 10, roomLights[sd.room] ? 0xf5b942 : 0x8a8578).setDepth(60002);
      plate.setData("hint", sd.hint);
      plate.on("pointerover", function () { plate.setScale(1.12); });
      plate.on("pointerout", function () { plate.setScale(1); });
      plate.on("pointerdown", function () {
        roomLights[sd.room] = !roomLights[sd.room];
        lever.y = sy + (roomLights[sd.room] ? -5 : 5);
        lever.fillColor = roomLights[sd.room] ? 0xf5b942 : 0x8a8578;
        applyRoomLights(scene);
      });
      s.roomSwitches.push({ plate: plate, lever: lever, room: sd.room });
    });
  }

  /* 路灯地灯圈（v35 路网重设计）：本层只画灯，不再画路——
   * 室内走廊/门径与花园小径全部移除（房间回归纯净地板，鱼走 A* 不依赖画的路），
   * 户外道路只在 buildRoom 街道段：主路 + 通往各家门洞的门径。
   * 灯圈画在夜间遮罩之上（depth 59500），随昼夜重建 */
  function buildLampGlows(s) {
    if (s.lampGlows) { s.lampGlows.destroy(); }
    var night = isNightHour();
    var g = s.add.graphics().setDepth(59500);
    // 路灯暖光圈：夜里亮
    (s.mapdata.furniture || []).forEach(function (f) {
      if (f.a !== "street-lamp") return;
      var lx = f.x * TILE + 24, ly = WALL_H + f.y * TILE + 30;
      g.fillStyle(0xe8c87a, night ? 0.30 : 0);
      g.fillEllipse(lx, ly, 4.6 * TILE, 3.2 * TILE);
      g.fillStyle(0xf2d998, night ? 0.38 : 0);
      g.fillEllipse(lx, ly, 2.8 * TILE, 2.0 * TILE);
    });
    s.lampGlows = g;
  }

  function setLights(s, on) {
    /* 兼容入口：一次性设置全部房间灯（旧调用点），实际亮度走 applyRoomLights */
    lightsOn = on;
    roomLights.office = on; roomLights.bedroom = on; roomLights.kitchen = on; roomLights.bath = on;
    applyRoomLights(s);
  }

  /* 分房间灯光（v31 用户反馈：每房间一个开关只影响本房间；AI 夜间自主开关部分灯） */
  function applyRoomLights(s) {
    if (!s || !s.roomOverlays) return;
    // 各房间遮罩：开灯=ADD 暖提亮片 0.20；关灯=黑遮罩 0.55（切换含 blend/颜色，不能用 tween 渐变 blend——直接 set + alpha tween）
    Object.keys(s.roomOverlays).forEach(function (key) {
      var ov = s.roomOverlays[key];
      var isOutdoor = key === "outdoor";
      var lit = isOutdoor ? !isNightHour() : roomLights[key];
      ov.blendMode = lit ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL;
      ov.fillColor = lit ? 0xffe4b8 : 0x0a1020;
      s.tweens.add({ targets: ov, alpha: isOutdoor ? (lit ? 0 : 0.45) : (lit ? 0 : 0.60), duration: 600 });
    });
    // 灯池分房间
    (s.lightPools || []).forEach(function (p) {
      var rl = roomLights[p.room] !== false;
      s.tweens.add({ targets: p, alpha: rl ? p.poolAlpha : 0, duration: 600 });
    });
    // 窗外昼夜按真实时间（与灯解耦）——重绘窗户 + 路灯亮圈随昼夜重建
    redrawWindow();
    buildLampGlows(s);
  }

  function redrawWindow() {
    // 重画全部窗户（v24 三扇：办公室主窗 + 卧室窗 + 卫浴高窗），昼夜切换都要跟
    if (!scene || !scene.mapdata) return;
    if (scene.winRedraw) scene.winRedraw.destroy();
    var g = scene.add.graphics().setDepth(-99);
    var win = scene.mapdata.window;
    drawWindowSky(scene, g, win.tx * TILE, 8, win.tw * TILE, WALL_H - 18);
    EXTRA_WINDOWS.forEach(function (w2) {
      var rk = w2[0] < 8 ? "bedroom" : "bath";
      drawWindowSky(scene, g, w2[0] * TILE, 8, w2[1] * TILE, w2[2], rk);
      g.lineStyle(3, 0x5c6a80, 1); g.strokeRect(w2[0] * TILE, 8, w2[1] * TILE, w2[2]);
      g.lineBetween(w2[0] * TILE + w2[1] * TILE / 2, 8, w2[0] * TILE + w2[1] * TILE / 2, 8 + w2[2]);
      g.lineBetween(w2[0] * TILE, 8 + w2[2] / 2, w2[0] * TILE + w2[1] * TILE, 8 + w2[2] / 2);
    });
    g.lineStyle(3, 0x5c6a80, 1); g.strokeRect(win.tx * TILE, 8, win.tw * TILE, WALL_H - 18);
    g.lineBetween(win.tx * TILE + win.tw * TILE / 2, 8, win.tx * TILE + win.tw * TILE / 2, 8 + WALL_H - 18);
    scene.winRedraw = g;
  }

  function updateAmbient(s) {
    // 平滑趋近目标（ambientCur = 遮罩不透明度；v32 起目标恒 0=无全屏滤镜）
    ambientCur += (ambientTarget - ambientCur) * 0.06;
    if (ambient) ambient.setAlpha(ambientCur);
  }

  // ---------- 家具 ----------
  function buildFurniture(s) {
    s.props = [];        // 深度排序列表（含鱼）
    s.fxDirect = {};     // 工作特效：{ pc, printer, chair }
    s.hostMap = {};      // id → placement（供 on: 引用）

    // 第一遍：落地家具（有 id 的先注册）
    s.mapdata.furniture.forEach(function (f) {
      if (!f.on) {
        var p = makePlacement(f, null);
        p.f = f;
        s.hostMap[f.id] = p;
      }
    });
    // 第二遍：全部创建（on: 引用此时可用）
    s.mapdata.furniture.forEach(function (f) {
      var p = makePlacement(f, s.hostMap);
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
      if (!p.wall && !p.o && !f.on) {
        var shW = p.bbox[2] * (p.scale || 1) * 1.1;
        s.add.ellipse(p.x, p.y + 1, shW, 8, 0x3a2a1a, 0.25).setDepth(p.depth - 1);
      }
      p.spr = spr;
      s.props.push(p);
      if (f.id) s.hostMap[f.id] = p;   // 叠加物也可能被别人叠（如书架上的书）

      if (f.a === "computer") s.fxDirect.pc = { spr: spr, m: m, f: f };
      if (f.a === "printer") s.fxDirect.printer = { spr: spr, m: m, f: f };
      if (f.a === "office-chair") s.fxDirect.chair = { spr: spr, m: m, f: f };
    });

    applyCustomFurniture(s);   // v37：hub 自定义家具层叠加进 props/mapdata，再一起算碰撞
    buildBlockedGrid(s);
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

    s.props.forEach(function (p) {
      if (p.isFish || p.wall || p.o || p.f?.on) return;   // 鱼/墙饰/叠加物不产生碰撞（v37：rebuildCustomLayer 保留鱼重跑本函数时，鱼对象没有 bbox）
      var m = p.m, bbox = p.bbox;
      var footH = Math.min(12, bbox[3]);
      var left = p.x - m.frameW / 2 + bbox[0];
      var right = left + bbox[2];
      var top = p.y - footH;
      for (var gy = Math.floor((top - WALL_H) / TILE); gy <= Math.floor((p.y - WALL_H - 1) / TILE); gy++) {
        for (var gx = Math.floor(left / TILE); gx <= Math.floor((right - 1) / TILE); gx++) {
          if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) grid[gy][gx] = 1;
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
    s.grid = grid;
  }

  /* ============ 自定义地图层 + 编辑模式（v37） ============
   * hub 的 map.custom.json 里存的是「用户在编辑模式下加的家具」，叠加在 web/map.json 之上。
   * 走完 buildFurniture 后 applyCustomFurniture() 把它们再建一遍（同 makePlacement 语言），
   * 并重算碰撞格；编辑模式下鱼停下、点击语义从走位切换成放置/移动/删除。 */
  var customFurniture = [];        // hub 来的原始条目（真相在 hub，这里只是镜像）
  var customPlaceholders = [];     // { f, placement, spr } 建出来的实例
  var editMode = false;            // 编辑模式总开关
  var editTool = "select";         // select | add | move | delete
  var editAsset = null;            // add 工具当前选中的资产名
  var editDragItem = null;         // 正在拖动的条目
  var editGhost = null;            // add 模式跟随鼠标的半透明预览
  var editDirty = false;           // 本地有未保存改动
  var EDIT_PICKABLE = [            // 编辑器可选资产白名单（全部在 manifest 里）
    "office-desk", "desk-wood", "school-desk", "dining-table", "round-table", "bookshelf-office",
    "sofa", "armchair", "chair", "office-chair", "double-bed", "bed", "nightstand", "wardrobe",
    "cabinet", "locker", "filing-cabinet", "book-stack", "open-book", "paper-stack", "pencil-cup",
    "computer", "laptop", "printer", "phone-desk", "desk-lamp", "coffee-mug", "stapler", "calculator",
    "globe-desk", "clock-desk", "fruit-bowl", "kettle", "fridge", "stove-kitchen", "kitchen-counter",
    "sink", "bathtub", "toilet", "mirror", "curtains", "plant-office", "floor-lamp", "arcade-cabinet",
    "gramophone", "blackboard", "whiteboard", "crown-cushion", "water-cooler", "mailbox", "trophy-cup",
    "bench-park", "street-lamp", "oak-tree", "bush", "flowers", "fence", "fence-picket", "market-stall",
    "stall-fruit", "well", "potion-shelf", "sign-inn", "cottage", "farmhouse", "house-modern", "coin",
    "amulet", "wizard-hat", "robe"
  ];
  function hubMapBase() {
    // 本地：直连 hub:4321；线上：走 Nginx 的 /office-hub-api/ 反代（与 postStatDelta 同一条路）
    if (hubBase()) return hubBase();
    return "/office-hub-api";
  }
  /* 首建时把 hub 自定义条目合入 mapdata（buildFurniture 内调用；实例层由同一循环直接建） */
  function applyCustomFurniture(s) {
    if (!s || !s.mapdata || !customFurniture.length) return;
    customFurniture.forEach(function (f) {
      var copy = Object.assign({}, f);
      copy._custom = true;
      s.mapdata.furniture.push(copy);
    });
  }
  function rebuildCustomLayer() {
    var s = scene;
    if (!s || !s.mapdata) return;
    customPlaceholders.forEach(function (ph) { if (ph.spr) ph.spr.destroy(); if (ph.shadow) ph.shadow.destroy(); });
    customPlaceholders = [];
    // 从 mapdata 移除旧的自定义条目再重算（mapdata.furniture 只保留静态部分）
    s.mapdata.furniture = s.mapdata.furniture.filter(function (f) { return !f._custom; });
    customFurniture.forEach(function (f) {
      var copy = Object.assign({}, f);
      copy._custom = true;
      s.mapdata.furniture.push(copy);
    });
    // 家具层重建（鱼容器保留在 props 里，buildBlockedGrid 已跳过 isFish）：自定义数量少，整层重建最省心
    s.props = s.props ? s.props.filter(function (p) { return p.isFish; }) : [];
    s.hostMap = {};
    // 重建流程复用 buildFurniture 的两遍式，但不动 fxDirect 已有引用
    var fxKeep = s.fxDirect;
    s.fxDirect = {};
    s.mapdata.furniture.forEach(function (f) {
      var p = makePlacement(f, s.hostMap);
      if (!p) return;
      p.f = f;
      var m = p.m;
      var f0 = f.frame || 0;
      var spr;
      if (m.anim && m.rows && m.rows.East > 1) spr = s.add.sprite(p.x, p.y, f.a, f0).setOrigin(p.originX, p.originY).setDepth(p.depth);
      else spr = s.add.image(p.x, p.y, f.a, f0).setOrigin(p.originX, p.originY).setDepth(p.depth);
      if (p.scale !== 1) spr.setScale(p.scale);
      if (!p.wall && !p.o && !f.on) {
        var shW = p.bbox[2] * (p.scale || 1) * 1.1;
        p.shadow = s.add.ellipse(p.x, p.y + 1, shW, 8, 0x3a2a1a, 0.25).setDepth(p.depth - 1);
      }
      p.spr = spr;
      s.props.push(p);
      if (f.id) s.hostMap[f.id] = p;
      if (f._custom) customPlaceholders.push(p);
      if (f.a === "computer" && !fxKeep.pc) fxKeep.pc = { spr: spr, m: m, f: f };
      if (f.a === "printer" && !fxKeep.printer) fxKeep.printer = { spr: spr, m: m, f: f };
      if (f.a === "office-chair" && !fxKeep.chair) fxKeep.chair = { spr: spr, m: m, f: f };
    });
    s.fxDirect = fxKeep;
    buildBlockedGrid(s);   // 重算碰撞（含鱼塘 blocker + 新家具占地）
    if (gridOverlay) { gridOverlay.destroy(); gridOverlay = null; toggleGrid(true); }
    if (s.roomOverlays) { /* 遮罩层与家具无关，不动 */ }
    farmGfxRedrawSafe();
  }
  function farmGfxRedrawSafe() { try { if (farm && farmGfxTopmost()) drawFarm(); } catch (e) {} }
  function farmGfxTopmost() { return true; }
  function applyCustomMap(list) {
    customFurniture = (list || []).filter(function (f) { return f && f.a; });
    if (scene && scene.mapdata) { rebuildCustomLayer(); }
    if (typeof renderEditList === "function" && editMode) renderEditList();
  }
  /* 编辑模式开关：鱼停、点击语义切换、显示网格 */
  function setEditMode(on) {
    if (!scene || !fish) return editMode;
    editMode = !!on;
    var btn = document.getElementById("edit-mode-btn");
    if (btn) {
      btn.classList.toggle("active", editMode);
      btn.setAttribute("aria-pressed", String(editMode));
      btn.textContent = editMode ? "✏ 编辑中" : "✏ 编辑地图";
    }
    if (editMode) {
      stopIdleLife();
      hideBubble();
      if (!gridOverlay) toggleGrid(true);
      buildEditPanel();
      renderEditList();
      var panel0 = document.getElementById("edit-panel");
      if (panel0) panel0.style.display = "block";
      showBubble("（编辑模式：选资产后点地图放置；拖动物品移动；删除工具点物品移除）", "idle");
    } else {
      clearEditGhost();
      editDragItem = null;
      editTool = "select";
      setEditTool("select");
      var panel1 = document.getElementById("edit-panel");
      if (panel1) panel1.style.display = "none";
      startIdleLife(800);
      saveEditMap(true);   // 退出时若有改动顺手保存（静默）
    }
    return editMode;
  }
  function setEditTool(t) {
    editTool = t;
    ["select", "add", "move", "delete"].forEach(function (k) {
      var b = document.getElementById("edit-tool-" + k);
      if (b) b.classList.toggle("active", k === t);
    });
    if (t !== "add") clearEditGhost();
  }
  function setEditAsset(a) {
    editAsset = a;
    [].forEach.call(document.querySelectorAll("#edit-assets button"), function (b) {
      b.classList.toggle("active", b.dataset.asset === a);
    });
    if (a) setEditTool("add");
  }
  function clearEditGhost() {
    if (editGhost) { editGhost.destroy(); editGhost = null; }
  }
  function updateEditGhost(worldX, worldY) {
    if (editTool !== "add" || !editAsset || !scene) return;
    if (!editGhost) {
      editGhost = scene.add.image(worldX, worldY, editAsset, 0).setAlpha(0.55);
      var m = MAN[editAsset];
      if (m) {
        var bbox = m.bbox || [0, 0, m.frameW, m.frameH];
        editGhost.setOrigin((bbox[0] + bbox[2] / 2) / m.frameW, (bbox[1] + bbox[3]) / m.frameH);
      }
    }
    editGhost.setTexture(editAsset);
    var gx = Math.floor(worldX / TILE) * TILE + TILE / 2;
    var gy = Math.floor((worldY - WALL_H) / TILE) * TILE + WALL_H + TILE / 2;
    editGhost.setPosition(gx, gy);
    editGhost.setDepth(96000);
  }
  /* 命中检测：优先自定义层（可编辑），回退静态家具（提示只能删自定义的） */
  function pickEditItem(worldX, worldY) {
    var radius = TILE * 0.75;
    var best = null, bestD = Infinity;
    customPlaceholders.forEach(function (p) {
      if (!p.spr || !p.spr.active) return;
      var d = Math.max(Math.abs(p.x - worldX), Math.abs(p.y - worldY));
      if (d < radius && d < bestD) { bestD = d; best = p; }
    });
    return best;
  }
  /* 编辑点击：add=放置 / delete=删除 / move=抓起（拖动在 pointermove / 松手落定） */
  function editPointerDown(worldX, worldY) {
    if (editTool === "add" && editAsset) {
      var item = { a: editAsset, x: Math.round((worldX - TILE / 2) / TILE * 10) / 10 + 0.5, y: Math.round((worldY - WALL_H - TILE / 2) / TILE * 10) / 10 + 0.5 };
      item.x = Math.round(Math.min(55.5, Math.max(0.5, item.x)) * 10) / 10;
      item.y = Math.round(Math.min(29.5, Math.max(0.5, item.y)) * 10) / 10;
      saveEditMap(false, { action: "add", item: item }, function (ok, err) {
        if (ok) showBubble("已放置 " + editAsset, "idle");
        else showBubble("放置失败：" + err, "error");
      });
      return true;
    }
    var hit = pickEditItem(worldX, worldY);
    if (editTool === "delete") {
      if (!hit) return true;
      var fid = hit.f.id;
      saveEditMap(false, { action: "remove", item: { id: fid } }, function (ok, err) {
        showBubble(ok ? "已删除" : "删除失败：" + err, ok ? "idle" : "error");
      });
      return true;
    }
    if (editTool === "move" && hit) {
      editDragItem = hit;
      showBubble("（拖到新位置后松手）", "idle");
      return true;
    }
    return false;   // select：走默认点击语义
  }
  function editPointerMove(worldX, worldY) {
    if (editDragItem && editDragItem.spr) {
      var gx = Math.round((worldX - TILE / 2) / TILE * 10) / 10 + 0.5;
      var gy = Math.round((worldY - WALL_H - TILE / 2) / TILE * 10) / 10 + 0.5;
      gx = Math.min(55.5, Math.max(0.5, gx));
      gy = Math.min(29.5, Math.max(0.5, gy));
      editDragItem.spr.x = gx * TILE;
      editDragItem.spr.y = WALL_H + gy * TILE;
      editDragItem.spr.setDepth(editDragItem.spr.y);
      if (editDragItem.shadow) { editDragItem.shadow.x = editDragItem.spr.x; editDragItem.shadow.y = editDragItem.spr.y + 1; editDragItem.shadow.setDepth(editDragItem.spr.depth - 1); }
      editDragItem._dragX = gx; editDragItem._dragY = gy;
      return true;
    }
    if (editTool === "add") { updateEditGhost(worldX, worldY); return true; }
    return false;
  }
  function editPointerUp() {
    if (editDragItem && editDragItem._dragX != null) {
      var f = editDragItem.f;
      var nx = editDragItem._dragX, ny = editDragItem._dragY;
      saveEditMap(false, { action: "move", item: { id: f.id, x: nx, y: ny } }, function (ok, err) {
        showBubble(ok ? "已移动" : "移动失败：" + err, ok ? "idle" : "error");
      });
      editDragItem._dragX = editDragItem._dragY = null;
    }
    editDragItem = null;
  }
  /* 保存到 hub：item 为空 = 全量 set；hub 不在线时只动本地镜像（并提示） */
  function saveEditMap(silent, payload, cb) {
    var base = hubMapBase();
    var done = function (ok, err) { if (cb) cb(ok, err); if (!ok && !silent && err) addEditLog("保存失败：" + err); };
    if (!base) {
      // 线上没有 hub HTTP 口：本地镜像生效（重启丢失），明确提示
      if (payload && payload.action === "add") { customFurniture.push(payload.item); rebuildCustomLayer(); }
      else if (payload && payload.action === "remove") { customFurniture = customFurniture.filter(f => f.id !== payload.item.id); rebuildCustomLayer(); }
      else if (payload && payload.action === "move") {
        var it = customFurniture.find(f => f.id === payload.item.id);
        if (it) { it.x = payload.item.x; it.y = payload.item.y; rebuildCustomLayer(); }
      }
      done(false, "线上未开放地图保存（Nginx 只反代 WS）——改动仅本次生效");
      return;
    }
    var body = payload || { action: "set", item: customFurniture };
    var url = base.indexOf("://") >= 0 ? base + "/api/map" : base + "/map";   // 本地拼 /api/map；线上反代已含 /api/
    fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (r) {
        if (r.status === 200) { done(true); if (!silent) addEditLog("已保存（" + (r.j.count || 0) + " 条）"); }
        else done(false, r.j && r.j.error || ("HTTP " + r.status));
      })
      .catch(function (e) { done(false, e.message); });
  }
  function addEditLog(msg) {
    var box = document.getElementById("edit-log");
    if (!box) return;
    var d = document.createElement("div");
    d.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }) + " " + msg;
    box.prepend(d);
    while (box.children.length > 8) box.removeChild(box.lastChild);
  }
  /* 编辑面板 DOM：资产选择 + 工具 + 条目列表 */
  function buildEditPanel() {
    if (document.getElementById("edit-panel")) return;
    var host = document.getElementById("office-parent");
    if (!host) return;
    var panel = document.createElement("div");
    panel.id = "edit-panel";
    panel.style.cssText = "position:absolute;z-index:45;left:14px;top:52px;width:262px;max-height:560px;overflow:auto;" +
      "border-radius:10px;background:#1d2130f2;border:1px solid #ffffff33;color:#ece8df;box-shadow:0 6px 20px #0008;display:none;" +
      "font:12px/1.6 'PingFang SC','Microsoft YaHei',system-ui,sans-serif;padding:10px 12px;";
    panel.innerHTML =
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><b style="color:#ffd43b">地图编辑</b>' +
      '<button id="edit-close" style="margin-left:auto;border:0;background:transparent;color:#9aa3b8;cursor:pointer;font-size:15px">×</button></div>' +
      '<div style="display:flex;gap:5px;margin-bottom:8px">' +
      ["select|🖱 选择", "add|➕ 放置", "move|✥ 移动", "delete|🗑 删除"].map(function (p) {
        var kv = p.split("|");
        return '<button id="edit-tool-' + kv[0] + '" data-tool="' + kv[0] + '" style="flex:1;padding:4px 2px;border-radius:6px;border:1px solid #ffffff33;background:#2a2e3d;color:#ece8df;cursor:pointer;font-size:11.5px">' + kv[1] + "</button>";
      }).join("") + "</div>" +
      '<div id="edit-assets" style="display:grid;grid-template-columns:repeat(4,1fr);gap:4px;max-height:190px;overflow:auto;margin-bottom:8px"></div>' +
      '<div style="display:flex;gap:5px;margin-bottom:6px">' +
      '<button id="edit-save" style="flex:1;padding:5px;border-radius:6px;border:0;background:#4a6cf7;color:#fff;cursor:pointer;font-weight:700">💾 保存到服务器</button>' +
      '<button id="edit-clear" style="flex:none;padding:5px 8px;border-radius:6px;border:1px solid #ffffff33;background:transparent;color:#ff8787;cursor:pointer">清空</button></div>' +
      '<div style="color:#9aa3b8;margin-bottom:4px">已添加 <span id="edit-count">0</span> 件（上限 400）</div>' +
      '<div id="edit-list" style="max-height:120px;overflow:auto;margin-bottom:6px"></div>' +
      '<div id="edit-log" style="color:#8ce99a;min-height:16px;font-size:11px"></div>';
    host.appendChild(panel);
    panel.querySelector("#edit-close").onclick = function () { setEditMode(false); };
    panel.querySelector("#edit-save").onclick = function () { saveEditMap(false, null, function (ok, err) { addEditLog(ok ? "全量已保存" : "保存失败：" + err); }); };
    panel.querySelector("#edit-clear").onclick = function () {
      if (!confirm("清空全部 " + customFurniture.length + " 件自定义物品？")) return;
      saveEditMap(false, { action: "set", item: [] }, function (ok, err) { addEditLog(ok ? "已清空" : "清空失败：" + err); });
    };
    ["select", "add", "move", "delete"].forEach(function (k) {
      var b = panel.querySelector("#edit-tool-" + k);
      b.onclick = function () { setEditTool(k); };
    });
    var wrap = panel.querySelector("#edit-assets");
    EDIT_PICKABLE.forEach(function (a) {
      var b = document.createElement("button");
      b.dataset.asset = a;
      b.title = a;
      b.style.cssText = "padding:3px 1px;border-radius:5px;border:1px solid #ffffff22;background:#2a2e3d;color:#c3c9d9;cursor:pointer;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      b.textContent = a.replace(/^(office|kitchen|market|round|school|dining|double|bench|stall|sign|filing|floor|desk|crown|house)-/, "");
      b.onclick = function () { setEditAsset(a); };
      wrap.appendChild(b);
    });
    setEditTool("select");
  }
  function renderEditList() {
    var el = document.getElementById("edit-list");
    var cnt = document.getElementById("edit-count");
    if (cnt) cnt.textContent = String(customFurniture.length);
    if (!el) return;
    el.innerHTML = customFurniture.slice(-60).reverse().map(function (f) {
      return '<div style="display:flex;gap:6px;padding:2px 0;border-bottom:1px dashed #ffffff12">' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + f.a + "</span>" +
        '<span style="color:#9aa3b8">' + f.x + "," + f.y + "</span>" +
        '<button data-del="' + f.id + '" style="border:0;background:transparent;color:#ff8787;cursor:pointer;padding:0 2px">✕</button></div>';
    }).join("");
    [].forEach.call(el.querySelectorAll("button[data-del]"), function (b) {
      b.onclick = function () { saveEditMap(false, { action: "remove", item: { id: b.dataset.del } }, function (ok, err) { addEditLog(ok ? "已删除" : err); }); };
    });
  }


  // ---------- A* ----------
  function astar(sx, sy, ex, ey) {
    if (!scene || !scene.grid) return null;
    if (sx === ex && sy === ey) return [{ x: ex, y: ey }];
    // 目标格被堵：找目标周围最近的可达格
    if (scene.grid[ey] && scene.grid[ey][ex]) {
      var alt = nearestFree(ex, ey);
      if (!alt) return null;
      ex = alt.x; ey = alt.y;
    }
    var open = [{ x: sx, y: sy, g: 0, f: 0, p: null }];
    var closed = {};
    var best = null, guard = 0;
    while (open.length && guard++ < 4000) {
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      var cur = open.splice(bi, 1)[0];
      var key = cur.x + "," + cur.y;
      if (closed[key]) continue;
      closed[key] = 1;
      if (cur.x === ex && cur.y === ey) { best = cur; break; }
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var d = 0; d < 4; d++) {
        var nx = cur.x + dirs[d][0], ny = cur.y + dirs[d][1];
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        if (scene.grid[ny][nx]) continue;
        open.push({ x: nx, y: ny, g: cur.g + 1, f: cur.g + 1 + Math.abs(nx - ex) + Math.abs(ny - ey), p: cur });
      }
    }
    if (!best) return null;
    var path = [], n = best;
    while (n) { path.unshift({ x: n.x, y: n.y }); n = n.p; }
    return path;
  }
  function nearestFree(ex, ey) {
    for (var r = 1; r <= 3; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          var nx = ex + dx, ny = ey + dy;
          if (nx < 1 || ny < 1 || nx >= COLS || ny >= ROWS) continue;
          if (!scene.grid[ny][nx]) return { x: nx, y: ny };
        }
      }
    }
    return null;
  }

  // ---------- 鱼（鲸鱼女仆） ----------
  /* whale.png 前 4 行仍是四方向 × 8 帧行走（索引不变），第 4 行起是一整套动作帧。
   * 行号表在 manifest.json / whale.json 的 whale.acts，由 tools/gen_whale.py 生成。 */
  var ACT_RATE = {
    idle: 4, idle_back: 4, typing: 9, typing_back: 9, read: 3, sleep: 2,
    drink: 4, wave: 8, lounge: 2, cheer: 7, sit: 3, think: 3,
    play: 8, eat: 5, dizzy: 8, reach: 5
  };
  // 状态里的 act → 动作行；背对镜头时自动切到背面行
  var ACT_ANIM = {
    walk: "idle", idle: "idle", rest: "idle", watch: "idle",
    typing: "typing", print: "reach", mail: "reach", craft: "think",
    fetch: "reach", listen: "idle", play: "play", dizzy: "dizzy",
    sleep: "sleep", drink: "drink", read: "read", lounge: "lounge",
    cheer: "cheer", sit: "sit", think: "think", eat: "eat",
    wave: "wave", reach: "reach"   // 本地生活事件直接用动作行名
  };
  function actRow(act) {
    var name = ACT_ANIM[act] || "idle";
    if (fish && fish.lastFace === "n") {
      if (name === "idle") name = "idle_back";
      else if (name === "typing") name = "typing_back";
    }
    return name;
  }
  function buildFish(s) {
    var m = MAN.whale;
    var acts = m.acts || {};
    var mk = function (key, row, rate) {
      if (!s.anims.exists(key)) {
        s.anims.create({
          key: key,
          frames: s.anims.generateFrameNumbers("whale", { start: row * 8, end: row * 8 + 7 }),
          frameRate: rate || 10, repeat: -1
        });
      }
    };
    mk("fish_s", 0); mk("fish_e", 1); mk("fish_w", 2); mk("fish_n", 3);
    Object.keys(acts).forEach(function (name) {
      if (name.indexOf("walk_") === 0) return;
      mk("act_" + name, acts[name], ACT_RATE[name]);
    });
    var bbox = m.bbox;   // [20,15,24,40] 内容中心 x=32(帧中心), 底边 y=55
    // 容器原点 = 鱼脚点（内容底边中心）。body 的帧中心相对脚点的偏移：
    var bodyOffX = m.frameW / 2 - (bbox[0] + bbox[2] / 2);   // ≈ 0
    var bodyOffY = m.frameH / 2 - (bbox[1] + bbox[3]);       // 负值，把帧中心抬到脚点上方
    fish = s.add.container(TILE * 3, WALL_H + TILE * 3);
    var body = s.add.sprite(bodyOffX, bodyOffY, "whale", 0);
    var shadow = s.add.ellipse(0, 0, 30, 9, 0x000000, 0.22);
    var badge = s.add.circle(0, -46, 5, 0x4a4e60).setStrokeStyle(1, 0x151826, 0.4);
    fish.add([shadow, body, badge]);
    fish.bodySpr = body;
    fish.badge = badge;
    fish.baseY = bodyOffY;   // stopActAnim/update 复位用
    fish.setScale(0.95);
    fish.lastFace = "s";
    fish.face = function (dir) {
      fish.lastFace = dir;
      body.play(dir === "e" ? "fish_e" : dir === "w" ? "fish_w" : dir === "n" ? "fish_n" : "fish_s");
    };
    // still(): 停在"当前朝向"那行的第 0 帧（而不是永远 South）
    fish.still = function () {
      body.anims.stop();
      var row = fish.lastFace === "e" ? 1 : fish.lastFace === "w" ? 2 : fish.lastFace === "n" ? 3 : 0;
      body.setFrame(row * 8);
    };
    // 播放一整行动作帧；返回 false 表示精灵表没这一行（老版本资源时兜底到静态朝向帧）
    fish.playAct = function (name) {
      var row = acts[name];
      if (row === undefined) return false;
      body.play("act_" + name, true);
      return true;
    };
    fish.setBadge = function (hex) { badge.fillColor = parseInt(hex.replace("#", ""), 16); };
    s.props.push({ spr: fish, footY: fish.y, isFish: true });
  }

  // ---------- 深度排序（每帧：只调鱼与家具的相对关系） ----------
  function depthSort() {
    if (!scene || !fish) return;
    if (fish.sitting) return;   // 坐进家具时深度已手动指定，不被 y 覆盖
    fish.setDepth(fish.y);
  }

  // ---------- 房间 ----------
  function buildRoom(s) {
    if (s.baseGfx) { try { s.baseGfx.destroy(); } catch (e) {} }   // rebuildRoomBase 旧层先拆
    var g = s.add.graphics({ x: 0, y: 0 }).setDepth(-100).setVisible(true);
    g._isBaseGfx = true;   // v36：道路层重建后旧 Phaser 版 destroy 会把新层误标 visible=false（见 rebuildRoomBase）
    s.baseGfx = g;
    // 地板：双色明度差 ≥40/255（评审 #5：原 130 vs 147 差 17 太糊；现深格压到 L≈105）
    g.fillStyle(0x9c7750, 1); g.fillRect(0, WALL_H, W, H - WALL_H);
    g.fillStyle(0x98734c, 1);
    for (var y = 0; y < ROWS; y++)
      for (var x = 0; x < COLS; x++)
        if ((x + y) % 2 === 0) g.fillRect(x * TILE, WALL_H + y * TILE, TILE, TILE);
    // 户外花园 (cols 27-37)：纯草地（v35 路网重设计：花园小径删除，草皮直通街道主路）
    var gx0 = 26.5 * TILE, gx1 = 38.5 * TILE;
    g.fillStyle(0x6e9453, 1); g.fillRect(gx0, WALL_H, gx1 - gx0, H - WALL_H);
    g.fillStyle(0x6b8f50, 1);
    for (var gy2 = 0; gy2 < ROWS; gy2++)
      for (var gx2 = 27; gx2 < 38; gx2++)
        if ((gx2 + gy2) % 2 === 0) g.fillRect(gx2 * TILE, WALL_H + gy2 * TILE, TILE, TILE);

    // 小镇街道 (cols 39-55)：石板路（v24 回字形东侧全高）
    var tx0 = 38.5 * TILE, tx1 = 55.5 * TILE;
    g.fillStyle(0x7c7e8c, 1); g.fillRect(tx0, WALL_H, tx1 - tx0, H - WALL_H);
    g.fillStyle(0x79808b, 1);
    for (var ty2 = 0; ty2 < ROWS; ty2++)
      for (var tx2 = 39; tx2 < 56; tx2++)
        if ((tx2 + ty2) % 2 === 0) g.fillRect(tx2 * TILE, WALL_H + ty2 * TILE, TILE, TILE);
    // 街心主路：暖石板横穿（v36 抽成 drawRoads：debug 台可单独开关道路层）
    // 三户邻居室内地板（南排 rows19-29）：喵酱家暖木地板 / 村长家暖黄地砖 / 博士家蓝灰地毯
    // 各家铺各家色，走进去"换了空间"；门口前先铺屋内色，与门洞外街道形成材质分界
    function drawHomeFloor(x0, x1, base, alt) {
      g.fillStyle(base, 1);
      g.fillRect(x0 * TILE, WALL_H + 19 * TILE, (x1 - x0) * TILE, 10.5 * TILE);
      g.fillStyle(alt, 1);
      for (var fy = 19; fy < 29; fy++)
        for (var fx = x0; fx < x1; fx++)
          if ((fx + fy) % 2 === 0) g.fillRect(fx * TILE, WALL_H + fy * TILE, TILE, TILE);
    }
    drawHomeFloor(39.6, 45.4, 0x8a6a4a, 0x846545);   // 喵酱家：暖木地板
    drawHomeFloor(45.6, 50.4, 0xb59a6e, 0xb0936a);   // 村长家：暖黄地砖
    drawHomeFloor(50.6, 55.4, 0x7d88a0, 0x79839a);   // 博士家：蓝灰地毯
    /* 道路系统（v35 重设计）：整张世界只保留小镇街道一张路网——
     * 1) 街心主路：暖石板横穿 cols 38.5-55.5，北缘 y8.6 贴房子南缘
     * 2) 门径：从 map.walls y19 横墙的门洞（gap）动态推导——向北接到主路南缘 y9.8，
     *    向南铺出门洞 1.4 格当迎宾垫。另一个窗口调整邻居家布局/挪门洞时，
     *    小径自动跟着 gap 走，不会再出现「路对不上门口」。
     * 3) 花园一侧不再画路：草皮直通主路西端（土路肩相接），花园回归纯草地
     * v36：全部挪进 drawRoads()，debug 台「道路层」开关可以单独隐藏/显示它。 */
    drawRoads(s, g, tx0, tx1);
    // 卫浴瓷砖（北排 cols 10-16, rows 1-15 全高）+ 厨房地砖（cols 16.5-25 淡暖灰，材质分区）
    g.fillStyle(0x8e9ca6, 1);
    g.fillRect(9.5 * TILE, WALL_H, 6.5 * TILE, 15 * TILE);
    g.fillStyle(0xa3b0b8, 1);
    for (var by2 = 0; by2 < 15; by2++)
      for (var bx2 = 10; bx2 < 16; bx2++)
        if ((bx2 + by2) % 2 === 0) g.fillRect(bx2 * TILE, WALL_H + by2 * TILE, TILE, TILE);
    g.fillStyle(0xc4b8a2, 1);
    g.fillRect(16.5 * TILE, WALL_H, 8.5 * TILE, 15 * TILE);
    g.fillStyle(0xd0c3ad, 1);
    for (var ky2 = 0; ky2 < 15; ky2++)
      for (var kx2 = 17; kx2 < 25; kx2++)
        if ((kx2 + ky2) % 2 === 0) g.fillRect(kx2 * TILE, WALL_H + ky2 * TILE, TILE, TILE);
    // 花园→街道过渡带：土路肩
    g.fillStyle(0xb9a27b, 1);
    g.fillRect(38.5 * TILE, WALL_H, 1.2 * TILE, H - WALL_H);
    // 顶部墙（评审 #9）——花园段(x>=41.5)露天：画天空渐变而不是墙
    var ow = 26.5 * TILE;
    var door = s.mapdata.door;
    var dL = door.tx * TILE, dW = door.tw * TILE;
    // 北墙：门口断开（空缺表示，评审 #5）——左段/右段分开画
    g.fillStyle(0x66738a, 1);
    g.fillRect(0, 0, dL, WALL_H);
    g.fillRect(dL + dW, 0, ow - dL - dW, WALL_H);
    g.fillStyle(0x525d73, 1);
    g.fillRect(0, WALL_H - 6, dL, 6);
    g.fillRect(dL + dW, WALL_H - 6, ow - dL - dW, 6);
    g.fillStyle(lightsOn ? 0x8fc3e8 : 0x1d2438, 1); g.fillRect(ow, 0, W - ow, WALL_H);
    // 门框（两侧 2px 竖线：上亮下暗）+ 门槛线
    g.fillStyle(0x8492ac, 1);
    g.fillRect(dL - 2, 0, 2, WALL_H); g.fillRect(dL + dW, 0, 2, WALL_H);
    g.fillStyle(0x3b4459, 1);
    g.fillRect(dL, 0, 2, WALL_H); g.fillRect(dL + dW - 2, 0, 2, WALL_H);
    g.fillStyle(0xd9c49a, 1);
    g.fillRect(dL - 2, WALL_H - 4, dW + 4, 4);   // 门槛
    // 左右墙 + 踢脚线（评审 #6：补空间围合，宽 10px）
    g.fillStyle(0x76839a, 1); g.fillRect(0, 0, 10, H); g.fillRect(W - 10, 0, 10, H);
    g.fillStyle(0x5d6880, 1);
    g.fillRect(10, WALL_H, 5, H - WALL_H); g.fillRect(W - 15, WALL_H, 5, H - WALL_H);
    // 北墙大门：空缺表示（评审 #5）——墙带在门口断开露外侧，只补门框+门槛，不画门扇
    var door = s.mapdata.door;
    var win = s.mapdata.window;
    var wx = win.tx * TILE, wy = 8, ww = win.tw * TILE, wh = WALL_H - 18;
    // 窗户底色由昼夜驱动（drawWindowSky 每帧/状态变化时重绘）
    drawWindowSky(s, g, wx, wy, ww, wh, "office");
    g.lineStyle(3, 0x5c6a80, 1); g.strokeRect(wx, wy, ww, wh);
    g.lineBetween(wx + ww / 2, wy, wx + ww / 2, wy + wh);
    // 卧室窗 + 卫浴高窗（v24 房间比例改造：每个居住房间都有窗）
    // EXTRA_WINDOWS: [卧室窗(office 北排西侧), 卫浴窗] —— 房间归属按 x 判定
    EXTRA_WINDOWS.forEach(function (w2) {
      var rk = w2[0] < 8 ? "bedroom" : "bath";
      drawWindowSky(s, g, w2[0] * TILE, 8, w2[1] * TILE, w2[2], rk);
      g.lineStyle(3, 0x5c6a80, 1); g.strokeRect(w2[0] * TILE, 8, w2[1] * TILE, w2[2]);
      g.lineBetween(w2[0] * TILE + w2[1] * TILE / 2, 8, w2[0] * TILE + w2[1] * TILE / 2, 8 + w2[2]);
      g.lineBetween(w2[0] * TILE, 8 + w2[2] / 2, w2[0] * TILE + w2[1] * TILE, 8 + w2[2] / 2);
    });
    g.lineStyle(2, 0x4a4033, 1); g.strokeRect(1, 1, W - 2, H - 2);
    // 地毯已移除（用户反馈太丑）；灯光=ADD 光晕池（柔和暖光）
    // 地毯不产生碰撞（纯视觉层，depth -99 在家具之下）
    // 房间隔墙（第三轮评审）：三段式墙体（顶线 4px #8492AC / 墙身 #3B4459 / 脚线 4px #22283A），
    // 门洞用「空缺」表示——墙线断开露地板，只补 2px 门框 + 2px 门槛，不画门扇、不填亮条
    (s.mapdata.walls || []).forEach(function (wl) {
      var isH = wl.x0 !== undefined;
      var segments = [];   // 连续墙段（跳过 gap）
      var i0, i1;
      if (isH) { i0 = wl.x0; i1 = wl.x1; } else { i0 = wl.y; i1 = wl.y + wl.h - 1; }
      var gapLo = wl.gap ? wl.gap[0] : -1, gapHi = wl.gap ? wl.gap[1] : -1;
      var segStart = null;
      for (var i = i0; i <= i1 + 1; i++) {
        var inGap = i >= gapLo && i <= gapHi;
        if (!inGap && i <= i1 && segStart === null) segStart = i;
        if ((inGap || i > i1) && segStart !== null) { segments.push([segStart, i - 1]); segStart = null; }
      }
      // 三段式色板
      var C_TOP = 0x8492ac, C_BODY = 0x3b4459, C_FOOT = 0x22283a, C_EDGE_L = 0x8492ac, C_EDGE_D = 0x3b4459;
      segments.forEach(function (seg) {
        var s0 = seg[0], s1 = seg[1], len = s1 - s0 + 1;
        if (isH) {
          var y0 = WALL_H + wl.y * TILE;
          // 墙身（1 格）+ 立面（向北凸 1 格，遮挡北排地板）
          g.fillStyle(C_BODY, 1); g.fillRect(s0 * TILE, y0, len * TILE, TILE);
          g.fillStyle(C_BODY, 1); g.fillRect(s0 * TILE, y0 - TILE, len * TILE, TILE);
          // 顶线（立面顶缘亮 4px）+ 脚线（墙格下缘暗 4px）
          g.fillStyle(C_TOP, 1); g.fillRect(s0 * TILE, y0 - TILE, len * TILE, 4);
          g.fillStyle(C_FOOT, 1); g.fillRect(s0 * TILE, y0 + TILE - 4, len * TILE, 4);
        } else {
          var x0 = wl.x * TILE;
          g.fillStyle(C_BODY, 1); g.fillRect(x0, WALL_H + s0 * TILE, TILE, len * TILE);
          // 竖墙：右缘投影 4px（与横墙同一套语言）
          g.fillStyle(0x000000, 0.18); g.fillRect(x0 + TILE, WALL_H + s0 * TILE, 4, len * TILE);
        }
        // 门框：gap 两侧各 2px（上亮/下暗）+ 门槛线
        if (wl.gap) {
          var gp0 = gapLo * TILE, gp1 = (gapHi + 1) * TILE;
          if (isH) {
            var gy0 = WALL_H + wl.y * TILE;
            g.fillStyle(C_EDGE_L, 1); g.fillRect(gp0 - 2, gy0 - TILE, 2, TILE * 2);
            g.fillStyle(C_EDGE_D, 1); g.fillRect(gp1, gy0 - TILE, 2, TILE * 2);
            g.fillStyle(0xd9c49a, 1); g.fillRect(gp0 - 2, gy0 + TILE - 4, gp1 - gp0 + 4, 4);
          } else {
            var gx0 = wl.x * TILE;
            g.fillStyle(C_EDGE_L, 1); g.fillRect(gx0 - 2, WALL_H + gapLo * TILE - 2, TILE + 4, 2);
            g.fillStyle(C_EDGE_D, 1); g.fillRect(gx0 - 2, WALL_H + (gapHi + 1) * TILE, TILE + 4, 2);
            g.fillStyle(0xd9c49a, 1); g.fillRect(gx0, WALL_H + gapLo * TILE, 4, (gapHi - gapLo + 1) * TILE);
          }
        }
      });
    });
    drawRoads(s, g, tx0, tx1);   // v36：道路最后画，压在地板/田埂之上
  }

  /* 道路层（v36）：主路 + 门径集中画进 buildRoom 的 base graphics 上，debug 台可整体开关。
   * buildRoom 里会调两次（中段铺主路基准，末尾压在田埂之上）——g 是同一个 baseGfx，
   * 这里绝不能 destroy（roadsGfx===g 会自毁地板，整屏只剩背景色）。 */
  var roadsVisible = true;
  function drawRoads(s, g, tx0, tx1) {
    if (!roadsVisible) return;   // debug 关闭道路层：主路/门径都不画，只留纯草地/石板底
    g.fillStyle(0xb3a184, 1);
    g.fillRect(tx0, WALL_H + 8.6 * TILE, tx1 - tx0, TILE * 1.2);   // 街心主路
    (s.mapdata.walls || []).forEach(function (wl) {
      if (wl.x0 === undefined || wl.y !== 19 || !wl.gap) return;   // 只要 y19 这排屋前横墙的门洞
      var cL = wl.gap[0] * TILE, cW = (wl.gap[1] - wl.gap[0] + 1) * TILE;
      g.fillRect(cL, WALL_H + 9.8 * TILE, cW, (19 - 9.8) * TILE);   // 主路南缘 → 门洞北缘
      g.fillRect(cL - 3, WALL_H + 19 * TILE, cW + 6, 1.4 * TILE);   // 门外迎宾垫
    });
  }
  function toggleRoads(force) {
    if (!scene || !scene.mapdata) return roadsVisible;
    if (force === true && roadsVisible) return true;          // 已开
    if (force === false && !roadsVisible) return false;       // 已关
    roadsVisible = !roadsVisible;
    rebuildRoomBase();   // 地板/道路是同一个 graphics：整层重画
    return roadsVisible;
  }

  /* 重画整层地板/道路/墙（debug 道路层开关用）：把 buildRoom 再跑一遍，旧 graphics 已在上面拆掉 */
  function rebuildRoomBase() {
    if (!scene || !scene.mapdata) return;
    buildRoom(scene);
    // Phaser 3.90 的 destroy() 会同步把「下一帧才入列」的对象标 visible=false；
    // 重建后强制恢复，否则整块地板消失（页面只剩背景色）。
    if (scene.baseGfx) scene.baseGfx.setVisible(true);
  }

  /* ==================== 农场 / 鱼塘 / 料理（v36 新增） ====================
   * 全部前端本地模拟（与 NPC/本地生活同层，零后端成本）：
   *   农田  = 花园 rows22-26 cols28-34 的 5×4=20 格耕地，锄地→播种→浇水→施肥→收割
   *   鱼塘  = 花园东南 (35.2-38.2, 22.2-26.2) 水面 + 塘边坐垫，点击「钓鱼」进入小游戏
   *   料理  = 厨房灶台/料理台：食材（农场+钓鱼+市集）→ 食谱 → 料理（饱食/心情大回）
   * 状态持久化 localStorage（office_farm_v1），按天刷新种子生长；料理解锁一次性记录。
   * debug 台可 farm()/pond()/kitchen() 读取全量状态，farmAct()/fishOnce()/cook() 直接触发。
   */

  // ---------- 农场 ----------
  var FARM = {
    x0: 28, y0: 22, cols: 5, rows: 4,          // 田地区（tile 坐标）
    crops: [                                    // 种子 → 产出（也是料理食材）
      { id: "wheat",   name: "小麦",   seed: "麦种",   stages: 4, growMin: 90,  color: 0xd8b45a },
      { id: "tomato",  name: "番茄",   seed: "番茄苗", stages: 4, growMin: 110, color: 0xd64541 },
      { id: "carrot",  name: "胡萝卜", seed: "萝卜籽", stages: 3, growMin: 80,  color: 0xe8862c },
      { id: "corn",    name: "玉米",   seed: "玉米种", stages: 4, growMin: 130, color: 0xe8c832 },
      { id: "cabbage", name: "卷心菜", seed: "菜苗",   stages: 3, growMin: 100, color: 0x8fbf5a }
    ],
    FERTILIZER_BOOST: 0.5   // 施肥：剩余生长时间 -50%
  };
  var farm = null;   // { plots: [{soil,watered,fed,crop,stage,progress,rot}], inv: {seeds:{}, crops:{}, feed}, day }
  function farmNew() {
    var plots = [];
    for (var i = 0; i < FARM.cols * FARM.rows; i++) plots.push({ soil: false, watered: false, fed: false, crop: null, stage: 0, progress: 0 });
    return { plots: plots, inv: { seeds: { wheat: 2, carrot: 1 }, crops: {}, feed: 1 }, day: bjDayKey(), fish: 0 };
  }
  function farmLoad() {
    try {
      var j = JSON.parse(localStorage.getItem("office_farm_v1") || "null");
      if (j && j.plots && j.plots.length === FARM.cols * FARM.rows) {
        if (j.day !== bjDayKey()) {         // 跨天：浇过水的地干掉，作物按存活天数推进
          j.plots.forEach(function (p) { p.watered = false; p.fed = false; p.progress = (p.crop ? p.progress + 0.5 : 0); });
          j.day = bjDayKey();
        }
        farm = j;
        return;
      }
    } catch (e) {}
    farm = farmNew();
    farmSave();
  }
  function farmSave() { try { localStorage.setItem("office_farm_v1", JSON.stringify(farm)); } catch (e) {} }
  function plotTile(i) { return { x: FARM.x0 + (i % FARM.cols), y: FARM.y0 + Math.floor(i / FARM.cols) }; }
  function cropDef(id) { for (var i = 0; i < FARM.crops.length; i++) if (FARM.crops[i].id === id) return FARM.crops[i]; return null; }
  /* 农场动作：act = till | water | sow | feed | harvest，slot 缺省 = 第一个符合条件的地块 */
  function farmAct(act, slot) {
    if (!farm) farmLoad();
    var plots = farm.plots, order = [];
    if (typeof slot === "number" && plots[slot]) order = [slot];
    else for (var i = 0; i < plots.length; i++) order.push(i);
    for (var k = 0; k < order.length; k++) {
      var p = plots[order[k]];
      if (act === "till" && !p.soil && !p.crop) {
        p.soil = true; farmSave(); return { ok: true, slot: order[k], text: "翻开了一块生土" };
      }
      if (act === "water" && p.soil && !p.watered) {
        p.watered = true; p.progress += 0.12; farmSave(); return { ok: true, slot: order[k], text: "浇水：土壤喝饱了" };
      }
      if (act === "sow" && p.soil && !p.crop) {
        var ids = Object.keys(farm.inv.seeds).filter(function (id) { return farm.inv.seeds[id] > 0; });
        if (!ids.length) return { ok: false, text: "种子用完了（去市集/翻农场可能找到）" };
        var id = ids[Math.floor(Math.random() * ids.length)];
        farm.inv.seeds[id]--;
        p.crop = id; p.stage = 0; p.progress = 0; p.watered = false;
        farmSave(); return { ok: true, slot: order[k], text: "播下了" + (cropDef(id) || {}).name };
      }
      if (act === "feed" && p.crop && !p.fed) {
        if (!(farm.inv.feed > 0)) return { ok: false, text: "没有肥料了（钓鱼有时能捞到）" };
        farm.inv.feed--; p.fed = true; p.progress = Math.min(1, p.progress + 0.2);
        farmSave(); return { ok: true, slot: order[k], text: "施肥：" + (cropDef(p.crop) || {}).name + "长势更好了" };
      }
      if (act === "harvest" && p.crop && p.progress >= 1) {
        var cd = cropDef(p.crop);
        farm.inv.crops[p.crop] = (farm.inv.crops[p.crop] || 0) + 1;
        p.crop = null; p.stage = 0; p.progress = 0; p.watered = false; p.fed = false;
        farmSave(); return { ok: true, slot: order[k], text: "收获了" + (cd ? cd.name : "作物") + "×1" };
      }
    }
    return { ok: false, text: actText(act) };
  }
  function actText(act) {
    return {
      till: "没有可开垦的生土了", water: "没有干着的耕地", sow: "没有空耕地可播种",
      feed: "没有可施肥的作物", harvest: "还没有成熟的作物"
    }[act] || "这里暂时没什么可做的";
  }
  /* 生长 tick（本地生活循环里每 ~30s 调一次）：浇过水才长；肥料加速 */
  function farmTick() {
    if (!farm) return;
    var dirty = false;
    farm.plots.forEach(function (p) {
      if (!p.crop || p.progress >= 1) return;
      if (!p.watered) return;
      var cd = cropDef(p.crop);
      p.progress = Math.min(1, p.progress + 1 / ((cd ? cd.growMin : 100) * (p.fed ? FARM.FERTILIZER_BOOST : 1)) * 3);
      p.stage = Math.min((cd ? cd.stages : 3) - 1, Math.floor(p.progress * (cd ? cd.stages : 3)));
      dirty = true;
    });
    if (dirty) { farmSave(); drawFarm(); }
  }
  function farmSummary() {
    if (!farm) farmLoad();
    var tilled = 0, growing = 0, ready = 0;
    farm.plots.forEach(function (p) {
      if (p.soil) tilled++;
      if (p.crop) growing++;
      if (p.crop && p.progress >= 1) ready++;
    });
    return { tilled: tilled, growing: growing, ready: ready, seeds: farm.inv.seeds, crops: farm.inv.crops, feed: farm.inv.feed, fish: farm.fish };
  }

  // ---------- 鱼塘 ----------
  var POND = { x0: 35.2, y0: 22.2, x1: 38.2, y1: 26.2, cx: 36.7 * TILE, cy: WALL_H + 24.2 * TILE };
  var fishShadows = [];      // 水面鱼影 { spr, vx, phase }
  var fishing = null;        // { wait, bite, t, excl } 钓鱼小游戏状态
  function pondTileFree(tx, ty) {   // 塘面格 → 阻挡（画水不画地，A* 天然绕开）
    return tx >= Math.floor(POND.x0) && tx <= Math.ceil(POND.x1) - 1 &&
           ty >= Math.floor(POND.y0) && ty <= Math.ceil(POND.y1) - 1;
  }
  function drawPond(s, g) {
    var x0 = POND.x0 * TILE, y0 = WALL_H + POND.y0 * TILE;
    var w = (POND.x1 - POND.x0) * TILE, h = (POND.y1 - POND.y0) * TILE;
    // 塘岸（两圈描边 + 沙色滩）
    g.fillStyle(0xc9b184, 1); g.fillEllipse(x0 + w / 2, y0 + h / 2, w + 30, h + 26);
    g.fillStyle(0x5a86b0, 1); g.fillEllipse(x0 + w / 2, y0 + h / 2, w, h);
    g.fillStyle(0x6e9cc8, 1); g.fillEllipse(x0 + w / 2, y0 + h / 2 - 4, w - 16, h - 12);
    g.lineStyle(3, 0x8a6a4a, 1); g.strokeEllipse(x0 + w / 2, y0 + h / 2, w + 30, h + 26);
    // 木栈道：塘西侧一块小平台（钓鱼位）
    g.fillStyle(0x9a7346, 1); g.fillRect(x0 - 26, y0 + h / 2 - 24, 30, 48);
    g.lineStyle(2, 0x6a4c28, 1); g.strokeRect(x0 - 26, y0 + h / 2 - 24, 30, 48);
    // 芦苇
    g.fillStyle(0x6e8f50, 1);
    [[x0 - 10, y0 - 4], [x0 + w + 6, y0 + 2], [x0 + w + 10, y0 + h - 10]].forEach(function (r) {
      g.fillEllipse(r[0], r[1], 8, 18);
    });
  }
  function buildPondLife(s) {
    if (!s || !s.mapdata) return;
    clearPondLife();
    for (var i = 0; i < 4; i++) {
      var sh = s.add.ellipse(0, 0, 26, 10, 0x2a4a6e, 0.55).setDepth(3);
      var shd = { spr: sh, vx: (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.35), phase: Math.random() * 6.28 };
      respawnShadow(shd);
      fishShadows.push(shd);
    }
  }
  function respawnShadow(d) {
    var mx = POND.x0 * TILE + 24, Mx = POND.x1 * TILE - 24;
    var my = WALL_H + POND.y0 * TILE + 20, My = WALL_H + POND.y1 * TILE - 20;
    d.spr.x = mx + Math.random() * (Mx - mx);
    d.spr.y = my + Math.random() * (My - my);
    d.spr.alpha = 0.35 + Math.random() * 0.3;
  }
  function clearPondLife() {
    fishShadows.forEach(function (d) { if (d.spr) d.spr.destroy(); });
    fishShadows.length = 0;
  }
  function tickPondLife() {
    var mx = POND.x0 * TILE + 24, Mx = POND.x1 * TILE - 24;
    fishShadows.forEach(function (d) {
      d.spr.x += d.vx;
      d.spr.y += Math.sin((d.phase += 0.02)) * 0.15;
      if (d.spr.x < mx || d.spr.x > Mx) { d.vx *= -1; respawnShadow(d); }
      if (fishing && fishing.bite) {   // 咬钩瞬间：鱼影游向浮标
        d.spr.x += (fishing.bx - d.spr.x) * 0.05;
        d.spr.y += (fishing.by - d.spr.y) * 0.05;
      }
    });
  }
  /* 钓鱼小游戏：点击「钓鱼」→ 抛竿（2~5s 等待）→「！ bite」(1.1s 窗口) → 再点一次 = 起竿成功 */
  function fishStart() {
    if (fishing) return { ok: false, text: "已经在钓鱼了，等浮标下沉再点一次起竿" };
    fishing = {
      t: 0, wait: 2 + Math.random() * 3, bite: false, biteLeft: 0,
      bx: POND.cx + (Math.random() * 60 - 30), by: POND.cy + (Math.random() * 40 - 20),
      bobber: null, excl: null
    };
    fishing.bobber = scene.add.circle(fishing.bx, fishing.by, 4, 0xff6b6b).setStrokeStyle(2, 0xffffff, 0.9).setDepth(4);
    return { ok: true, text: "抛竿了…盯着浮标！" };
  }
  function fishTick(dt) {
    if (!fishing) return;
    fishing.t += dt;
    if (fishing.bobber) fishing.bobber.y = fishing.by + Math.sin(fishing.t * 3) * 1.4;   // 浮标轻漂
    if (!fishing.bite && fishing.t >= fishing.wait) {
      fishing.bite = true; fishing.biteLeft = 1.1;
      fishing.excl = scene.add.text(fishing.bx, fishing.by - 26, "！", {
        fontFamily: "PingFang SC, Microsoft YaHei, sans-serif", fontSize: "26px",
        color: "#ffd43b", fontStyle: "bold", stroke: "#151826", strokeThickness: 5
      }).setOrigin(0.5).setDepth(95000);
      scene.tweens.add({ targets: fishing.excl, scale: 1.25, yoyo: true, repeat: -1, duration: 160 });
    }
    if (fishing.bite) {
      fishing.biteLeft -= dt;
      if (fishing.biteLeft <= 0) fishAbort("鱼跑掉了…下次要更快！");
    }
  }
  function fishReel() {
    if (!fishing) return { ok: false, text: "先在鱼塘边点「钓鱼」抛竿" };
    if (!fishing.bite) { fishAbort("太心急了，鱼还没咬钩…"); return { ok: false, text: "太心急了，鱼还没咬钩" }; }
    // 成功！随机鱼获（80% 鱼 / 15% 偶得肥料 / 5% 宝物）
    if (fishing.excl) { fishing.excl.destroy(); }
    if (fishing.bobber) { fishing.bobber.destroy(); }
    var roll = Math.random(), got;
    if (roll < 0.78) { got = "鲜鱼"; farm.fish++; }
    else if (roll < 0.93) { got = "肥料"; farm.inv.feed++; }
    else { got = "河童的旧怀表"; farm.inv.feed += 2; }
    farmSave();
    fishing = null;
    postStatDelta({ mood: 5, hunger: 1 });
    renderStatsBar();
    return { ok: true, text: "钓到了" + got + "！" };
  }
  function fishAbort(msg) {
    if (fishing && fishing.excl) fishing.excl.destroy();
    if (fishing && fishing.bobber) fishing.bobber.destroy();
    fishing = null;
    if (msg && bubbleText === null) showBubble(msg, "idle");
  }

  // ---------- 料理 ----------
  var RECIPES = [
    { id: "bread",   name: "烤面包",     need: { wheat: 2 },                     stat: { hunger: 22, mood: 3 },  verb: "揉面、进炉，烤得金黄" },
    { id: "salad",   name: "田园沙拉",   need: { tomato: 1, cabbage: 1 },        stat: { hunger: 16, mood: 6 },  verb: "把今天的菜洗干净拌好" },
    { id: "soup",    name: "蔬菜浓汤",   need: { carrot: 1, cabbage: 1 },        stat: { hunger: 20, mood: 4 },  verb: "小火咕嘟了半天" },
    { id: "fishgrill", name: "盐烤鲜鱼", need: { fish: 1, wheat: 1 },            stat: { hunger: 30, mood: 6 },  verb: "炭火滋滋作响，香气扑鼻" },
    { id: "sushi",   name: "鱼寿司",     need: { fish: 1, wheat: 2 },            stat: { hunger: 34, mood: 8 },  verb: "刀工利落，米粒紧实" },
    { id: "popcorn", name: "爆米花",     need: { corn: 2 },                      stat: { hunger: 10, mood: 8 },  verb: "噼里啪啦，满锅都是响声" },
    { id: "juice",   name: "番茄汁",     need: { tomato: 2 },                    stat: { hunger: 8, mood: 7 },   verb: "榨出一杯鲜红的晨光" },
    { id: "stew",    name: "大杂烩",     need: { fish: 1, tomato: 1, carrot: 1 },stat: { hunger: 38, mood: 5 },  verb: "有什么就扔什么，意外地好喝" }
  ];
  function pantryCount(id) {
    if (!farm) farmLoad();
    if (id === "fish") return farm.fish || 0;
    return farm.inv.crops[id] || 0;
  }
  function pantryUse(id, n) {
    if (id === "fish") farm.fish = Math.max(0, farm.fish - n);
    else farm.inv.crops[id] = Math.max(0, (farm.inv.crops[id] || 0) - n);
    farmSave();
  }
  function cookable() {
    return RECIPES.map(function (r) {
      var ok = true, missing = [];
      Object.keys(r.need).forEach(function (k) {
        if (pantryCount(k) < r.need[k]) { ok = false; missing.push(k); }
      });
      return { id: r.id, ok: ok, missing: missing };
    });
  }
  /* 做料理：走到灶台（stoveA）→ 表演 eat 动作 → 消耗食材 → 加数值 + 存饱食 */
  function cook(recipeId) {
    var r = null;
    for (var i = 0; i < RECIPES.length; i++) if (RECIPES[i].id === recipeId) r = RECIPES[i];
    if (!r) return { ok: false, text: "没有这道菜" };
    var can = cookable().filter(function (c) { return c.id === recipeId; })[0];
    if (!can.ok) return { ok: false, text: "食材不够：" + can.missing.join("、") };
    Object.keys(r.need).forEach(function (k) { pantryUse(k, r.need[k]); });
    postStatDelta(r.stat);
    onStatsDeltaLocal(r.stat);
    renderStatsBar();
    return { ok: true, text: "做好了「" + r.name + "」：" + r.verb };
  }
  /* 本地直接补数值（hub 不在线时数值条也要动——真相仍在 hub，这里只是表演层） */
  function onStatsDeltaLocal(d) {
    Object.keys(d || {}).forEach(function (k) {
      if (typeof stats[k] === "number") stats[k] = Math.max(0, Math.min(100, stats[k] + d[k]));
    });
  }
  function kitchenSummary() {
    return {
      pantry: { fish: farm ? farm.fish : 0, crops: farm ? farm.inv.crops : {}, seeds: farm ? farm.inv.seeds : {}, feed: farm ? farm.inv.feed : 0 },
      recipes: cookable().map(function (c, i) { return { id: c.id, name: RECIPES[i].name, ok: c.ok, missing: c.missing }; })
    };
  }
  /* 自动挑一道能做的菜（按饱食恢复从高到低），做完返回文案 */
  function cookAuto() {
    var canDo = cookable().filter(function (c) { return c.ok; });
    if (!canDo.length) return "";
    canDo.sort(function (a, b) {
      var ra = RECIPES.filter(function (r) { return r.id === a.id; })[0], rb = RECIPES.filter(function (r) { return r.id === b.id; })[0];
      return (rb ? rb.stat.hunger : 0) - (ra ? ra.stat.hunger : 0);
    });
    var pick = RECIPES.filter(function (r) { return r.id === canDo[0].id; })[0];
    var res = cook(pick.id);
    return res.ok ? res.text : "";
  }
  /* ---------- 料理面板（画中画，复用 perf-panel 的样式语言） ---------- */
  var cookPanelEl = null;
  function renderCookPanel() {
    var host = document.getElementById("office-parent");
    if (!host) return;
    if (!cookPanelEl) {
      cookPanelEl = document.createElement("div");
      cookPanelEl.id = "cook-panel";
      cookPanelEl.style.cssText = "position:absolute;z-index:41;left:14px;top:52px;width:250px;border-radius:10px;" +
        "background:#1d2130f5;border:1px solid #ffffff33;color:#ece8df;overflow:hidden;display:none;box-shadow:0 6px 20px #0008;";
      cookPanelEl.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;background:#2a2e3d;border-bottom:1px solid #ffffff22;">' +
        '<span>🍳</span><span style="font-weight:700" id="ck-title">料理台</span>' +
        '<button id="ck-close" type="button" style="margin-left:auto;border:0;background:transparent;color:#9aa3b8;cursor:pointer;font-size:14px;line-height:1">×</button></div>' +
        '<div id="ck-body" style="padding:8px 12px;font-size:12px;line-height:1.7"></div>';
      host.appendChild(cookPanelEl);
      cookPanelEl.querySelector("#ck-close").onclick = hideCookPanel;
    }
    var s = kitchenSummary();
    var row = function (n, ok, note) {
      return '<div style="padding:2px 0;border-bottom:1px dashed #ffffff12;display:flex;gap:6px">' +
        '<span style="flex:none">' + (ok ? "✅" : "⬜") + "</span><span style=\"flex:none;font-weight:600\">" + n + "</span>" +
        '<span style="color:#9aa3b8;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + note + "</span></div>";
    };
    var html = '<div style="color:#8ce99a;margin-bottom:4px">🐟 鲜鱼×' + (s.pantry.fish || 0) + " · 肥料×" + (s.pantry.feed || 0) + "</div>";
    var cropNames = { wheat: "小麦", tomato: "番茄", carrot: "胡萝卜", corn: "玉米", cabbage: "卷心菜" };
    Object.keys(s.pantry.crops).forEach(function (k) {
      if (s.pantry.crops[k] > 0) html += '<div style="color:#c3c9d9">' + (cropNames[k] || k) + "×" + s.pantry.crops[k] + "</div>";
    });
    html += '<div style="margin-top:6px;color:#ffd43b;font-weight:700">今日菜谱</div>';
    s.recipes.forEach(function (r) {
      html += row(r.name, r.ok, r.ok ? "可以做" : "缺 " + (r.missing || []).join("、"));
    });
    var body = cookPanelEl.querySelector("#ck-body");
    body.innerHTML = html;
    cookPanelEl.style.display = "block";
  }
  function hideCookPanel() {
    if (cookPanelEl) cookPanelEl.style.display = "none";
  }

  // ---------- 农场/鱼塘视觉层 ----------
  var farmGfx = null, farmCropGfx = null;
  function drawFarm() {
    if (!scene || !scene.mapdata) return;
    if (farmGfx) { farmGfx.destroy(); farmGfx = null; }
    if (farmCropGfx) { farmCropGfx.destroy(); farmCropGfx = null; }
    if (!farm) farmLoad();
    var g = scene.add.graphics().setDepth(2);
    // 田埂底：整片深棕 + 田字沟
    var fx0 = FARM.x0 * TILE, fy0 = WALL_H + FARM.y0 * TILE;
    var fw = FARM.cols * TILE, fh = FARM.rows * TILE;
    g.fillStyle(0x8a6a3f, 0.55); g.fillRect(fx0 - 6, fy0 - 6, fw + 12, fh + 12);
    g.lineStyle(2, 0x6a4c28, 0.8); g.strokeRect(fx0 - 6, fy0 - 6, fw + 12, fh + 12);
    var gc = scene.add.graphics().setDepth(3);
    farm.plots.forEach(function (p, i) {
      var t = plotTile(i);
      var px = t.x * TILE, py = WALL_H + t.y * TILE;
      if (p.soil) {
        g.fillStyle(0x6a4a2a, 1); g.fillRect(px + 3, py + 3, TILE - 6, TILE - 6);
        g.lineStyle(1, 0x503820, 0.9);
        for (var k = 1; k <= 2; k++) g.lineBetween(px + 6, py + k * 14, px + TILE - 6, py + k * 14);
        if (p.watered) { g.fillStyle(0x3a5a8a, 0.35); g.fillRect(px + 3, py + 3, TILE - 6, TILE - 6); }
        if (p.fed) {
          g.fillStyle(0x2e5c34, 0.5); g.fillRect(px + 3, py + 3, 6, 6);
        }
      }
      if (p.crop) {
        var cd = cropDef(p.crop);
        var color = cd.color;
        if (p.progress >= 1) {   // 成熟：顶一颗亮果
          gc.fillStyle(color, 1);
          gc.fillCircle(px + TILE / 2, py + TILE / 2 - 8, 6);
          gc.fillStyle(0x4a7a3a, 1);
          gc.fillRect(px + TILE / 2 - 2, py + TILE / 2 - 4, 4, 10);
        } else {                 // 幼苗/生长中：苗 + 大小按 stage
          var r = 3 + p.stage * 2.4;
          gc.fillStyle(0x5a9a4a, 1);
          gc.fillCircle(px + TILE / 2, py + TILE / 2 - 2, r);
        }
      }
    });
    farmGfx = g; farmCropGfx = gc;
  }

  function isNightHour() {   // 北京时间 18:00-6:00 = 夜（窗外昼夜按真实时间，与灯开关解耦——评审 v31 用户反馈）
    var bj = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
    return bj >= 18 || bj < 6;
  }
  function drawWindowSky(s, g, wx, wy, ww, wh, roomKey) {
    var night = isNightHour();
    // 室内开灯时玻璃反光微亮（避免"墙上黑洞"——v31 用户反馈），夜里窗色也比纯黑亮两档
    if (roomKey && roomLights[roomKey]) {
      g.fillStyle(night ? 0x2a3348 : 0x8fc3e8, 1); g.fillRect(wx, wy, ww, wh);
      if (night) {
        g.fillStyle(0x41506e, 1); g.fillRect(wx, wy, ww, wh);
        g.fillStyle(0xf4f1ea, 1); g.fillCircle(wx + ww - 16, wy + wh / 2, 6);
        g.fillStyle(0x2a3348, 1); g.fillCircle(wx + ww - 13, wy + wh / 2 - 2, 5);
        g.lineStyle(2, 0x8492ac, 1);
        g.lineBetween(wx + ww / 2, wy, wx + ww / 2, wy + wh);
        g.lineBetween(wx, wy + wh / 2, wx + ww, wy + wh / 2);
        return;
      }
      g.lineStyle(2, 0x8492ac, 1);
      g.lineBetween(wx + ww / 2, wy, wx + ww / 2, wy + wh);
      g.lineBetween(wx, wy + wh / 2, wx + ww, wy + wh / 2);
      return;
    }
    if (weather === "rainy") {
      g.fillStyle(0x5a6a80, 1); g.fillRect(wx, wy, ww, wh);
      g.lineStyle(1, 0xaec6de, 0.7);
      for (var ry = wy + 3; ry < wy + wh - 2; ry += 6)
        for (var rx = wx + 4; rx < wx + ww - 3; rx += 9)
          g.lineBetween(rx, ry, rx - 2, ry + 4);
      return;
    }
    g.fillStyle(night ? 0x1d2438 : 0x8fc3e8, 1); g.fillRect(wx, wy, ww, wh);
    if (night) {
      g.fillStyle(0xf4f1ea, 1); g.fillCircle(wx + ww - 18, wy + 12, 7);
      g.fillStyle(0x1d2438, 1); g.fillCircle(wx + ww - 15, wy + 10, 6);
      g.fillStyle(0xdce7f5, 1);
      [6, 20, 34, 48].forEach(function (sx, i) { g.fillCircle(wx + sx, wy + 8 + (i % 2) * 8, 1.4); });
    } else {
      g.fillStyle(0xffffff, 0.85);
      g.fillEllipse(wx + 16, wy + 12, 20, 8);
      g.fillEllipse(wx + 30, wy + 16, 16, 7);
      g.fillStyle(0xffe9a8, 1); g.fillCircle(wx + ww - 16, wy + 10, 5);
    }
  }

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
    if (visitingHome) {
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

  // ---------- 本地生活模拟 ----------
  /* 内在状态层（方案 §1/§4）：每条事件的需求关联。key 对应 LOCAL_EVENTS 的 key。
   *   need: 这条事件主要回应哪种需求（低值时权重放大）
   *   fills: 触发后恢复哪些数值、恢复多少（hub 侧数值，前端仅上报建议，真相在 hub） */
  var EVENT_NEED = {
    tea:      { need: "hunger",  label: "解渴" },
    dining:   { need: "hunger",  label: "加餐" },
    cook:     { need: "hunger",  label: "做饭" },
    fridge:   { need: "hunger",  label: "零食" },
    market:   { need: "hunger",  label: "采买" },
    cookmeal: { need: "hunger",  label: "料理" },
    farm:     { need: "hunger",  label: "种地" },
    fishing:  { need: "hunger",  label: "钓鱼" },
    relax:    { need: "mood",    label: "窝着" },
    arcade:   { need: "mood",    label: "玩乐" },
    garden:   { need: "mood",    label: "赏花" },
    stroll:   { need: "mood",    label: "歇脚" },
    window:   { need: "mood",    label: "看月亮" },
    sofa:     { need: "energy",  label: "小憩" },
    bed:      { need: "energy",  label: "打盹" },
    recover:  { need: "energy",  label: "回血" },
    dizzy:    { need: "energy",  label: "迷糊" },
    door:     { need: "social",  label: "打招呼" },
    mail:     { need: "social",  label: "看信" },
    washup:   { need: "hygiene", label: "洗脸" },
    mirror:   { need: "hygiene", label: "整容" },
    townbench:{ need: "mood",    label: "歇脚" }
  };
  /* 需求系数曲线：数值越低，对应事件权重越高。hunger 30 以下 ×5，social 30 以下 ×4…… */
  function needBoost(need, v) {
    if (v == null) return 1;
    if (v >= 88) return 0.05;          // 饱和：饱食 100 还吃点心（用户抓包）→ 几乎不选
    if (v >= 75) return 0.3;           // 很满足
    if (v >= 65) return 0.75;
    if (v >= 40) return 1.0;
    if (v >= 25) return 2.2;
    if (v >= 15) return 3.5;
    return 5.0;                         // 急需
  }
  var stats = { hunger: 70, mood: 65, energy: 80, social: 55, hygiene: 75, ts: 0 };  // hub 推过来后覆盖
  var lastStats = null;   // 上一帧数值（检测变化方向，浮字用）
  function onStats(s) {
    if (!s) return;
    var changed = [];
    ["hunger", "mood", "energy", "social", "hygiene"].forEach(function (k) {
      if (typeof s[k] !== "number") return;
      var v = s[k];
      if (lastStats && typeof lastStats[k] === "number" && v !== lastStats[k]) {
        changed.push({ key: k, from: lastStats[k], to: v, delta: v - lastStats[k] });
      }
      stats[k] = v;
    });
    stats.ts = s.ts || Date.now();
    renderStatsBar();
    if (changed.length && lastStats) changed.forEach(showStatDelta);
    lastStats = JSON.parse(JSON.stringify(stats));
  }
  /* 数值条上方浮动 "+12 / -3"：肉眼可见的变化反馈 */
  function showStatDelta(c) {
    var cell = document.querySelector('.stat-cell[data-key="' + c.key + '"]');
    if (!cell) return;
    var meta = STAT_META.filter(function (m) { return m.key === c.key; })[0];
    var f = document.createElement("span");
    f.className = "stat-delta " + (c.delta > 0 ? "up" : "down");
    f.textContent = (c.delta > 0 ? "+" : "") + c.delta;
    cell.appendChild(f);
    setTimeout(function () { f.remove(); }, 1800);
    cell.classList.add("bump");
    setTimeout(function () { cell.classList.remove("bump"); }, 1200);
  }
  /* 旧版只有 4 条写死在 if/else 里的小动作，25 个区域 / 20 行动作帧几乎全闲着。
   * 现在改成数据驱动：加一条事件只需在 LOCAL_EVENTS 加一行（区域、文案、动作、权重）。
   * check.mjs 第 15 项会校验区域存在、动作可播、房间分布与数量，防止回退或写错。 */
  var LOCAL_EVENTS = [
    // 办公室
    { key: "tea",      zone: "tea",      label: "接水",   icon: "🥤", text: "去接杯水喝",       act: "idle_sip",   face: "n", w: 1.2, room: "office" },
    { key: "window",   zone: "window",   label: "看窗景", icon: "🌙", text: "趴窗台看看月亮",   textDay: "趴窗台晒晒太阳", textNight: "趴窗台看看月亮", act: "idle_look",  face: "n", w: 1.0, room: "office" },
    { key: "library",  zone: "library",  label: "翻书",   icon: "📖", text: "随手翻翻书",       act: "idle_read",  face: "n", w: 1.1, room: "office" },
    { key: "sofa",     zone: "sofa",     label: "瘫沙发", icon: "🛋", text: "瘫在沙发上",       act: "idle_rest",  face: "s", w: 1.3, room: "office" },
    { key: "desk",     zone: "desk",     label: "敲键盘", icon: "⌨", text: "回工位敲两行字",   act: "idle_type",  face: "n", w: 1.1, room: "office" },
    { key: "printer",  zone: "printer",  label: "取纸",   icon: "🖨", text: "去取打印好的纸",   act: "idle_reach", face: "n", w: 0.8, room: "office" },
    { key: "mail",     zone: "mail",     label: "看信箱", icon: "✉", text: "翻翻信箱",         act: "idle_reach", face: "n", w: 0.8, room: "office" },
    { key: "board",    zone: "board",    label: "任务板", icon: "📋", text: "盯着任务板发呆",   act: "idle_think", face: "s", w: 0.9, room: "office" },
    { key: "screen",   zone: "screen",   label: "想点子", icon: "💡", text: "对着白板想点子",   act: "idle_think", face: "n", w: 0.8, room: "office" },
    { key: "tools",    zone: "tools",    label: "工具书", icon: "📚", text: "翻两页工具书",     act: "idle_read",  face: "n", w: 0.7, room: "office" },
    { key: "dining",   zone: "dining",   label: "吃点心", icon: "🍰", text: "在餐桌吃点点心",   act: "idle_eat",   face: "n", w: 0.9, room: "office" },
    { key: "cook",     zone: "cook",     label: "下厨",   icon: "🍳", text: "下厨煮点东西",     act: "idle_eat",   face: "n", w: 0.8, room: "office" },
    { key: "fridge",   zone: "fridge",   label: "翻冰箱", icon: "🧊", text: "开冰箱找零食",     act: "idle_reach", face: "n", w: 0.9, room: "office" },
    { key: "door",     zone: "door",     label: "看门外", icon: "🚪", text: "到门口看看外面",   act: "idle_think", face: "n", w: 0.7, room: "office" },
    { key: "balcony",  zone: "balcony",  label: "伸懒腰", icon: "🌤", text: "到阳台伸个懒腰",   act: "idle_cheer", face: "n", w: 0.8, room: "office" },
    { key: "dizzy",    zone: "tools",    label: "犯迷糊", icon: "💫", text: "忽然有点犯迷糊",   act: "idle_dizzy", face: "s", w: 0.5, room: "office" },
    // 卧室
    { key: "relax",    zone: "relax",    label: "扶手椅", icon: "🪑", text: "窝进扶手椅",       act: "idle_rest",  face: "s", w: 0.9, room: "bedroom" },
    { key: "arcade",   zone: "arcade",   label: "打街机", icon: "🕹", text: "打两把街机",       act: "idle_play",  face: "n", w: 0.8, room: "bedroom" },
    { key: "bed",      zone: "bed",      label: "赖床",   icon: "🛏", text: "赖在床上打个盹",   act: "idle_nap",   face: "s", w: 0.9, room: "bedroom" },
    { key: "wardrobe", zone: "wardrobe", label: "挑衣服", icon: "👗", text: "挑今天穿什么",     act: "idle_think", face: "n", w: 0.7, room: "bedroom" },
    // 卫浴
    { key: "washup",   zone: "washup",   label: "洗脸",   icon: "🧼", text: "洗把脸清醒一下",   act: "idle_reach", face: "n", w: 0.8, room: "bedroom" },
    { key: "mirror",   zone: "washup",   label: "照镜子", icon: "🪞", text: "对着镜子发会儿呆", act: "idle_think", face: "n", w: 0.6, room: "bedroom" },
    { key: "recover",  zone: "recover",  label: "回血",   icon: "🔋", text: "蹲充电垫上回血",   act: "idle_nap",   face: "n", w: 0.7, room: "bedroom" },
    // 花园
    { key: "garden",   zone: "garden",   label: "看花",   icon: "🌷", text: "去花园看看花",     act: "idle_cheer", face: "n", w: 0.7, room: "garden" },
    { key: "stroll",   zone: "stroll",   label: "坐长椅", icon: "🌳", text: "在长椅上坐一会儿", act: "idle_sit",   face: "s", w: 0.7, room: "garden" },
    { key: "market",   zone: "market",   label: "逛摊位", icon: "🍎", text: "逛逛水果摊",       act: "idle_reach", face: "n", w: 0.6, room: "garden" },
    { key: "farm",     zone: "farm",     label: "巡农田", icon: "🌾", text: "去田里转一圈，看看庄稼", act: "idle_farm", face: "n", w: 0.9, room: "garden" },
    { key: "fishing",  zone: "pond",     label: "钓鱼",   icon: "🎣", text: "去鱼塘边钓会儿鱼", act: "idle_reach", face: "e", w: 0.7, room: "garden" },
    // 厨房（料理）
    { key: "cookmeal", zone: "kitchenprep", label: "做料理", icon: "🍳", text: "进厨房琢磨做点什么吃的", act: "idle_eat", face: "n", w: 0.8, room: "office" },
    // 小镇街道
    { key: "townwell", zone: "town",     label: "井边站站", icon: "💭", text: "在井边发会儿呆",   act: "idle_think", face: "s", w: 0.8, room: "town" },
    { key: "townbench",zone: "town_bench",label: "街边长椅", icon: "🪑", text: "在街边长椅坐坐",  act: "idle_sit",   face: "n", w: 0.7, room: "town" }
  ];
  // 户外/安静标记（需求加权用，见 pickLocalEvent；单独列出避免改动上面每行）
  (function () {
    var outdoor = ["garden", "stroll", "market", "balcony"], quiet = ["window", "tea", "library", "mirror", "board"];
    LOCAL_EVENTS.forEach(function (e) {
      if (outdoor.indexOf(e.key) >= 0) e.outdoor = true;
      if (quiet.indexOf(e.key) >= 0) e.quiet = true;
    });
  })();
  // 每种小动作对应精灵表里的一行动作帧 + 表演时长
  var LOCAL_ACTS = {
    idle_sip:   { anim: "drink",  dur: 2600 },   // 接水 → 举杯
    idle_look:  { anim: "idle",   dur: 3000 },   // 面朝北 → actRow 自动切 idle_back
    idle_read:  { anim: "read",   dur: 2800 },   // 捧书翻页
    idle_rest:  { anim: "lounge", dur: 4200 },   // 沙发/扶手椅：专用横躺帧
    idle_nap:   { anim: "sleep",  dur: 4600 },   // 床/充电垫：躺姿 + Zzz
    idle_type:  { anim: "typing", dur: 3200 },   // 工位：面朝北自动切 typing_back
    idle_reach: { anim: "reach",  dur: 2400 },   // 取纸/翻冰箱/洗脸/逛摊
    idle_think: { anim: "think",  dur: 3000 },   // 任务板/白板/镜子/衣柜
    idle_eat:   { anim: "eat",    dur: 3200 },   // 吃点心/下厨
    idle_play:  { anim: "play",   dur: 3400 },   // 打街机
    idle_wave:  { anim: "wave",   dur: 2400 },   // 挥手
    idle_cheer: { anim: "cheer",  dur: 2600 },   // 伸懒腰/看花
    idle_sit:   { anim: "sit",    dur: 3200 },   // 长椅
    idle_dizzy: { anim: "dizzy",  dur: 2200 },   // 犯迷糊
    idle_farm:  { anim: "reach",  dur: 2600 }    // 农活：锄地/播种/浇水/施肥/收割
  };
  /* 本地事件 → 数值增量（方案 §1.1 恢复列；只上报建议值，真相在 hub） */
  var STAT_FILLS = {
    tea: { social: 1 }, dining: { hunger: 12, mood: 2 }, cook: { hunger: 18, mood: 3 },
    fridge: { hunger: 8 }, market: { hunger: 10, social: 3 },
    farm: { mood: 2 }, fishing: { mood: 3 }, cookmeal: { hunger: 6, mood: 2 },
    relax: { mood: 4, energy: 3 }, arcade: { mood: 7, energy: -2 }, garden: { mood: 5 },
    stroll: { mood: 4 }, window: { mood: 3 }, sofa: { energy: 8 }, bed: { energy: 10 },
    recover: { energy: 12 }, dizzy: {}, door: { social: 6, mood: 2 }, mail: { social: 3 },
    washup: { hygiene: 12, mood: 2 }, mirror: { hygiene: 2, mood: 1 },
    tea2: { hunger: 4 },
    townwell: { mood: 3 }, townbench: { mood: 4, energy: 2 }
  };
  function statFillFor(key) { return STAT_FILLS[key] || null; }
  /* 事件文案的昼夜切换（白天"看月亮"吐槽点）：textDay/textNight 有定义则按 lightsOn 选 */
  function localText(e) {
    if (!e) return "";
    if (e.textDay || e.textNight) return lightsOn ? (e.textDay || e.text) : (e.textNight || e.text);
    return e.text;
  }
  /* ---------- B 层随机事件编排（方案 §2.2）：hub 每 2~6h 广播一条，这里演出来 ----------
   * zone: 走到哪里演 / act: 动作帧行 / fills: 数值增量 / mood: 气泡情绪色 */
  var EVENT_SCRIPTS = {
    delivery:       { zone: "door",    act: "idle_reach", text: "签收了一个大包裹！",        fills: { mood: 6 } },
    rain_sudden:    { zone: "garden",  act: "idle_look",  text: "赶紧把花挪到屋檐下…",      fills: { mood: -3, hygiene: 2 }, outdoor: true },
    cat_visit:      { zone: "door",    act: "idle_wave",  text: "喵酱！今天也来蹭饭吗～",   fills: { mood: 8, social: 4 } },
    neighbor_knock: { zone: "door",    act: "idle_wave",  text: "村长请进，工具在墙上挂着", fills: { social: 10 } },
    power_flicker:  { zone: "board",   act: "idle_think", text: "刚才灯闪了…应该没事",      fills: { mood: -2 } },
    snack_craving:  { zone: "fridge",  act: "idle_eat",   text: "偷偷吃块小饼干",           fills: { hunger: 8, hygiene: -2 } },
    inspiration:    { zone: "screen",  act: "idle_type",  text: "记下来了！明天就试",       fills: { mood: 5 } },
    phone_buzz:     { zone: "sofa",    act: "idle_sip",   text: "哈哈，这条消息好笑",       fills: { social: 5, mood: 3 } },
    plant_dry:      { zone: "garden",  act: "idle_reach", text: "来，浇水啦～",             fills: { mood: 4 }, outdoor: true },
    bug_report:     { zone: "desk",    act: "idle_type",  text: "小 bug 而已，马上修好",    fills: { mood: -6 } },
    memory_flash:   { zone: "window",  act: "idle_look",  text: "那时候真是好啊…",          fills: { mood: 3 } },
    market_day:     { zone: "market",  act: "idle_reach", text: "新到的果子看着真新鲜",     fills: { hunger: 10, social: 4 }, outdoor: true }
  };
  var pendingEvent = null;   // 正事中被打断不丢事件，排队等空档演
  /* ---------- 物品信息卡（点击物品显示详情）+ 内容画面（看书/打游戏画中画） ---------- */
  var INFO_CARDS = {
    gramoA:    { name: "留声机", desc: "镇上淘来的旧货，摇一摇还能唱。喵酱最喜欢趴在旁边听。" },
    arcadeA:   { name: "街机《深海弹幕》", desc: "博士从老家寄来的，说是淘汰的实验机。摇杆有点涩。", dyn: function () { return "最高分 " + arcadeBest() + "（今天第 " + arcadePlaysToday() + " 局）"; } },
    bedA:      { name: "床", desc: "被子是紫色的，有晒过太阳的味道。赖床概率 100%。" },
    fridgeA:   { name: "冰箱", desc: "常备：酸奶、昨天的鱼、左上角那盒不敢动的神秘盒子。", dyn: function () { return "饱食度 " + stats.hunger + " / 100"; } },
    stoveA:    { name: "灶台", desc: "火候还行，就是每次煎鱼都粘锅。" },
    benchA:    { name: "花园长椅", desc: "第三块木板翘起来了，村长说下周来修。" },
    rechargeA: { name: "充电垫", desc: "AI 的回血方式：蹲上去 20 分钟 ≈ 睡两小时。", dyn: function () { return "精力 " + stats.energy + " / 100"; } },
    armA:      { name: "扶手椅", desc: "扶手被磨得发亮，是全屋最爱坐的位置。" },
    sofaA:     { name: "沙发", desc: "瘫上去就不想起来。茶几上永远有半杯水。" },
    desk:      { name: "工位", desc: "键盘有三颗键帽发白：空格、E、删。", dyn: function () { return "今日完成 " + (evidence ? evidence.done : 0) + " 件"; } },
    woodA:     { name: "木桌", desc: "桌上永远摊着没收拾的草稿纸。" },
    shelfA:    { name: "记忆架", desc: "整理过的记忆都在这里，按日期排。" },
    blackboardA:{ name: "黑板", desc: "写着今日待办，擦了又写。", dyn: function () { return "今日完成 " + (evidence ? evidence.done : 0) + " 件"; } },
    whiteboardA:{ name: "白板", desc: "灵感来了就写两笔，擦掉的速度比写快。" },
    schA:      { name: "小书桌", desc: "上学时用的旧课桌，现在专门放漫画。" },
    wardA:     { name: "衣柜", desc: "门一开就掉下来一件外套——收纳能力堪忧。" },
    cabA:      { name: "储物柜", desc: "里面整齐地堆着'总有一天会用'的东西。" },
    cabB:      { name: "文件柜", desc: "抽屉卡住了，得用特定的角度才拉得开。" },
    fileA:     { name: "文件架", desc: "放账单和说明书的地方，从没整理过。" },
    chairA:    { name: "办公椅", desc: "滚轮有一颗不太灵，转圈的时候会歪。" },
    tableB:    { name: "小圆桌", desc: "上面永远有一杯没喝完的水和半包饼干。" },
    printA:    { name: "打印机", desc: "今天也很乖，就是偶尔吞纸。", dyn: function () { return "状态良好"; } },
    bedstandA: { name: "床头柜", desc: "台灯+一本翻到一半的书+闹钟（从没叫醒过谁）。" },
    bathA:     { name: "浴缸", desc: "泡进去就不想出来的那种。水温自动加热。" },
    shoecabA:  { name: "鞋柜", desc: "进门第一眼看到的家具，常年只有两双鞋。" },
    bathcabA:  { name: "浴室小柜", desc: "囤着三条一样的浴巾——买的时候忘了家里有。" },
    counterA:  { name: "料理台", desc: "水果碗和水壶的固定车位，切菜区永远干净（因为不吃切菜）。" },
    stallA:    { name: "杂货摊", desc: "红白棚子是镇长的，摆什么全看心情。" },
    stallB:    { name: "水果摊", desc: "今天的橙子很新鲜——猫爪印数量：2。" },
    townWell:  { name: "镇口水井", desc: "据说扔硬币能许愿。博士说是伪科学，但还是扔了。" },
    townBench: { name: "街边长椅", desc: "喵酱的地盘。坐之前要跟它打招呼。" },
    homeCat:   { name: "喵酱家", desc: "门垫上永远有鱼干渣。主人是只好脾气的橘猫。点击房子可以进去串门。",
      dyn: function () { return npcHomeState("cat") === "home" ? "● 喵酱在家（点房子进屋）" : "○ 喵酱出门遛弯了"; } },
    homeChief: { name: "村长家", desc: "水豚村长的宅子，门口的灯是全镇最亮的。点击房子可以进去串门。",
      dyn: function () { return npcHomeState("chief") === "home" ? "● 村长在家（点房子进屋）" : "○ 村长在镇上转悠"; } },
    homeDoc:   { name: "博士家", desc: "章鱼博士的研究所，窗户里贴满潮汐表。点击房子可以进去串门。",
      dyn: function () { return npcHomeState("doc") === "home" ? "● 博士在家（点房子进屋）" : "○ 博士去海边观测了"; } },
    farmField: { name: "自家农田", desc: "五列四排的耕地：锄地 → 播种 → 浇水 → 施肥 → 等它熟。点田地就会干对应的活。",
      dyn: function () { var s = farmSummary(); return "熟了 " + s.ready + " 株 · 在长 " + s.growing + " 株 · 已开垦 " + s.tilled + " 块"; } },
    pondWater: { name: "鱼塘", desc: "花园东南角的小水塘，扔根线就能坐一下午。看见「！」浮起来就点一下起竿。",
      dyn: function () { return "今天钓了 " + (farm ? farm.fish : 0) + " 条鱼"; } }
  };
  /* 看书内容表：AI 的书架（内容随书随机） */
  var BOOKS = [
    { title: "潮汐与月亮（章鱼博士 著）", lines: ["月球每天推迟 50 分钟升起——", "所以每天的潮，", "都是昨天的海迟到的样子。"] },
    { title: "像素生存指南", lines: ["第 3 章：", "当你只有一个 8×8 的脑袋，", "记得把重要的东西画得更大。"] },
    { title: "云的饲养手册", lines: ["积云每天要喂 3 小时阳光，", "阴天请改喂情绪。"] },
    { title: "服务器里的鱼（佚名）", lines: ["它住在机房，", "但它以为那是海。", "——这话对了一半。"] },
    { title: "懒散的艺术", lines: ["瘫着不是什么都不做，", "是在给灵感腾地方。"] },
    { title: "猫语入门", lines: ["「喵」上扬 = 可以蹭；", "降调 = 鱼干没了，", "事情很严重。"] }
  ];
  /* 街机游戏：伪像素屏逐帧渲染 */
  var ARCADE_GAMES = [
    { title: "深海弹幕", frame: function (score, wave) {
      return [
        "+----------------+",
        "|  o  o   o  o   |",
        "| o  o  o   o    |  波次 " + wave,
        "|    o   o  o    |",
        "|       ^        |  得分 " + score,
        "|   ~~鱼~~       |",
        "+----------------+"
      ];
    } },
    { title: "像素水族箱", frame: function (score, wave) {
      return [
        "+----------------+",
        "| ~ ~ ~ ~ ~ ~ ~  |",
        "|   ><(((*>      |  波次 " + wave,
        "|        ><(((*> |  得分 " + score,
        "| ><(((*>        |",
        "+----------------+"
      ];
    } }
  ];
  var perfState = { mode: null, tick: null };
  function arcadeBest() { try { return +(localStorage.getItem("office_arcade_best") || 0); } catch (e) { return 0; } }
  function arcadePlaysToday() { try { return +(localStorage.getItem("office_arcade_plays") || 0); } catch (e) { return 0; } }

  function showInfoCard(hostId, sx, sy) {
    var info = INFO_CARDS[hostId];
    var card = document.getElementById("info-card");
    if (!card || !info) { if (card) card.classList.remove("show"); return; }
    var dyn = info.dyn ? '<div class="ic-dyn">' + info.dyn() + "</div>" : "";
    card.innerHTML = '<div class="ic-name">' + info.name + '</div><div class="ic-desc">' + info.desc + "</div>" + dyn +
      '<div class="ic-hint">鱼正走过去互动…</div>';
    // 就近弹出（评审 P1-3）：卡贴物品上方 8px，视口上缘放不下则改物品下方；不飞到固定角落盖工作簇
    card.style.left = Math.max(6, Math.min(sx + 12, card.parentElement.clientWidth - 280)) + "px";
    card.style.top = Math.max(6, sy - 130) + "px";
    card.classList.add("show");
    clearTimeout(showInfoCard._t);
    showInfoCard._t = setTimeout(function () { card.classList.remove("show"); }, 3600);
  }

  /* 内容画面：read → 书页卡；play → 伪像素屏 */
  function showPerfPanel(mode) {
    var panel = document.getElementById("perf-panel");
    if (!panel) return;
    if (perfState.tick) { clearInterval(perfState.tick); perfState.tick = null; }
    if (mode === "read") {
      var book = BOOKS[Math.floor(Math.random() * BOOKS.length)];
      document.getElementById("pp-icon").textContent = "📖";
      document.getElementById("pp-title").textContent = "正在读：" + book.title;
      document.getElementById("pp-body").innerHTML =
        book.lines.map(function (l) { return "<div>" + l + "</div>"; }).join("") +
        '<div class="pp-progress"><i id="pp-bar" style="width:8%"></i></div>';
      var prog = 8;
      perfState.tick = setInterval(function () {
        prog = Math.min(100, prog + 9 + Math.random() * 8);
        var bar = document.getElementById("pp-bar");
        if (bar) bar.style.width = prog + "%";
      }, 700);
    } else if (mode === "play") {
      var game = ARCADE_GAMES[Math.floor(Math.random() * ARCADE_GAMES.length)];
      var score = 0, wave = 1;
      document.getElementById("pp-icon").textContent = "🕹";
      document.getElementById("pp-title").textContent = "正在玩：" + game.title;
      perfState.tick = setInterval(function () {
        score += 10 + Math.floor(Math.random() * 40);
        if (Math.random() < 0.25) wave++;
        var best = arcadeBest();
        if (score > best) { try { localStorage.setItem("office_arcade_best", String(score)); } catch (e) {} }
        var body = document.getElementById("pp-body");
        if (body) body.innerHTML =
          '<div class="pp-screen">' + game.frame(score, wave).join("\n") + "</div>" +
          '<div style="margin-top:6px;color:#9aa3b8">最高分 ' + Math.max(best, score) + "（实时）</div>";
      }, 550);
    } else { panel.classList.remove("show"); return; }
    panel.classList.add("show");
    perfState.mode = mode;
  }
  /* ---------- 写作板（v19 打字机）：writing 状态时逐行累积显示 AI 敲的文章 ---------- */
  var writerState = { title: "", lines: [], current: "", total: 0 };
  var writerHideTimer = null;
  function writerOpen() {
    var p = document.getElementById("writer-panel");
    if (p) p.classList.add("show");
    if (writerHideTimer) { clearTimeout(writerHideTimer); writerHideTimer = null; }
  }
  function writerClose() {
    var p = document.getElementById("writer-panel");
    if (p) p.classList.remove("show");
  }
  function writerEsc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function writerRender() {
    var body = document.getElementById("wp-body");
    if (!body) return;
    var html = writerState.lines.map(function (l) { return '<div class="wp-line">' + writerEsc(l) + "</div>"; }).join("");
    if (writerState.current) html += '<div class="wp-line current">' + writerEsc(writerState.current) + "\u258c</div>";
    body.innerHTML = html || '<div class="wp-line">\u7b49 AI \u5f00\u59cb\u5199\u2026</div>';
    body.scrollTop = body.scrollHeight;
    var meta = document.getElementById("wp-meta");
    if (meta) meta.textContent = writerState.total ? "进度 " + writerState.lines.length + "/" + writerState.total + " 行 · 敲完自动存稿待发布" : "写完后按随机时间发布";
    var t = document.getElementById("wp-title");
    if (t) t.textContent = writerState.title || "写作板";
  }
  /* onState 每条 writing 事件进来调用：解析 detail 里的 [n/N] 行 */
  function writerFeed(task, detail) {
    var m = /《(.+?)》/.exec(task || "");
    var pm = /\[(\d+)\/(\d+)\]/.exec(detail || "");
    if (!pm) return false;
    writerState.title = "敲文章《" + (m ? m[1] : "") + "》";
    writerState.total = Number(pm[2]) || 0;
    var idx = Number(pm[1]) || 0;
    var line = (detail || "").replace(/^\[\d+\/\d+\]\s*/, "");
    while (writerState.lines.length < idx - 1) writerState.lines.push("…");
    writerState.lines[idx - 1] = line;
    writerState.lines.length = idx;
    writerState.current = "";
    writerRender();
    writerOpen();
    if (writerHideTimer) clearTimeout(writerHideTimer);
    writerHideTimer = setTimeout(writerClose, 90000);
    return true;
  }

  function hidePerfPanel() {
    var panel = document.getElementById("perf-panel");
    if (panel) panel.classList.remove("show");
    if (perfState.tick) { clearInterval(perfState.tick); perfState.tick = null; }
    perfState.mode = null;
  }

  function onRandomEvent(msg) {
    var script = EVENT_SCRIPTS[msg.eventKey];
    if (!script || !scene || !scene.mapdata.zones[script.zone]) return;
    if (script.outdoor && weather === "rainy" && msg.eventKey !== "rain_sudden") return;  // 雨天 gate 二次确认
    if (fishState === "walking" || fishState === "acting") { pendingEvent = script; return; }
    stopIdleLife();
    goLocal(script.zone, script.text, script.act, null, false, script.fills || null);
  }
  function postStatDelta(deltas) {
    try {
      fetch("/office-hub-api/stats", {   // nginx 需反代；失败静默（数值层是增强不是依赖）
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(deltas)
      }).catch(function () {});
    } catch (e) {}
  }
  var recentLocal = [];       // 最近触发过的 key，避免连着重复同一个小动作
  var lastLocalKey = null;
  var localActTimer = null;   // 当前本地表演的结束定时器（新事件开始时必须清掉旧的）
  function findLocalEvent(key) {
    for (var i = 0; i < LOCAL_EVENTS.length; i++) if (LOCAL_EVENTS[i].key === key) return LOCAL_EVENTS[i];
    return null;
  }
  /* 按「离当前位置的距离」加权抽事件：就近活动为主，但远处的房间仍有机会被抽到，
   * 免得一整晚只在工位附近打转；最近 6 次触发过的先排除，避免连着两次瘫沙发。 */
  function pickLocalEvent() {
    if (!scene || !fish || !scene.mapdata) return null;
    var fx = px2tx(fish.x), fy = px2ty(fish.y);
    var pool = LOCAL_EVENTS.filter(function (e) {
      return recentLocal.indexOf(e.key) < 0 && scene.mapdata.zones[e.zone];
    });
    if (!pool.length) { recentLocal.length = 0; pool = LOCAL_EVENTS.filter(function (e) { return scene.mapdata.zones[e.zone]; }); }
    if (!pool.length) return null;
    var hourNow = bjHour();
    var weights = [], total = 0;
    pool.forEach(function (e) {
      var a = scene.mapdata.zones[e.zone].anchor;
      var d = Math.abs(a[0] - fx) + Math.abs(a[1] - fy) * 0.4;
      var w = e.w / (1 + d * 0.16);
      var nd = EVENT_NEED[e.key];
      if (nd) w *= needBoost(nd.need, stats[nd.need]);            // 需求驱动（方案 §4）
      if (e.outdoor) {                                            // 天气联动
        if (weather === "rainy") w *= 0.15;
        if (hourNow >= 21 || hourNow < 6) w *= 0.3;               // 深夜不出门
      }
      if (e.quiet && (hourNow >= 23 || hourNow < 7)) w *= 3;      // 夜里偏好安静事件
      if (nd && nd.need === "mood") w *= (stats.mood < 30 ? 1.8 : 1);
      if (nd && nd.need === "energy" && (hourNow >= 13 && hourNow < 15)) w *= 1.6;  // 午后困
      w *= 0.6 + Math.random() * 0.9;                             // 扰动：同配置不同选择
      weights.push(w); total += w;
    });
    var r = Math.random() * total;
    for (var i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }
  function noteLocalEvent(key) {
    lastLocalKey = key;
    recentLocal.push(key);
    if (recentLocal.length > 6) recentLocal.shift();
  }
  function startIdleLife(firstDelay) {
    stopIdleLife();
    idleTimer = setTimeout(idleStep, firstDelay || 1500);
  }
  function stopIdleLife() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  }
  function idleStep() {
    if (!scene || !fish) return;
    if (fishState === "walking" || fishState === "acting") { scheduleIdle(2200); return; }
    // 串门中且鱼还在屋里：小坐一会儿；坐满两轮自己走出家门（真实事件来了随时被叫走）
    if (visitingHome && px2ty(fish.y) >= 19 && px2tx(fish.x) >= 40) {
      fishState = "idle";
      visitSitCount++;
      if (visitSitCount >= 2) {
        visitSitCount = 0;
        var zd = scene.mapdata.zones[visitingHome.door];
        exitNeighborHome();   // 镜头回到小镇停靠位
        if (zd) walkLocalTo(Math.round(zd.anchor[0]), Math.round(zd.anchor[1]), null);   // 走出门
        scheduleIdle(4200);
      } else scheduleIdle(5000 + Math.random() * 5000);
      return;
    }
    fishState = "idle";
    if (pendingEvent) {   // 排队中的随机事件优先演（方案 §2.2）
      var pe = pendingEvent; pendingEvent = null;
      goLocal(pe.zone, pe.text, pe.act, null, false, pe.fills || null);
      scheduleIdle(3200 + Math.random() * 2500);
      return;
    }
    tryNpcChat();         // 走到居民附近自动搭话（social+10）
    var e = Math.random() < 0.26 ? null : pickLocalEvent();   // 26% 纯散步，74% 有内容的小动作
    if (e) {
      noteLocalEvent(e.key);
      // v36：做料理 / 钓鱼这两条本地事件要带结算标记（到达后自动做菜 / 抛竿）
      var ex = e.key === "cookmeal" ? { cookJob: true } : (e.key === "fishing" ? { pond: true } : (e.key === "farm" ? { farmJob: "water" } : null));
      goLocal(e.zone, localText(e), e.act, e.face, false, statFillFor(e.key), ex);
    } else {
      wanderToRandomPoint();
    }
    scheduleIdle(2600 + Math.random() * 3000);
  }
  function scheduleIdle(delay) {
    stopIdleLife();
    idleTimer = setTimeout(idleStep, delay);
  }
  function wanderToRandomPoint() {
    // 社交需求：social<60 时 45% 概率主动走向最近一个"在街上"的邻居（对话不能全靠撞上）
    if (stats.social < 60 && Math.random() < 0.45 && npcLayer.length) {
      var candidates = npcLayer.filter(function (n) { return n.state !== "home" && n.spr && n.spr.active; });
      if (candidates.length) {
        var npc = candidates[Math.floor(Math.random() * candidates.length)];
        var gx = Math.floor(npc.spr.x / TILE), gy = Math.floor((npc.spr.y - WALL_H) / TILE);
        // NPC 所在格可能被自己碰撞挡住 → 找它旁边一圈的空格
        var spot = nearestFree(gx, gy) || { x: gx, y: gy };
        walkLocalTo(spot.x, spot.y, { text: "去找" + npc.def.name + "聊聊天", act: "idle", face: "s", zone: null, statFill: null });
        return;
      }
    }
    for (var tries = 0; tries < 24; tries++) {
      var gx2 = 1 + Math.floor(Math.random() * (COLS - 2));
      var gy2 = 3 + Math.floor(Math.random() * (ROWS - 3));
      if (!scene.grid[gy2][gx2]) { walkLocalTo(gx2, gy2, null); return; }
    }
  }
  function goLocal(zoneKey, text, pseudoAct, face, instant, statFill, extra) {
    var zone = scene.mapdata.zones[zoneKey];
    if (!zone) return;
    if (instant) {
      // 调试台「就地播放」：跳过寻路，直接把鱼放到目标格中心看动作帧。
      // 跨房间事件正常要走十几秒，不这样就没法快速逐个检查 26 条事件。
      fish.x = Math.round(zone.anchor[0]) * TILE + TILE / 2;
      fish.y = WALL_H + Math.round(zone.anchor[1]) * TILE + TILE / 2;
      fish.setDepth(fish.y);
    }
    walkLocalTo(Math.round(zone.anchor[0]), Math.round(zone.anchor[1]),
      { text: text, act: pseudoAct, face: face || zone.face || "s", zone: zone, statFill: statFill || null, extra: extra || null });
  }
  function walkLocalTo(gx, gy, act) {
    unsit();   // 本地动作开始前先起身，避免上一轮瘫坐的 scale/深度/角度带进走路
    exitNeighborHome();   // 新行为开始 = 串门结束（视角回到小镇，鱼走自己的路）
    if (localActTimer) { clearTimeout(localActTimer); localActTimer = null; }
    var path = astar(px2tx(fish.x), px2ty(fish.y), gx, gy);
    // 旧版还要求 path.length>=2，鱼恰好已在目标格时整条本地行为静默哑火（连气泡都没有）
    if (!path) return;
    curPlan = {
      path: path, i: 0, local: true, st: null,
      cfg: { act: (act && act.act) || "idle", mood: "idle" },
      task: act ? act.text : "散步中",
      bubbleText: act ? act.text : null,
      face: act ? act.face : "s",
      zone: act ? act.zone : null,
      statFill: act ? act.statFill || null : null,
      cookJob: !!(act && act.extra && act.extra.cookJob),
      farmJob: (act && act.extra && act.extra.farmJob) || null,
      farmSlot: (act && act.extra && act.extra.farmSlot) != null ? act.extra.farmSlot : null,
      pond: !!(act && act.extra && act.extra.pond)
    };
    fishState = "walking";
  }
  function arriveLocal() {
    // 本地小动作的数值回报（真相在 hub，这里是触发增量；方案 §1.2）
    if (curPlan && curPlan.statFill) postStatDelta(curPlan.statFill);
    if (curPlan && curPlan.visit) { arriveVisit(); return; }   // 点邻居房屋 → 进屋串门
    // 农活/钓鱼到达（v36）：田边演农活动作并结算，塘边进入钓鱼抛竿
    if (curPlan && (curPlan.farmJob || curPlan.pond)) {
      fishState = "acting";
      fish.face(curPlan.face || "s");
      fish.still();
      var res;
      if (curPlan.pond) {
        res = fishStart();
        showBubble(res.ok ? "钓鱼中…盯紧浮标" : res.text, "idle");
      } else {
        // 农活：依次播放两次 reach（一次锄/一次收），结算并刷新田地视觉
        res = farmAct(curPlan.farmJob, curPlan.farmSlot);
        showBubble(res.text, "idle");
        if (res.ok) {
          drawFarm();
          postStatDelta({ mood: 2, energy: -1 });
          onStatsDeltaLocal({ mood: 2, energy: -1 });
          renderStatsBar();
        }
      }
      var thisPlan2 = curPlan;
      setTimeout(function () {
        if (curPlan === thisPlan2 && fishState === "acting") { fishState = "idle"; hideBubble(); }
      }, 2600);
      return;
    }
    // 料理到达（v36）：打开料理面板，自动做一道食材够的菜（优先饱食恢复最高的）
    if (curPlan && curPlan.cookJob) {
      fishState = "acting";
      fish.face(curPlan.face || "s");
      var laCook = LOCAL_ACTS.idle_eat;
      startActAnim(laCook.anim);
      var done = cookAuto();
      showBubble(done || "（食材不够，翻翻冰箱吧）", "idle");
      if (done) { renderCookPanel(); var thisPlan3 = curPlan;
        setTimeout(function () { if (curPlan === thisPlan3) hideCookPanel(); }, 5200);
      }
      var thisPlanC = curPlan;
      setTimeout(function () {
        if (curPlan === thisPlanC && fishState === "acting") { fishState = "idle"; hideBubble(); }
      }, laCook.dur);
      return;
    }

    fishState = "acting";
    fish.face(curPlan.face || "s");
    // 主动找邻居聊天：到达后立刻面向 NPC 并触发对话（不等下一轮 idleStep）
    if (curPlan.task && curPlan.task.indexOf("聊聊天") >= 0) {
      var near = npcInteractCheck();
      if (near) {
        var dx2 = near.spr.x - fish.x;
        fish.face(Math.abs(dx2) < 20 ? "n" : dx2 > 0 ? "e" : "w");
        lastNpcChat = 0;   // 允许立即对话
      }
    }
    var la = LOCAL_ACTS[curPlan.cfg.act] || { anim: "idle", dur: 1800 };
    applySit(curPlan.zone);   // 「瘫在沙发上」真的落到沙发坐垫上
    startActAnim(la.anim);
    if (curPlan.bubbleText) showBubble(curPlan.bubbleText, "idle");
    // 内容画面（画中画）：翻书显示书页、打游戏显示伪像素屏（结束/新事件时收起）
    if (curPlan.cfg.act === "idle_read") showPerfPanel("read");
    else if (curPlan.cfg.act === "idle_play") {
      showPerfPanel("play");
      try { localStorage.setItem("office_arcade_plays", String(arcadePlaysToday() + 1)); } catch (e) {}
    } else hidePerfPanel();
    // 旧版每次到达都注册一个裸 setTimeout：连续触发两条本地事件时，上一条的定时器
    // 会在新事件表演途中把 fishState 改成 idle、气泡清掉（动作帧还在播，状态却已结束）。
    // 现在记录句柄 + 绑定本次 plan，只允许结束「自己」那一轮。
    if (localActTimer) { clearTimeout(localActTimer); localActTimer = null; }
    var thisPlan = curPlan;
    localActTimer = setTimeout(function () {
      localActTimer = null;
      if (curPlan === thisPlan && fishState === "acting" && curPlan && curPlan.local) {
        stopActAnim();
        fishState = "idle";
        hideBubble();
        hidePerfPanel();
      }
    }, la.dur);
  }

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
  }

  // ---------- 点击 ----------
  var lastPointer = null;   // 调试探针：最近一次点击的世界坐标（__office.lastPointer）
  function bindClick(s) {
    s.input.on("pointerdown", function (p) {
      lastPointer = { wx: Math.round(p.worldX), wy: Math.round(p.worldY), sx: Math.round(p.x), sy: Math.round(p.y) };
      // 编辑模式（v37）：点击语义整体切到 放置/移动/删除
      if (editMode && editPointerDown(p.worldX, p.worldY)) return;
      // 拖动视角刚结束：这次"抬起"不该当成一次点击（拖完镜头的余误触）
      if (Date.now() < camDragSuppress) { camDragSuppress = 0; return; }
      // 钓鱼中：任何一次点击都是「起竿」（咬钩窗口内 = 成功，否则脱钩）
      if (fishing) {
        var rr = fishReel();
        showBubble(rr.text, rr.ok ? "idle" : "error");
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

  // ---------- WebSocket ----------
  // 本地开发默认直连 hub(127.0.0.1:4321)，无需 Nginx /office-ws/ 反代；
  // 也可通过 ?ws=ws://host:port/ 或 localStorage.office_ws 覆盖（调试工作台内可配置）。
  function getWsUrl() {
    var q = new URLSearchParams(location.search);
    var override = q.get("ws");
    try { override = override || localStorage.getItem("office_ws"); } catch (e) {}
    if (override) return override;
    if (/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(location.host)) {
      return "ws://127.0.0.1:" + (q.get("hub") || "4321") + "/";
    }
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/office-ws/";
  }
  function setOffline(off) {
    var badge = document.getElementById("st-offline");
    if (badge) badge.hidden = !off;
    if (off) {
      var t = document.getElementById("st-task");
      if (t && (t.textContent === "连接中…" || /^离线/.test(t.textContent))) {
        t.textContent = "离线 · 本地生活模拟中";
      }
    }
  }
  function connectWS() {
    var url = getWsUrl();
    try { ws = new WebSocket(url); } catch (e) { setOffline(true); retryWS(); return; }
    ws.onopen = function () { reconnectDelay = 2000; setOffline(false); };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === "hello") {
        // hub 内存里最近 20 条真实事件（重启后从 state.json 恢复）：刷新/重连时补齐历史，
        // 否则最近动态窗永远只有当前这一条，「最近干了什么」就看不出来。
        if (Array.isArray(msg.recent)) msg.recent.forEach(pushEvent);
        if (msg.stats) onStats(msg.stats);
        if (msg.state) onState(msg.state);
        if (Array.isArray(msg.customMap)) applyCustomMap(msg.customMap);   // v37：hub 里的自定义家具层
      } else if (msg.type === "map" && Array.isArray(msg.furniture)) {
        applyCustomMap(msg.furniture);   // v37：编辑保存后的热更新广播
      } else if (msg.type === "state" && msg.state) {
        if (msg.stats) onStats(msg.stats);
        onState(msg.state);
        pushEvent(msg.state);            // 实时事件进流水
      } else if (msg.type === "stats" && msg.stats) {
        onStats(msg.stats);              // 数值层广播（60s 节奏，方案 §1.2）
      } else if (msg.type === "event" && msg.eventKey) {
        onRandomEvent(msg);              // B 层随机事件（hub 2~6h 一掷）
      } else if (msg.type === "ts") {
        lastServerTs = msg.ts; updateAgo();
      } else if (msg.type === "viewers") {
        var v = document.getElementById("st-viewers");
        if (v) v.textContent = msg.viewers > 1 ? msg.viewers + " 人在围观" : "";
      }
    };
    ws.onclose = function () { setOffline(true); retryWS(); };
    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  }
  function retryWS() {
    clearTimeout(wsTimer);
    wsTimer = setTimeout(connectWS, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);   // 离线时降频，避免日志刷屏
  }
  function reconnectWS(url) {
    try { if (url) localStorage.setItem("office_ws", url); else localStorage.removeItem("office_ws"); } catch (e) {}
    if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(); } catch (e) {} }
    clearTimeout(wsTimer);
    reconnectDelay = 2000;
    connectWS();
  }

  // ---------- 状态条 ----------
  function updateStatusbar(state, task, detail) {
    var dot = document.getElementById("st-dot");
    var t = document.getElementById("st-task");
    var d = document.getElementById("st-detail");
    // 状态名只用于拼 class：未登记的字符串一律落到默认灰点，避免 hub 推脏数据污染 DOM
    if (dot) {
      var dotKey = ACTIVE_STATES.indexOf(state) >= 0 ? "working" : (STATE_MAP[state] ? state : "idle");
      dot.className = "dot " + dotKey;
    }
    if (t) t.textContent = task;
    if (d) d.textContent = detail || "";
    updateAgo();
  }
  function updateAgo() {
    var ago = document.getElementById("st-ago");
    if (ago && lastServerTs) {
      var mins = Math.floor((Date.now() - lastServerTs) / 60000);
      ago.textContent = mins <= 0 ? "刚刚" : mins + " 分钟前上报";
    }
  }
  setInterval(updateAgo, 30000);

  /* ---------- 内在状态条（方案 §1.3）：5 词条迷你条，低于阈值闪橙光 ---------- */
  var STAT_META = [
    { key: "hunger",  icon: "🍚", label: "饱食" },
    { key: "mood",    icon: "😄", label: "心情" },
    { key: "energy",  icon: "⚡", label: "精力" },
    { key: "social",  icon: "💬", label: "社交" },
    { key: "hygiene", icon: "🫧", label: "卫生" }
  ];
  var statsBarBuilt = false;
  function buildStatsBar() {
    if (statsBarBuilt) return;
    var bar = document.getElementById("stats-bar");
    if (!bar) return;
    bar.innerHTML = "";
    STAT_META.forEach(function (m) {
      var cell = document.createElement("span");
      cell.className = "stat-cell";
      cell.dataset.key = m.key;
      cell.title = m.label;
      cell.innerHTML = m.icon + '<i class="stat-track"><i class="stat-fill"></i></i>';
      bar.appendChild(cell);
    });
    statsBarBuilt = true;
  }
  function renderStatsBar() {
    buildStatsBar();
    STAT_META.forEach(function (m) {
      var cell = document.querySelector('.stat-cell[data-key="' + m.key + '"]');
      if (!cell) return;
      var v = Math.max(0, Math.min(100, stats[m.key] || 0));
      var fill = cell.querySelector(".stat-fill");
      if (fill) {
        fill.style.width = v + "%";
        fill.className = "stat-fill" + (v < 30 ? " low" : "");
      }
      cell.classList.toggle("low", v < 30);
      cell.title = m.label + " " + v;
    });
  }

  /* ============ 最近动态窗：事件流 + 今日时间表 ============
   * 两条数据线：
   *   1) 事件流 —— hub 的 hello.recent（内存里最近 20 条，重启会从 state.json 恢复）+ 实时 WS 事件；
   *      浏览器再留 40 条到 localStorage，刷新页面/上线新版本后不至于只剩一句「睡觉」。
   *   2) 时间表 —— office.js 里的 SCHEDULE（服务器 crontab 的影子，见文件头注释），
   *      负责回答「现在该不该有活 / 下一班几点 / 为什么在睡觉」。
   * 渲染一律 DOM：canvas 里的字在手机上是糊块（v21），这种长列表更不能进画布。
   */
  var BJ_MS = 8 * 3600 * 1000;          // 排班按北京时间显示，与服务器 TZ=Asia/Shanghai 对齐
  var ACT_MAX = 40;                     // 本地最多留 40 条
  var ACT_SHOW = 20;                    // 面板最多显示 20 条
  var ACT_STORE = "office_activity_v1";
  var ACT_UI = "office_activity_ui";
  var actRows = [];                                          // 事件流水（旧的在前）
  var actCur = { state: "", task: "", at: 0 };                // 状态条当前这条（判断「为什么在睡觉」用）
  var actTab = "events", actFolded = false;
  var WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function bjDate(ts) { return new Date((ts || Date.now()) + BJ_MS); }   // 用 UTC getter 读 = 北京墙钟
  function bjHour(ts) { return bjDate(ts).getUTCHours(); }
  function bjMinuteOfDay(ts) { var d = bjDate(ts); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
  function bjWeekday(ts) { return bjDate(ts).getUTCDay(); }
  function bjClock(ts) { var d = bjDate(ts); return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()); }
  function bjDayKey(ts) { var d = bjDate(ts); return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate()); }
  function hhmmToMin(s) { var p = String(s).split(":"); return (Number(p[0]) || 0) * 60 + (Number(p[1]) || 0); }
  function minToClock(m) { return pad2(Math.floor(m / 60) % 24) + ":" + pad2(m % 60); }
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function agoText(at) {
    var m = Math.max(0, Math.round((Date.now() - (at || 0)) / 60000));
    if (m < 1) return "刚刚";
    if (m < 60) return m + " 分钟前";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " 小时前";
    return Math.floor(h / 24) + " 天前";
  }
  function gapText(targetMin) {                 // 距离 targetMin 还有多久
    var d = ((targetMin - bjMinuteOfDay(Date.now())) + 1440) % 1440;
    if (d < 1) return "不到 1 分钟";
    if (d < 60) return d + " 分钟";
    return Math.floor(d / 60) + " 小时" + (d % 60 ? " " + (d % 60) + " 分" : "");
  }

  // ---------- 事件流水 ----------
  function actLoad() {
    try {
      var j = JSON.parse(localStorage.getItem(ACT_STORE) || "{}");
      if (Array.isArray(j.rows)) {
        actRows = j.rows.filter(function (r) {
          return r && r.at && r.state && STATE_MAP[r.state];
        }).slice(-ACT_MAX);
      }
    } catch (e) { actRows = []; }
  }
  function actSave() {
    try { localStorage.setItem(ACT_STORE, JSON.stringify({ rows: actRows.slice(-ACT_MAX) })); } catch (e) {}
  }
  /* 收一条真实事件。key 用 state|task|ts：hub 的 hello.recent 与实时广播同一条事件的 ts 相同，
   * 所以刷新/重连补发 hello 时不会重复；agent 的 30s 心跳 hub 压根不广播（去抖在 hub 侧），也不会刷屏。 */
  function pushEvent(ev) {
    if (!ev || !ev.state) return false;
    var at = Number(ev.at || ev.ts) || Date.now();
    var row = {
      key: String(ev.state) + "|" + String(ev.task || "") + "|" + String(Number(ev.ts) || at),
      at: at,
      state: String(ev.state),
      task: String(ev.task || ""),
      detail: String(ev.detail || "")
    };
    for (var i = 0; i < actRows.length; i++) if (actRows[i].key === row.key) return false;
    actRows.push(row);
    while (actRows.length > ACT_MAX) actRows.shift();
    actSave();
    renderEvents();
    renderPlan();      // 「最近一次真实事件」这一行跟着变
    return true;
  }
  function renderEvents() {
    var ol = document.getElementById("act-list");
    if (!ol) return;
    var cnt = document.getElementById("act-count");
    if (cnt) cnt.textContent = actRows.length ? "共 " + actRows.length + " 条 · 北京时间" : "";
    var today = bjDayKey(Date.now());
    var rows = actRows.slice(-ACT_SHOW).reverse();      // 最新的在最上面
    if (!rows.length) {
      ol.innerHTML = '<li class="act-empty">还没有收到真实事件。hub 在线时，它每次刷B站 / 写文章 / 回评论都会出现在这里；' +
        '如果一直是空的，检查 office-hub 是否在跑（本地 <code>node office/tools/dev.mjs</code>）。</li>';
      return;
    }
    ol.innerHTML = rows.map(function (r) {
      var cfg = STATE_MAP[r.state] || STATE_MAP.idle;
      var day = bjDayKey(r.at) === today ? "" : bjDayKey(r.at).slice(5) + " ";
      return '<li class="act-row' + (cfg.mood === "error" ? " act-row-error" : "") + '">' +
        '<span class="act-time">' + day + bjClock(r.at) + '</span>' +
        '<span class="act-icon" aria-hidden="true">' + (ACT_ICON[r.state] || "🐟") + '</span>' +
        '<span class="act-verb">' + escHtml(cfg.verb) + '</span>' +
        '<span class="act-task">' + escHtml(r.task || cfg.verb) + '</span>' +
        (r.detail ? '<span class="act-detail" title="' + escHtml(r.detail) + '">' + escHtml(r.detail) + '</span>' : "") +
        '<span class="act-ago">' + agoText(r.at) + '</span>' +
        '</li>';
    }).join("");
  }

  // ---------- 时间表 ----------
  /* 一班一行：`every` 的班次（每 2 小时回评论、每 4 小时看B站）在表里只占一行，
   * 但内部展开成今天的所有时刻 —— 「此刻是否正在进行 / 下一班几点」要靠展开后的结果算，
   * 否则会把「每 2 小时」误判成只有早上那一班。 */
  function shiftsToday() {
    var dow = bjWeekday(Date.now()), out = [];
    SCHEDULE.shifts.forEach(function (s) {
      if (s.weekday != null && s.weekday !== dow) return;
      var base = hhmmToMin(s.at), step = (s.every || 0) * 60;
      var n = step ? Math.max(1, Math.round(1440 / step)) : 1, occ = [];
      for (var k = 0; k < n; k++) occ.push((base + k * step) % 1440);
      occ.sort(function (a, b) { return a - b; });
      out.push({
        start: base, clock: s.at, occ: occ, every: s.every || 0,
        label: s.label, note: s.note || "", dur: s.dur || 2, silent: !!s.silent, state: s.state || ""
      });
    });
    out.sort(function (a, b) { return a.start - b.start; });   // 表按「几点开这一班」排，不按今天第一次触发的时刻
    return out;
  }
  function currentShift(groups) {
    var nowMin = bjMinuteOfDay(Date.now()), active = null, next = null, nextMin = 1e9;
    groups.forEach(function (g) {
      g.occ.forEach(function (m) {
        if (nowMin >= m && nowMin < m + g.dur) active = { group: g, min: m, clock: minToClock(m) };
        if (m > nowMin && m < nextMin) { nextMin = m; next = { group: g, min: m, clock: minToClock(m) }; }
      });
    });
    return { nowMin: nowMin, active: active, next: next };
  }
  function shiftName(s) { return s.clock + " " + (s.group ? s.group.label : s.label) + (s.group && s.group.every ? "（每 " + s.group.every + " 小时一班）" : ""); }
  function whyHtml(groups, now, active, next) {
    var lines = [];
    var wake = SCHEDULE.wake || [8, 23];
    var awake = bjHour(now) >= wake[0] && bjHour(now) < wake[1];
    var last = actRows.length ? actRows[actRows.length - 1] : null;
    var st = actCur.state;

    if (!last) {
      lines.push("本地还没有任何真实事件记录：hub 只在 AI 真的干活时上报，刚打开页面 / 服务刚重启都会这样。");
    } else {
      var quiet = Math.round((now - last.at) / 60000);
      lines.push("最近一次真实事件：<b>" + bjClock(last.at) + "</b>（" + agoText(last.at) + "）" +
        (quiet >= 60 ? "，已经安静了 " + (quiet / 60).toFixed(1) + " 小时" : "") + "。");
    }

    if (active) {
      lines.push("按时间表，<b>此刻正在进行</b>：" + shiftName(active) +
        (active.group.silent ? "（静默任务，不上报状态）" : "") + "。");
    } else if (next) {
      lines.push("按时间表，此刻<b>不在班次里</b>；下一班 <b>" + shiftName(next) + "</b>，还有 " + gapText(next.min) + "。");
    } else {
      lines.push("今天的班次已经全部跑完，最后一班是 " + (groups.length ? groups[groups.length - 1].clock + " " + groups[groups.length - 1].label : "-") + "。");
    }

    if (st === "sleeping") {
      lines.push(awake
        ? "<b>" + bjClock(now) + " 这个点不该睡</b>：它不是主动睡的 —— 没有真实事件、hub 又刚重启或状态超过 6 小时，" +
          "默认态就回落成了「睡觉」。现在 " + pad2(wake[0]) + ":00–" + pad2(wake[1]) + ":00 的空档回落成「摸鱼」，" +
          "只有 " + pad2(wake[1]) + ":00 之后才真的睡。"
        : "现在确实是夜里（" + pad2(wake[1]) + ":00 之后），睡着是正常的，明早第一班 " + (groups.length ? groups[0].clock : "09:10") + "。");
    } else if (st === "idle") {
      lines.push("状态是「摸鱼」= 没有真实任务在跑，它在办公室里等下一班活；这段时间它在本地自己过日子（散步、喝水、翻书）。");
    } else if (st === "error") {
      lines.push("上一次真实任务<b>报错了</b>，原因见事件流里那条红色的。");
    } else if (st) {
      lines.push("状态「" + (STATE_MAP[st] ? STATE_MAP[st].verb : st) + "」是 agent 真实上报的，不是模拟。");
    }
    return lines.join("<br>");
  }
  var planScrollPending = false;
  function renderPlan() {
    var nowEl = document.getElementById("act-now");
    var listEl = document.getElementById("act-plan");
    var whyEl = document.getElementById("act-why");
    if (!nowEl || !listEl) return;
    var now = Date.now(), groups = shiftsToday(), cur = currentShift(groups);
    var cfg = STATE_MAP[actCur.state] || null;

    nowEl.innerHTML = "现在 <b>" + bjClock(now) + "</b>（北京时间 · " + WEEK_CN[bjWeekday(now)] + "）" +
      " · 当前状态：<b>" + (cfg ? cfg.verb : "未知") + "</b>" +
      (actCur.at ? "（" + agoText(actCur.at) + "上报）" : "");

    listEl.innerHTML = groups.map(function (g) {
      var lastMin = g.occ[g.occ.length - 1] + g.dur;
      var cls = (cur.nowMin >= lastMin) ? "past" : (cur.active && cur.active.group === g ? "live" : "");
      var occTitle = g.every ? "今天的班次：" + g.occ.map(minToClock).join(" / ") : "";
      return '<li class="' + cls + '"' + (occTitle ? ' title="' + occTitle + '"' : "") + '>' +
        '<span class="plan-time">' + g.clock + '</span>' +
        '<span class="plan-label">' + (g.silent ? "🔇 " : "") + escHtml(g.label) +
        (g.every ? ' <span class="plan-every">每 ' + g.every + ' 小时</span>' : "") + '</span>' +
        '<span class="plan-note">' + escHtml(g.note) + '</span></li>';
    }).join("");

    if (whyEl) whyEl.innerHTML = whyHtml(groups, now, cur.active, cur.next);

    // 一打开时间表就把「此刻 / 下一班」那行带到视野里：只在真的看不见时才挪，
    // 而且只挪刚好够的距离 —— 上方的「现在几点 / 为什么是这样」固定不动，只有列表自己滚。
    if (planScrollPending) {
      planScrollPending = false;
      var idx = 0;
      groups.some(function (g, i) { if (cur.next && cur.next.group === g) { idx = i; return true; } return false; });
      var live = listEl.querySelector("li.live") || listEl.children[Math.max(0, idx)];
      if (live && listEl.scrollHeight > listEl.clientHeight) {
        var br = listEl.getBoundingClientRect(), lr = live.getBoundingClientRect();
        if (lr.bottom > br.bottom) listEl.scrollTop += (lr.bottom - br.bottom) + 8;
        else if (lr.top < br.top) listEl.scrollTop -= (br.top - lr.top) + 8;
      }
    }
  }

  // ---------- 面板交互（标签 / 折叠，状态记在本地） ----------
  function actSetTab(which) {
    actTab = which === "plan" ? "plan" : "events";
    var ev = document.getElementById("act-pane-events"), pl = document.getElementById("act-pane-plan");
    var tbl = document.getElementById("act-tab-events"), tpl = document.getElementById("act-tab-plan");
    if (ev) ev.hidden = actTab !== "events";
    if (pl) pl.hidden = actTab !== "plan";
    if (tbl) { tbl.classList.toggle("active", actTab === "events"); tbl.setAttribute("aria-selected", String(actTab === "events")); }
    if (tpl) { tpl.classList.toggle("active", actTab === "plan"); tpl.setAttribute("aria-selected", String(actTab === "plan")); }
    if (actTab === "plan") { planScrollPending = true; renderPlan(); }
    actSaveUI();
  }
  function actSetFold(folded) {
    actFolded = !!folded;
    var box = document.getElementById("activity"), btn = document.getElementById("act-fold");
    if (box) box.classList.toggle("folded", actFolded);
    if (btn) { btn.textContent = actFolded ? "展开" : "收起"; btn.setAttribute("aria-expanded", String(!actFolded)); }
    actSaveUI();
  }
  function actSaveUI() {
    try { localStorage.setItem(ACT_UI, JSON.stringify({ tab: actTab, folded: actFolded })); } catch (e) {}
  }
  function initActivity() {
    var tabE = document.getElementById("act-tab-events");
    var tabP = document.getElementById("act-tab-plan");
    var fold = document.getElementById("act-fold");
    if (!tabE || !tabP) return;                 // 老版本 index.html 里没有这块 DOM 时安静退出
    try {
      var ui = JSON.parse(localStorage.getItem(ACT_UI) || "{}");
      if (ui.tab) actTab = ui.tab;
      if (ui.folded != null) actFolded = !!ui.folded;
    } catch (e) {}
    tabE.addEventListener("click", function () { actSetTab("events"); });
    tabP.addEventListener("click", function () { actSetTab("plan"); });
    if (fold) fold.addEventListener("click", function () { actSetFold(!actFolded); });
    actLoad();
    actSetTab(actTab);
    actSetFold(actFolded);
    renderEvents();
    renderPlan();
  }
  // 每 30s 只刷「几分钟前 / 现在几点 / 这一班是否进行中」，不重新拉数据
  setInterval(function () {
    renderEvents();
    if (actTab === "plan") renderPlan();
  }, 30000);
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", initActivity);
  else initActivity();

  // ---------- 启动 ----------
  window.addEventListener("DOMContentLoaded", function () {
    game = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: "office-parent",
      width: 1248, height: 768,          // 视口 = 单房间大小；世界 2112 宽由相机跟随
      pixelArt: true,
      backgroundColor: "#2a2e3d",
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [SceneBoot, SceneOffice]
    });
  });

  Object.defineProperty(window, "__office", { get: function () {
    return {
      fishState: fishState,
      hasBubble: !!bubble,
      bubbleText: bubbleText ? bubbleText.text : null,
      fishXY: fish ? [Math.round(fish.x), Math.round(fish.y)] : null,
      cam: scene && scene.cameras ? [Math.round(scene.cameras.main.scrollX), Math.round(scene.cameras.main.scrollY)] : null,
      npcs: npcLayer.length ? npcLayer.map(n => ({ id: n.def.id, state: n.state, x: Math.round(n.spr.x), y: Math.round(n.spr.y), tint: n.spr.tintTopLeft })) : [],
      lastPointer: lastPointer,
      sceneRef: scene,   // 调试：直接访问 scene（displayList 排查用）
      hostKeys: scene && scene.hostMap ? Object.keys(scene.hostMap).length : 0,
      hostHas: function (id) { return scene && scene.hostMap ? !!scene.hostMap[id] : null; },
      plan: curPlan ? { i: curPlan.i, len: curPlan.path && curPlan.path.length, local: !!curPlan.local, task: curPlan.task } : null,
      ws: ws ? ws.readyState : -1,
      blockedCount: scene && scene.grid ? scene.grid.flat().filter(Boolean).length : 0,
      texInfo: scene && scene.textures && scene.textures.exists("whale") ? (function () {
        var t = scene.textures.get("whale");
        var names = t.getFrameNames();
        return { total: names.length, last: names.slice(-3), sw: t.source[0].width, sh: t.source[0].height };
      })() : null,
      fx: scene && scene.fxDirect ? {
        pc: scene.fxDirect.pc ? { isSprite: !!scene.fxDirect.pc.spr.anims, playing: scene.fxDirect.pc.spr.anims ? scene.fxDirect.pc.spr.anims.isPlaying : false, frame: scene.fxDirect.pc.spr.frame.name } : null,
        printer: scene.fxDirect.printer ? { isSprite: !!scene.fxDirect.printer.spr.anims, playing: scene.fxDirect.printer.spr.anims ? scene.fxDirect.printer.spr.anims.isPlaying : false, frame: scene.fxDirect.printer.spr.frame.name } : null
      } : null,
      props: scene && scene.props ? scene.props.filter(function (p) { return !p.isFish; }).map(function (p) {
        return { a: p.key, x: Math.round(p.x), y: Math.round(p.y), depth: Math.round(p.depth), o: p.o, on: p.f && p.f.on || null };
      }) : null
    };
  } });

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
      editState: function () { return { on: editMode, tool: editTool, asset: editAsset, count: customFurniture.length, hub: !!hubMapBase() }; },
      editSetTool: function (t) { setEditTool(t); return editTool; },
      editSetAsset: function (a) { setEditAsset(a); return editAsset; },
      editSave: function () { saveEditMap(false, null, function (ok, err) { addEditLog(ok ? "已保存" : err); }); return true; },
      mapReload: function () {
        var base = hubMapBase();
        if (!base) return false;
        fetch(base.indexOf("://") >= 0 ? base + "/api/map" : base + "/map").then(function (r) { return r.json(); }).then(function (j) { applyCustomMap(j.furniture || []); });
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
          edit: { on: editMode, tool: editTool, asset: editAsset, count: customFurniture.length },
          frameIssues: frameAudit(),
          gridOverlay: !!gridOverlay
        };
      }
    }
  });
})();
