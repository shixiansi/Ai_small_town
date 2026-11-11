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
  /* 池塘（v39）：水面/沙岸/栈道都用 tiles 贴图，画进房间底图（80-room.js 的 paintPond）。
   * 这里只保留一个"重建底图"的入口，供编辑器隐藏/恢复池塘时调用。 */
  function buildPondGfx(s) {
    rebuildRoomBase();
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

  // ---------- 农场视觉层（v39：田土用 tiles 贴图，这里只画状态：浇水/施肥/作物） ----------
  var farmGfx = null, farmCropGfx = null;
  function drawFarm() {
    if (!scene || !scene.mapdata) return;
    if (farmGfx) { farmGfx.destroy(); farmGfx = null; }
    if (farmCropGfx) { farmCropGfx.destroy(); farmCropGfx = null; }
    if (!farm) farmLoad();
    var g = scene.add.graphics().setDepth(2);
    var gc = scene.add.graphics().setDepth(3);
    farm.plots.forEach(function (p, i) {
      var t = plotTile(i);
      var px = t.x * TILE, py = WALL_H + t.y * TILE;
      if (p.soil) {
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
    if (forceNight !== null && forceNight !== undefined) return !!forceNight;   // 编辑器里的昼夜预览
    var bj = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
    return bj >= 18 || bj < 6;
  }