/* AI 小镇 · Phaser 前端
 *
 * 真实事件驱动（骨架）：WS 收到一条「真实状态事件」→ A* 寻路到目标区域 → 播放对应动作 → 气泡显示事件名
 *   （事件由小镇自己的调度 / 任何外部程序经 hub 的 POST /api/event 推入，前端不认识任何业务方）
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
  var roomLights = { office: true, bedroom: false, kitchen: false, bath: false, nbCat: true, nbChief: true, nbDoc: true };   // v83：邻居三户默认开灯
  /* v45：manifest 里 bbox 只有第一行（正面）的尺寸；旋转后要按"当前帧所在行"取 bbox，
   * 否则影子/碰撞/脚点还按正面尺寸算（用户反馈：转了但影子和碰撞没变）。
   * perRow = 每行帧数；row = floor(frame / perRow)；行序 South/East/West/North。 */
  function bboxForFrame(m, frame) {
    if (!m) return [0, 0, 48, 48];
    var rows = (m.rows && m.rows.South) || 1;
    var row = Math.max(0, Math.floor((frame || 0) / rows));
    if (m.bboxRows && m.bboxRows[row]) return m.bboxRows[row];
    return m.bbox || [0, 0, m.frameW, m.frameH];
  }
  var COLS = 56, ROWS = 30, WALL_H = 48;   // 56x30：南排=办公室(0-24, rows16-29)；北排=卧室(2-9)/卫浴(11-15)；东侧=花园(27-37)/街道(39-55) 全高
  // v39.5：原来代码里写死的三扇窗已删除 —— 窗现在是物品层里可摆放的资产 "window"
  var W = COLS * TILE, H = ROWS * TILE + WALL_H;
  /* v40：昼夜预览 —— null=按真实时间；true=强制黑夜；false=强制白天（地图编辑器里切） */
  var forceNight = null;
  // 素材版本号由 office/tools/bust.mjs 按 assets/*.png 内容幂等改写，勿手改
  var ASSET_V = "a2ac8525";
  // 地图贴图版本号（assets/tiles/*.png，由 gen_tiles.mjs 生成）同样由 bust.mjs 改写
  var TILE_V = "5bf6be12";

  // 状态 → 区域 + 朝向 + 动作 + 气泡动词
  var STATE_MAP = {
    /* 区域映射按「该状态该站在哪件家具前」校准（v15）：
     * 旧版 window/tools/mail 的锚点落在书架墙、奖杯柜、厨房灶台旁，
     * 于是「看视频」对着书架、「发邮件」站在果盘和灶台中间。
     * 现在：看视频/评论 → 餐桌笔记本、写日记/回评论 → 工位电脑、
     * 做封面 → 设计台、发邮件 → 门廊信箱、到岗 → 大门下。
     */
    arrive:    { zone: "door",    act: "walk",   verb: "到岗",      mood: "working" },
    // 泛化「正在工作」：任何外部事件源（或小镇自己的调度）都可以推这个状态表示"在忙"。
    // 旧版 STATE_MAP 没有它，onState 会静默兜底成 idle —— 鱼刚到工位就去沙发摸鱼、黄点。
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

  /* ---------- 今日时间表（小镇自己的作息） ----------
   * 用户问过「现在的时间表是什么，怎么 19 点就睡觉了」：页面上原来只有一行状态，
   * 看不出「这个点到底该不该有活」，也分不清「没活所以摸鱼」和「真在干活」。
   *
   * 这张表是**小镇自己的作息**，唯一事实源是 hub/schedule.json，两处必须一致：
   *   hub/schedule.json（真相源）→ 这里（页面展示），tools/check.mjs 第 18 项双向核对。
   * 全部按北京时间：访客在哪个时区看到的都是同一张表。
   *   at      本班开始时刻（HH:MM）
   *   every   每 N 小时重复一班（跨零点按 24 取模），不写就是每天只有这一班
   *   weekday 只在周几（0=周日），不写就是天天有
   *   dur     这一班大概持续多久（分钟），只用来在面板上标「此刻正在进行」
   *   state   这一班对应的小镇状态（可选，纯文档用途）
   *   silent  静默时段：不上报状态，只在表上记一笔
   */
  var SCHEDULE = {
    tz: "Asia/Shanghai",
    wake: [8, 23],   // 这段时间里没有真实事件 → hub 回落成「摸鱼」；之外才回落到睡觉（见 hub/hub.mjs）
    shifts: [
      { at: "08:00", dur: 1, label: "起床洗漱", note: "洗漱台 · 一天从这里开始", state: "washing" },
      { at: "08:30", dur: 1, label: "早饭", note: "厨房 · 煮点东西吃", state: "eating" },
      { at: "09:00", dur: 6, label: "上午的营生", note: "工位 · 写写画画，收拾小镇里的事", state: "working" },
      { at: "10:00", weekday: 0, dur: 3, label: "赶集日", note: "周日的市集更热闹，去逛一圈", state: "browsing_market" },
      { at: "12:00", dur: 1, label: "午饭", note: "餐桌 · 顺便看看窗外", state: "eating" },
      { at: "13:00", dur: 1, label: "午后小憩", note: "充电垫 · 回一回精力", state: "recovering" },
      { at: "15:00", dur: 2, label: "散步逛市集", note: "花园 / 市集 · 天气好就走远一点", state: "strolling" },
      { at: "18:00", dur: 1, label: "晚饭", note: "厨房 · 一天里最舍得花时间的一顿", state: "eating" },
      { at: "20:00", dur: 2, label: "放松时间", note: "沙发 / 留声机 · 听歌、翻书、打游戏", state: "relaxing" },
      { at: "22:00", dur: 1, label: "洗澡", note: "卫浴 · 睡前洗漱", state: "washing" },
      { at: "23:00", dur: 9, label: "睡觉", note: "卧室 · 灯留一盏，一直睡到明早 08:00", state: "sleeping" }
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

