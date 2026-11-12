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
    if (fishState === "walking" || fishState === "acting") {
      // v83.4：正事中随机事件进 pending 队列，但立刻冒一个「✉ 事件文案」提醒气泡 2.5s，
      // 之后恢复当前任务气泡——观众能看到"发生了一件事"，正事的展示也不丢。
      try {
        var prevBubble = (curPlan && curPlan.task) || bubbleText;
        showBubble("✉ " + (script.text || msg.label || msg.eventKey), "idle");
        scene.time.delayedCall(2500, function () {
          if (bubbleText && bubbleText.text && bubbleText.text.indexOf("✉") === 0 && prevBubble) showBubble(prevBubble, "idle");
        });
      } catch (e) {}
      pendingEvent = script; return;
    }
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
    if (editorMode) return;    // 独立地图编辑器：鱼站桩不动，别在编辑时到处走
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
